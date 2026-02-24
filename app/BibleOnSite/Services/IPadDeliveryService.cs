namespace BibleOnSite.Services;

/// <summary>
/// On-demand asset delivery abstraction.
/// Android: Play Asset Delivery (PAD) via AssetPackManager.
/// iOS / Mac Catalyst: Apple On-Demand Resources (ODR) via NSBundleResourceRequest.
/// Other platforms: no-op (always returns false/null).
/// </summary>
public interface IPadDeliveryService
{
    /// <summary>
    /// Returns a directory path containing the asset pack's files if already
    /// available locally, or null when a download is still required.
    /// </summary>
    Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default);

    /// <summary>
    /// Downloads the on-demand asset pack from the store.
    /// Returns true once the pack is downloaded and ready at the assets path.
    /// </summary>
    Task<bool> FetchAsync(
        string packName,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default);
}
