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

    /// <inheritdoc />
    public Task<List<string>> GetDeliveryDiagnosticsAsync(string packName)
    {
#if ANDROID
        return GetDeliveryDiagnosticsAndroidAsync(packName);
#elif IOS || MACCATALYST
        return GetDeliveryDiagnosticsIosAsync(packName);
#else
        return Task.FromResult(new List<string> { "Platform: no on-demand delivery support" });
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

    private static Task<List<string>> GetDeliveryDiagnosticsAndroidAsync(string packName)
    {
        var lines = new List<string> { "--- PAD (Android) delivery diagnostics ---" };
        var manager = GetAssetPackManager();
        if (manager == null)
        {
            lines.Add("AssetPackManager: null (no activity)");
            return Task.FromResult(lines);
        }

        try
        {
            var location = manager.GetPackLocation(packName);
            lines.Add($"GetPackLocation('{packName}'): {(location != null ? $"path={location.AssetsPath()}" : "(null)")}");
        }
        catch (Exception ex)
        {
            lines.Add($"GetPackLocation error: {ex.Message}");
        }

        return Task.FromResult(lines);
    }
}
#endif

#if IOS || MACCATALYST
partial class PadDeliveryService
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string DatasetAssetName = "perushim_notes";

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
            {
                System.Diagnostics.Debug.WriteLine("ODR: ConditionallyBeginAccessing returned false — resource not yet downloaded");
                return null;
            }

            try
            {
                return SaveOdrDataAsset(cacheDir, request.Bundle);
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
            System.Diagnostics.Debug.WriteLine($"ODR: BeginAccessingResources for tag '{packName}'...");
            await request.BeginAccessingResourcesAsync();
            ct.ThrowIfCancellationRequested();

            var cacheDir = OdrCacheDir(packName);
            var result = SaveOdrDataAsset(cacheDir, request.Bundle);
            return result != null;
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
    /// After BeginAccessingResources, the asset catalog data is available via NSDataAsset.
    /// actool compiles the .dataset into Assets.car, so we read it via NSDataAsset and
    /// write to disk for SQLite file-based access.
    /// ODR assets live in the request's bundle, not the main bundle.
    /// </summary>
    private static string? SaveOdrDataAsset(string cacheDir, NSBundle bundle)
    {
        using var asset = new NSDataAsset(DatasetAssetName, bundle);
        if (asset?.Data == null)
        {
            System.Diagnostics.Debug.WriteLine($"ODR: NSDataAsset('{DatasetAssetName}') returned null");
            return null;
        }

        System.Diagnostics.Debug.WriteLine($"ODR: NSDataAsset loaded, length={asset.Data.Length}");
        var destPath = Path.Combine(cacheDir, NotesDbName);
        try
        {
            using var stream = asset.Data.AsStream();
            using var fileStream = File.Create(destPath);
            stream.CopyTo(fileStream);
            System.Diagnostics.Debug.WriteLine($"ODR: Saved to {destPath}");
            return cacheDir;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"ODR: Save failed: {ex.Message}");
            return null;
        }
    }

    private static async Task<List<string>> GetDeliveryDiagnosticsIosAsync(string packName)
    {
        var lines = new List<string> { "--- ODR (iOS) delivery diagnostics ---" };

        var cacheDir = OdrCacheDir(packName);
        var cachedFile = Path.Combine(cacheDir, NotesDbName);
        lines.Add($"Cache dir: {cacheDir}");
        lines.Add($"Cached file exists: {File.Exists(cachedFile)}");
        if (File.Exists(cachedFile))
        {
            try
            {
                var fi = new FileInfo(cachedFile);
                lines.Add($"Cached file size: {fi.Length} bytes");
            }
            catch (Exception ex)
            {
                lines.Add($"Cached file info error: {ex.Message}");
            }
        }

        // Probe NSDataAsset directly (without ODR request) — should be null for true ODR
        try
        {
            using var directAsset = new NSDataAsset(DatasetAssetName);
            lines.Add($"Direct NSDataAsset('{DatasetAssetName}'): {(directAsset?.Data != null ? $"length={directAsset.Data.Length}" : "(null)")}");
        }
        catch (Exception ex)
        {
            lines.Add($"Direct NSDataAsset error: {ex.GetType().Name}: {ex.Message}");
        }

        // Probe ODR conditionally
        try
        {
            using var request = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));
            lines.Add($"NSBundleResourceRequest created for tag '{packName}'");
            var conditionalOk = await request.ConditionallyBeginAccessingResourcesAsync();
            lines.Add($"ConditionallyBeginAccessing: {conditionalOk}");

            if (conditionalOk)
            {
                try
                {
                    using var odrAsset = new NSDataAsset(DatasetAssetName, request.Bundle);
                    lines.Add($"ODR NSDataAsset('{DatasetAssetName}', request.Bundle): {(odrAsset?.Data != null ? $"length={odrAsset.Data.Length}" : "(null)")}");

                    if (odrAsset?.Data != null)
                    {
                        // Try the full SaveOdrDataAsset path to validate write
                        var testDir = Path.Combine(FileSystem.CacheDirectory, "odr_diag_test");
                        Directory.CreateDirectory(testDir);
                        var testPath = Path.Combine(testDir, "diag_test.sqlite");
                        try
                        {
                            using var stream = odrAsset.Data.AsStream();
                            using var fs = File.Create(testPath);
                            stream.CopyTo(fs);
                            var written = new FileInfo(testPath).Length;
                            lines.Add($"Test write: {written} bytes to {testPath}");
                            File.Delete(testPath);
                        }
                        catch (Exception writeEx)
                        {
                            lines.Add($"Test write FAILED: {writeEx.GetType().Name}: {writeEx.Message}");
                        }
                        finally
                        {
                            try { Directory.Delete(testDir, true); } catch { /* best-effort cleanup */ }
                        }
                    }
                }
                catch (Exception assetEx)
                {
                    lines.Add($"ODR NSDataAsset error: {assetEx.GetType().Name}: {assetEx.Message}");
                }

                request.EndAccessingResources();
            }
            else
            {
                // Try full fetch to see the error
                lines.Add("Attempting BeginAccessingResources...");
                try
                {
                    using var fetchReq = new NSBundleResourceRequest(new NSSet<NSString>(new NSString(packName)));
                    await fetchReq.BeginAccessingResourcesAsync();
                    lines.Add("BeginAccessingResources: succeeded");

                    try
                    {
                        using var fetchedAsset = new NSDataAsset(DatasetAssetName, fetchReq.Bundle);
                        lines.Add($"Post-fetch NSDataAsset(request.Bundle): {(fetchedAsset?.Data != null ? $"length={fetchedAsset.Data.Length}" : "(null)")}");
                    }
                    catch (Exception fetchAssetEx)
                    {
                        lines.Add($"Post-fetch NSDataAsset error: {fetchAssetEx.GetType().Name}: {fetchAssetEx.Message}");
                    }

                    fetchReq.EndAccessingResources();
                }
                catch (Exception fetchEx)
                {
                    lines.Add($"BeginAccessingResources FAILED: {fetchEx.GetType().Name}: {fetchEx.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            lines.Add($"ODR request error: {ex.GetType().Name}: {ex.Message}");
        }

        // Check available disk space
        try
        {
            var cacheRoot = FileSystem.CacheDirectory;
            var driveInfo = new DriveInfo(Path.GetPathRoot(cacheRoot) ?? "/");
            lines.Add($"Available disk space: {driveInfo.AvailableFreeSpace / (1024 * 1024)} MB");
        }
        catch (Exception ex)
        {
            lines.Add($"Disk space check error: {ex.Message}");
        }

        return lines;
    }
}
#endif
