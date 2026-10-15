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
    -derivedDataPath app/extensions/AssetPackDownloader/build \
    -destination 'generic/platform=iOS' \
    MARKETING_VERSION=<app-version> \
    CURRENT_PROJECT_VERSION=<app-build> \
    CODE_SIGNING_ALLOWED=NO
```

The unsigned `build/Build/Products/Release-iphoneos/AssetPackDownloader.appex`
is embedded by the app build, which installs its provisioning profile as
`embedded.mobileprovision` and signs it with its own App Group entitlements plus
the application/team identity authorized by that profile when
`AssetPackDownloaderAppex` / `AssetPackDownloaderProfile` MSBuild properties are
set (see `app/devops` packaging targets and `app-package.yml`).

The explicit bundle metadata in `Info.plist` is expanded by Xcode. The target
also retains Swift's `_main` symbol so that the system extension entry point can
find its `__swift5_entry` metadata after release linking. The embedding step
stamps both versions from the host app again before signing, including when the
extension was restored from a build cache.

Signed distribution packaging fails if the device extension or its profile is
missing. CI validates both profiles before building and the final IPA's metadata,
signatures, entitlements, and Swift entry point before publishing an artifact.
Unsigned development and simulator builds can omit the extension.

The portable preparation checks can be run with
`python -m unittest discover -s app/extensions -p 'test_*.py'`.

## Apple Developer Portal setup (one-time)

- App group `group.com.tanah.daily929.assets` enabled on **both**
  `com.tanah.daily929` (app — regenerate its provisioning profile) and
  `com.tanah.daily929.AssetPackDownloader` (extension — new App ID + profile).
- In App Store Connect, upload each `.aar` produced by `xcrun ba-package`
  (via Transporter) and attach the asset packs to the app.
