# BibleOnSite in-process device tests (#3349)

Thin Android device-test layer between the portable unit suite and the Appium
mobile E2E: the tests in `Tests/` run **inside** this app on a real emulator or
device through an `android.app.Instrumentation`, driven by
[XHarness](https://github.com/dotnet/xharness) — no Appium, no WebDriverAgent.
It can assert on real MAUI handlers, XAML inflation, layout/RTL measure,
platform services (Preferences, FileSystem, DeviceInfo) and UI-thread behavior
at ~0.5 s/test. Genuine user journeys through the packaged app stay on Appium —
see `docs/tests/app/device-tests-research.md` for the capability matrix and why
the layers coexist.

The runner (`Platforms/Android/Runner.cs`, `EntryPoints.cs`) is a trimmed
headless equivalent of the vendored dotnet/maui `DeviceTests.Runners` that
CommunityToolkit/Maui uses (~250 lines vs their ~70-file tree + source
generator, which emits the same manifest entries). Upstream is MIT licensed —
see `LICENSE-dotnet-maui.txt`.

This is a normal single-project MAUI app (`net11.0-android`, `UseMaui`,
`IsTestProject=false` — MTP must not see it). The production sources it
exercises are *linked* like the portable suite links them; xUnit here is
deliberately v2 because the XHarness runner is v2. Its NuGet.config adds the
`dotnet-eng` feed the prerelease `Microsoft.DotNet.XHarness.*` packages ship
from, scoped to this directory only.

## CI

The `XHarness Android device tests` leg of `app-mobile-e2e.yml` builds the APK,
boots the shared AVD and runs `app/mobile-e2e/device-tests.mjs`, which invokes
the `TestDeviceAndroid` Nuke target and adapts the pulled xUnit-v2 XML into the
JUnit report under `$MOBILE_E2E_ARTIFACTS/results/`.

## Run locally

Requires an Android SDK, the `maui-android` workload and a booted emulator or
device on API 29+ (`MediaStore.Downloads` backs the results export).

```bash
# from app/
dotnet run --project devops -- CompileDeviceTests          # Release APK (Debug ships no embedded assemblies)
dotnet run --project devops -- TestDeviceAndroid           # tool restore + xharness android test
```

`MOBILE_UDID` selects the device (`emulator-5554` when exactly one is up) and
`MOBILE_E2E_ARTIFACTS` overrides the output directory
(default `app/.artifacts/device-tests/`).
