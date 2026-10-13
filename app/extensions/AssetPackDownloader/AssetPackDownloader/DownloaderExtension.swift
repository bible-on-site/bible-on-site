import BackgroundAssets
import ExtensionFoundation
import StoreKit

/// Managed asset packs (perushim notes, recitation audio) are Apple-hosted, so the
/// system-provided downloader implementation does all scheduling and downloading.
/// This extension only exists because Background Assets requires the host app to
/// ship a downloader extension that adopts `StoreDownloaderExtension` — adopting the
/// default implementation is the documented zero-custom-code option.
@main
struct AssetPackDownloaderExtension: StoreDownloaderExtension {
    func shouldDownload(_ assetPack: AssetPack) -> Bool {
        true
    }
}
