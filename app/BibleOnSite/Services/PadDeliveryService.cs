#if ANDROID
using Android.Gms.Extensions;
using Xamarin.Google.Android.Play.Core.AssetPacks;
using Xamarin.Google.Android.Play.Core.AssetPacks.Model;
#elif IOS || MACCATALYST
using Foundation;
using UIKit;
#endif

namespace BibleOnSite.Services;

/// <summary>
/// On-demand asset delivery service.
/// Android: Play Asset Delivery via AssetPackManager.
/// iOS: Apple On-Demand Resources via NSBundleResourceRequest.
/// Other platforms: no-op.
/// </summary>
public sealed partial class PadDeliveryService : IPadDeliveryService
{
    private const string PerushimNotesPackName = "perushim_notes";

    public static IPadDeliveryService Instance { get; } = new PadDeliveryService();

    private PadDeliveryService() { }

    /// <inheritdoc />
    public Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default)
    {
#if ANDROID
        return TryGetAssetPathAndroidAsync(packName, cancellationToken);
#elif IOS || MACCATALYST
        return TryGetAssetPathIosAsync(packName, cancellationToken);
#else
        return Task.FromResult<string?>(null);
#endif
    }

    /// <inheritdoc />
    public Task<bool> FetchAsync(
        string packName,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
#if ANDROID
        return FetchAndroidAsync(packName, progress, cancellationToken);
#elif IOS || MACCATALYST
        return FetchIosAsync(packName, progress, cancellationToken);
#else
        return Task.FromResult(false);
#endif
    }
}

#if ANDROID
partial class PadDeliveryService
{
    private static IAssetPackManager? GetAssetPackManager()
    {
        var activity = Platform.CurrentActivity;
        return activity != null ? AssetPackManagerFactory.GetInstance(activity) : null;
    }

    private static Task<string?> TryGetAssetPathAndroidAsync(string packName, CancellationToken cancellationToken)
    {
        var manager = GetAssetPackManager();
        if (manager == null)
            return Task.FromResult<string?>(null);

        try
        {
            var location = manager.GetPackLocation(packName);
            return Task.FromResult(location?.AssetsPath());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"PAD GetPackLocation failed: {ex.Message}");
            return Task.FromResult<string?>(null);
        }
    }

    private static async Task<bool> FetchAndroidAsync(
        string packName,
        IProgress<double>? progress,
        CancellationToken cancellationToken)
    {
        var manager = GetAssetPackManager();
        if (manager == null)
            return false;

        try
        {
            var location = manager.GetPackLocation(packName);
            if (location?.AssetsPath() != null)
                return true;

            var listener = new AssetPackStateUpdateListenerWrapper();
            listener.StateUpdate += (_, e) =>
            {
                var status = e.State?.Status() ?? 0;
                if ((status == (int)AssetPackStatus.Downloading || status == (int)AssetPackStatus.Transferring) && e.State != null)
                {
                    var total = e.State.TotalBytesToDownload();
                    var downloaded = e.State.BytesDownloaded();
                    if (total > 0)
                        progress?.Report((double)downloaded / total);
                }
                else if (status == (int)AssetPackStatus.WaitingForWifi)
                {
                    var activity = Platform.CurrentActivity;
                    if (activity != null)
                        manager.ShowConfirmationDialog(activity);
                }
            };

            var activity = Platform.CurrentActivity;
            if (activity != null)
                manager.RegisterListener(listener.Listener!);

            try
            {
                await manager.Fetch(new[] { packName })!.AsAsync<Java.Lang.Object>();
                cancellationToken.ThrowIfCancellationRequested();

                // In local-testing mode (bundletool --local-testing), the
                // FakeAssetPackService extracts the pack asynchronously after
                // Fetch resolves. Poll until the location becomes available.
                for (var attempt = 0; attempt < 60; attempt++)
                {
                    var fetchedLocation = manager.GetPackLocation(packName);
                    if (fetchedLocation?.AssetsPath() != null)
                        return true;

                    await Task.Delay(500, cancellationToken);
                }

                return false;
            }
            finally
            {
                if (activity != null)
                    manager.UnregisterListener(listener.Listener!);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"PAD Fetch failed: {ex.Message}");
            return false;
        }
    }
}
#endif

#if IOS || MACCATALYST
partial class PadDeliveryService
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";

    private static string OdrCacheDir(string packName)
    {
        var dir = Path.Combine(FileSystem.CacheDirectory, "odr_assets", packName);
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static async Task<string?> TryGetAssetPathIosAsync(string packName, CancellationToken ct)
    {
        var cacheDir = OdrCacheDir(packName);
        if (File.Exists(Path.Combine(cacheDir, NotesDbName)))
            return cacheDir;

        try
        {
            using var request = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));
            var available = await request.ConditionallyBeginAccessingResourcesAsync();
            if (!available)
                return null;

            try
            {
                return SaveOdrAsset(packName, cacheDir);
            }
            finally
            {
                request.EndAccessingResources();
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"ODR TryGetAssetPath failed: {ex.Message}");
            return null;
        }
    }

    private static async Task<bool> FetchIosAsync(
        string packName,
        IProgress<double>? progress,
        CancellationToken ct)
    {
        using var request = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));

        IDisposable? observer = null;
        if (progress != null)
        {
            observer = request.Progress.AddObserver(
                "fractionCompleted",
                NSKeyValueObservingOptions.New,
                _ => progress.Report(request.Progress.FractionCompleted));
        }

        try
        {
            await request.BeginAccessingResourcesAsync();
            ct.ThrowIfCancellationRequested();

            var cacheDir = OdrCacheDir(packName);
            return SaveOdrAsset(packName, cacheDir) != null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"ODR Fetch failed: {ex.Message}");
            return false;
        }
        finally
        {
            observer?.Dispose();
            request.EndAccessingResources();
        }
    }

    /// <summary>
    /// Extracts the ODR data asset to disk so PerushimNotesService can copy it
    /// to AppDataDirectory via its normal TryCopyFromPad flow.
    /// </summary>
    private static string? SaveOdrAsset(string assetName, string cacheDir)
    {
        using var dataAsset = new NSDataAsset(assetName);
        if (dataAsset?.Data == null)
            return null;

        var destPath = Path.Combine(cacheDir, NotesDbName);
        if (dataAsset.Data.Save(NSUrl.FromFilename(destPath), true))
            return cacheDir;

        System.Diagnostics.Debug.WriteLine("ODR: NSData.Save failed");
        return null;
    }
}
#endif
