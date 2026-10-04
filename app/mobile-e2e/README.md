# Appium mobile E2E pilot

The shared C# suite in `../BibleOnSite.Tests.MobileE2E` runs on Android and iOS.
CI creates one independent runner per matrix entry (`app-mobile-e2e.yml`), with
`fail-fast: false`, and requires both results through the main CI gate. Tests
on an individual device run sequentially and start with a freshly reset app.
Android uses a full app reset. iOS reinstalls the app without erasing the booted
simulator, and Appium operates the simulator headlessly.

The pilot covers packaged scripture and bottom navigation, adjacent perek
navigation with matching source **and** pesukim, and native flyout/preferences
navigation back to the original perek. The Debug app points to a closed local
endpoint for this pilot, so startup exercises offline behavior without relying
on production or an external API. The build restores any local API override
after packaging. Canonical content comes from the existing packaged database.

## Adding scenarios and platform differences

Keep user flows and business assertions shared in the C# tests and page objects.
`MobilePlatformAdapter` owns driver capabilities, native navigation and layout
expectations; `AndroidPlatformAdapter` and `IosPlatformAdapter` are the extension
points for native selectors, safe-area differences and other intended platform
behavior. The adapters map MAUI automation IDs to Android resource IDs and iOS
accessibility identifiers. Override `Layout` for a documented platform difference rather than
branching or skipping an entire shared scenario. Shared classes use
`[Trait("Platform", "Shared")]`. Platform-only classes use
`[Trait("Platform", "Android")]` or `[Trait("Platform", "iOS")]` alongside
`[Trait("Category", "MobileE2E")]`; the Nuke target automatically selects shared
tests plus the current platform, leaving platform-only behavior easy to add.

The pilot matrix deliberately covers Android and iOS. Existing Windows FlaUI
tests and Android gesture regressions remain separate. Additional device/OS
entries can reuse the same suite; each must own its emulator and artifacts.

## Running locally

Install the platform's .NET MAUI workload, Android SDK/JDK or compatible Xcode,
then run `npm ci` in this directory. Set `MOBILE_PLATFORM` to `Android` or `iOS`
and run `npm run build:app`. The build embeds assemblies in the Android x64
APK and completes the iOS arm64 simulator `.app` build.

Set `MOBILE_UDID` to a running device's identifier, then run `npm test` here.
On macOS, `npm run ios:boot` selects an available iPhone runtime no newer than
the selected Xcode SDK, boots it, and prints the identifier and `MOBILE_OS_VERSION`.
Set both for local iOS runs; CI exports them automatically.
`MOBILE_APP_PATH` can select another compatible build. Each local
run owns an Appium server on `127.0.0.1:4723`; keep that port free.

`npm run test:unit` checks simulator selection without a device.
From `app/`, `dotnet run --project devops -- TestMobileE2EUnit` checks platform
configuration and device capabilities without a device or mobile workload.

Screenshots and native view trees are captured for each scenario, alongside
Appium and device logs, TRX and JUnit reports, under `app/.artifacts/mobile-e2e/<platform>`.
CI uploads a separate artifact for each platform even on test failures.
