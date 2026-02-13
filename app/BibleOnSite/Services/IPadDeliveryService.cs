namespace BibleOnSite.Services;

/// <summary>
/// Service for Play Asset Delivery (PAD) on Android.
/// On other platforms, this is a no-op (always returns false/null).
/// </summary>
public interface IPadDeliveryService
{
    /// <summary>
    /// Attempts to get the path to an asset pack's assets folder.
    /// Returns null if the pack is not yet downloaded/installed.
    /// </summary>
    Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Requests download of an on-demand asset pack.
    /// Returns true if the pack was downloaded and is available at the assets path.
    /// </summary>
    Task<bool> FetchAsync(
        string packName,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default);
}
