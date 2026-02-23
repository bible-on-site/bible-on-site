#if ANDROID
using Android.Gms.Extensions;
using Xamarin.Google.Android.Play.Core.AssetPacks;
using Xamarin.Google.Android.Play.Core.AssetPacks.Model;
#endif

namespace BibleOnSite.Services;

/// <summary>
/// Play Asset Delivery (PAD) service.
/// On Android: uses AssetPackManager to request and access on-demand asset packs.
/// On other platforms: no-op (PAD is Android-only).
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
