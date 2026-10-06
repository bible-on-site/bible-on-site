# Appium mobile E2E pilot

The shared C# suite in `../BibleOnSite.Tests.MobileE2E` runs on Android and iOS.
CI creates one independent runner per matrix entry (`app-mobile-e2e.yml`), with
`fail-fast: false`, and requires both results through the main CI gate. Tests
on an individual device run sequentially and start with a freshly reset app.
Android uses a full app reset. iOS reinstalls the app without erasing the booted
simulator, and Appium operates the simulator headlessly.
Before iOS tests, Appium downloads the official simulator WebDriverAgent matching
the locked driver dependency and launches it directly. This keeps cold Xcode
compilation outside session startup; `npm test` also prepares the agent locally.
See the [Appium prebuilt-agent guide](https://appium.github.io/appium-xcuitest-driver/latest/guides/run-prebuilt-wda/).

The pilot covers packaged scripture and bottom navigation, adjacent perek
navigation with matching source **and** pesukim, and native flyout/preferences
navigation back to the original perek. The Debug app points to a closed local
endpoint for this pilot, so startup exercises offline behavior without relying
on production or an external API. The build restores any local API override
after packaging. Canonical content comes from the existing packaged database.

## Adding scenarios and platform differences

Keep user flows and business assertions shared in the C# tests and page objects.
`MobilePlatformAdapter` owns driver capabilities, native navigation and layout
expectations and native tap behavior; `AndroidPlatformAdapter` and `IosPlatformAdapter` are the extension
points for native selectors, safe-area differences and other intended platform
behavior. The adapters map MAUI automation IDs to Android resource IDs and iOS
accessibility identifiers. Override `Layout` for a documented platform difference rather than
branching or skipping an entire shared scenario. Shared classes use
`[Trait("Platform", "Shared")]`. Platform-only classes use
`[Trait("Platform", "Android")]` or `[Trait("Platform", "iOS")]` alongside
`[Trait("Category", "MobileE2E")]`; the Nuke target automatically selects shared
tests plus the current platform, leaving platform-only behavior easy to add.
Use `[Collection("Mobile device")]` on every mobile test class to serialize
scenarios that own the same device. Inject `MobileDeviceSessionFactory` and create
drivers through `sessions.Create(...)`. If session startup fails, subsequent
scenarios fail without requesting another session on a device whose preparation
may still be running; the original failure remains in the test report.

iOS waits for XCTest's `hittable` attribute before actions and sends one W3C touch
at the element's viewport center, with a 100 ms pause between down and up. This
exercises the real touch target of rounded floating controls while avoiding
XCTest's automatic hit-point selection. Native device logs record menu press,
release, click and completed animations to diagnose touch delivery. Android uses
native element clicks. UI assertions and readiness deadlines remain shared.
After session creation, allow two minutes for the first reader snapshot: a cold
iOS lookup can take longer than 45 seconds and return the earlier loading tree
even though the reader has appeared. This startup gate requires a visible,
nonempty perek source and captures failure diagnostics. Subsequent scenario
lookups and navigation retain their 45-second deadlines.
iOS keeps XCTest idle checks enabled with a one-second `waitForIdleTimeout`, so
repeated internal idle waits during startup do not exhaust the page object's
readiness polling. See the [Appium idle-wait capability](https://appium.github.io/appium-xcuitest-driver/latest/reference/capabilities/).

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

`npm run test:unit` checks simulator selection and the locked driver module's
ESM loading without a device.
From `app/`, `dotnet run --project devops -- TestMobileE2EUnit` checks platform
configuration and device capabilities without a device or mobile workload.

Screenshots and native view trees are captured for each scenario, alongside
timestamped Appium and device logs, TRX and JUnit reports, under `app/.artifacts/mobile-e2e/<platform>`.
iOS also exports app lifecycle logs and fresh app crash reports. Failed runs
collect a short native stack sample if the app is still running, without
competing with healthy tests for simulator resources.
The independent log export allows iOS to disable Appium's duplicate live system
log stream with `skipLogCapture`, avoiding its cold-start overhead. Session setup
has a five-minute client budget inside the ten-minute per-test hang guard, leaving
room for the scenario and diagnostics. `wdaConnectionTimeout` bounds every proxied
WDA request including `POST /session`, so it stays at the driver default of 240
seconds — a cold app launch can exceed 90 seconds before the first test runs.
CI uploads a separate artifact for each platform even on test failures.
