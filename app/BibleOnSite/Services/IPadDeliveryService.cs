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
    Task<string?> TryGetAssetPathAsync(string packName) =>
        TryGetAssetPathAsync(packName, CancellationToken.None);

    /// <summary>
    /// Returns a directory path containing the asset pack's files if already
    /// available locally, or null when a download is still required.
    /// </summary>
    Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken);

    /// <summary>
    /// Downloads the on-demand asset pack from the store.
    /// Returns true once the pack is downloaded and ready at the assets path.
    /// </summary>
    Task<bool> FetchAsync(string packName, CancellationToken cancellationToken) =>
        FetchAsync(packName, null, cancellationToken);

    /// <summary>
    /// Downloads the on-demand asset pack from the store.
    /// Returns true once the pack is downloaded and ready at the assets path.
    /// </summary>
    Task<bool> FetchAsync(string packName, IProgress<double>? progress) =>
        FetchAsync(packName, progress, CancellationToken.None);

    /// <summary>
    /// Downloads the on-demand asset pack from the store.
    /// Returns true once the pack is downloaded and ready at the assets path.
    /// </summary>
    Task<bool> FetchAsync(
        string packName,
        IProgress<double>? progress,
        CancellationToken cancellationToken);

    /// <summary>
    /// Platform-specific delivery diagnostics (ODR on iOS, PAD on Android).
    /// Returns lines to append to the user-exportable diagnostic report.
    /// </summary>
    Task<List<string>> GetDeliveryDiagnosticsAsync(string packName);
}
