# iOS managed asset-pack downloader extension

Managed Background Assets (perushim notes and recitation audio) require the host
app to embed a downloader **app extension** — an ExtensionKit `.appex` whose entry
point is the Swift-only `AppExtension` protocol, so it cannot be produced by the
.NET iOS toolchain. This tiny Xcode project builds the extension that
`xcodebuild` produces and the `BibleOnSite.csproj` `_EmbedAssetPackDownloader`
target embeds at `<app>/Extensions/` before code signing.

The extension adopts `StoreDownloaderExtension` (StoreKit's protocol for
Apple-hosted managed asset packs) with the system-provided default
implementation — no custom download code is needed.

## Build (macOS packaging runner)

```bash
xcodebuild \
    -project app/extensions/AssetPackDownloader/AssetPackDownloader.xcodeproj \
    -scheme AssetPackDownloader \
    -configuration Release \
    -derivedDataPath app/extensions/build \
    -destination 'generic/platform=iOS' \
    CODE_SIGNING_ALLOWED=NO
```

The unsigned `build/Build/Products/Release-iphoneos/AssetPackDownloader.appex`
is embedded by the app build, which installs its provisioning profile as
`embedded.mobileprovision` and re-signs it with the app's entitlements when
`AssetPackDownloaderAppex` / `AssetPackDownloaderProfile` MSBuild properties are
set (see `app/devops` packaging targets and `app-package.yml`).

## Apple Developer Portal setup (one-time)

- App group `group.com.tanah.daily929.assets` enabled on **both**
  `com.tanah.daily929` (app — regenerate its provisioning profile) and
  `com.tanah.daily929.AssetPackDownloader` (extension — new App ID + profile).
- In App Store Connect, upload each `.aar` produced by `xcrun ba-package`
  (via Transporter) and attach the asset packs to the app.
