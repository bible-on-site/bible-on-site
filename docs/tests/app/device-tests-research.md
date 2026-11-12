# In-Process Device Tests vs. Our Current App Test Stack — Research (#3336)

Research into adopting parts or all of the testing approach merged upstream in
[CommunityToolkit/Maui#3344](https://github.com/CommunityToolkit/Maui/pull/3344)
("Add Device Tests, Apply Fixes for Bugs Found", merged 2026-11-08, merge commit
`991e2cba7c62175d96baaf40bfa10a0ba3aea5d5`; inspected head
`6634c69ecbe48e4ac888128e21fddce0fbdbb389`).

Our master at research time: `385864c22` (issue was filed against `4d3ecaa5` — same
architecture).

## TL;DR — Recommendation

**Adopt selected parts: add a thin in-process device-test layer on Android now,
extend to iOS during/after #3335, and keep the Appium suite for black-box journeys.
Do not adopt the framework wholesale, and do not migrate existing tests.**

The upstream approach answers a real gap — today nothing executes our code against
real MAUI handlers, the XAML runtime, layout, platform services or the UI thread.
Our PoC ran 7 such tests on `emulator-5554` in ~4 s of device time; the equivalent
Appium scenario costs ~25–77 s per test and can't make these assertions at all.
But upstream's model is *library testing inside a dedicated test app* — it cannot
drive the packaged BibleOnSite app, so it replaces no part of the Appium layer's
job (install/startup/packaged-Release coverage included).

## 1. Capability matrix

| Capability | Portable unit (`BibleOnSite.Tests`) | Appium mobile E2E / FlaUI Windows E2E | Upstream-style in-process device tests |
|---|---|---|---|
| Pure logic, VM commands, converters, services | ✅ ~2 200 tests, ~19 tests/s with coverage | overkill | ✅ runs too, no added value |
| Real MAUI handlers / platform views | ❌ (no MAUI platform assemblies) | indirect, black-box only | ✅ `IView.ToHandler(mauiContext)` (PoC-verified) |
| XAML inflation & code-behind | ❌ every `*.xaml.cs` excluded | indirect | ✅ `LoadFromXaml` / compiled pages (PoC-verified) |
| Layout, measure/arrange, RTL rendering | ❌ | screenshots/element rects via remote calls | ✅ platform `Measure`, real text shaping (PoC-verified) |
| UI-thread affinity / lifecycle / activity recreation | ❌ (stubs) | indirectly observed | ✅ `MainThread.InvokeOnMainThreadAsync`, recreation is first-class in their runner (PoC-verified) |
| Platform services (Preferences, SecureStorage, FileSystem, media, permissions) | ❌ (interfaces stubbed) | exercised only through UI | ✅ real implementations (PoC: DeviceInfo/AppInfo) |
| WebView rendering | ❌ | element-level | ✅ real WebView inside test app |
| Gestures, permissions prompts, multi-window, system integration | ❌ | ✅ only option (real user input path) | partial — in-app gestures possible, OS-level permission prompts not |
| Genuine user journey through the **packaged** app (install → cold start → navigate → exit) | ❌ | ✅ this is the Appium suite's reason to exist (+ Release smoke leg) | ❌ tests run inside a test app, not the shipped artifact |
| New bug families reachable | — | packaged-app regressions (#2247-class startup crash) | handler-mapping regressions, XAML parse failures, RTL layout clipping, UI-thread misuse, platform-API behavior — all currently untestable |
| Assertions requiring external automation | — | driver-level (page source, screenshots, app restart, network conditions) | impossible by construction (same process) |
| Reuse of existing tests | — | — | portable test *sources* could be recompiled (xUnit 2 vs v3 caveat, §6); Appium tests do not transfer |

**The layers are complementary, not substitutes.** Upstream tests a *library* inside
a test app; our Appium suite tests *the product* from outside. Adding the layer
raises coverage density per CI minute; it does not reduce the need for black-box
coverage — the issue's requirement to keep essential E2E is met by retaining Appium.

## 2. Current inventory (measured, not estimated)

| Layer | Scale | Runtime evidence |
|---|---|---|
| Portable unit + integration | 2 194 `[Fact]`/`[Theory]` in 181 files (`BibleOnSite.Tests`, net10.0, xunit.v3 4.0.2 + MTP, linked sources, stubs for native deps) | CI run `43265570785` (2026-11-12): unit+coverage 116 s, integration+coverage 185 s inside `App CI` job 936 s |
| Appium mobile E2E | 17 scenario methods: 13 `Platform=Shared` (`PerekPilot` 8, `LearningCalendar` 3, `PerekPicker` 2) + 4 `Platform=iOS` (`IosReader` 2, scroll-stability 2); 86 host-side harness tests (`Category=Unit`) | Run `40162816924` (2026-10-25): Android leg 676 s total — app build 122 s, SDK/AVD ~215 s, **pilot 219 s for 8 tests ≈ 25–27 s/test**. iOS: build once 317 s; shards 718 s/940 s with ~470–590 s fixed overhead each (sim-state restore 37 s, sim setup 129 s, **WDA+Appium agent prep 133 s**, artifact downloads ~200 s); shard execution 463 s for 6 tests ≈ **75–77 s/test** |
| Windows E2E (FlaUI) | ~17 cases in `BibleOnSite.Tests.E2E` (PerekPage 5, SelectionMode 8, Articles 3, toolbars) | runs in `App CI` |
| Native audio leg | `App iOS native audio CI` | 86 s |
| Supporting machinery | `app/mobile-e2e` bun scripts (AVD snapshot caching, iOS build-once-share, shard planner, merge, coverage trees), `e2e-impact` selection + runtime-balanced sharding (#2085/#2263), AltCover app-process coverage merged with Coverlet | — |

Failure evidence: run `40155095608` — `PerushimHtmlScrollStabilityTests`
failed after 2 m 17 s on `WebDriverTimeoutException: No visible element matching
ByIosNsPredicate…` — the locator/WDA flake class, and a case where a 2-minute
scroll-stability journey exists *because* nothing cheaper can assert per-cell
survival.

## 3. What upstream actually built

- **One test app** `src/CommunityToolkit.Maui.DeviceTests` (net*-android/-ios/-maccatalyst/-windows) containing all device tests; `IsTestProject=false` so `dotnet test` (MTP mode) ignores it — it is *not* a dotnet-test project.
- **Runner**: `Microsoft.DotNet.XHarness.TestRunners.Xunit 11.0.0-prerelease.*` + **xunit 2.9.3** + `xunit.runner.utility 2.9.3` — vendored dotnet/maui `DeviceTests.Runners` sources (~70 files: `HeadlessRunner/`, `VisualRunner/`, shared `HandlerTestBase`/`TestApplicationStub`) + a source generator that emits the per-platform entry points (instrumentation, activities, delegates) and manifest entries. MIT license → `LICENSE-dotnet-maui.txt` attribution required.
- **Orchestration**: `eng/devices/*.ps1` — `xharness android test` / `xharness apple test` (no WebDriverAgent on iOS — direct simctl/mlaunch); Windows runs the app itself, once per category when filtered. `-Timeout 30 min` (40 iOS), `-InfraRetries 1` on CI, Release configuration (real trimming/AOT semantics), capability declarations (`SkipCapabilities`/`RequireCapabilities`), `RequiresUserInteraction` category never runs headless, `Category=`/`SkipCategories=` filtering only.
- **Coverage**: coverlet on-device (hits files pulled off the device), merged with unit coverage into one report; documented limits — Windows coverage incomplete, coverage-failure reporting permissive.
- **CI**: reusable `device-tests.yml`, one platform per job (ubuntu-24.04 Android API 28+36, xcode-27 iOS + Mac Catalyst, macos-26 iOS 26.5, windows-2025 packaged+unpackaged), NuGet/workload-pack caching.
- Post-merge movement: the pinned xharness/tool versions in the inspected head were already bumped by a later follow-up (`26466.1` → `26556.1` seen in CI logs) — the prerelease line churns; pin deliberately.
- Distinction to keep: upstream tests a *published library*; we would test a *complete application*. Their SkipCategories escape hatch, per-package categories, and visual runner exist for library maintainers; our equivalent needs app fixtures (seed data, API stubbing) instead.

## 4. Benchmarks

### Measured — our CI

| Leg (run `40162816924`, 2026-10-25) | Job wall | Fixed overhead before tests | Test execution | Per-test |
|---|---|---|---|---|
| Appium Android (Debug suite) | 676 s | build 122 s + workload/SDK/AVD ~300 s | 219 s (8 tests) | ~25–27 s |
| Appium iOS shard (worst) | 940 s | ~477 s (agent 133 s, sim 166 s, downloads ~200 s) | 463 s (6 tests) | ~75–77 s |
| iOS critical path end-to-end | ~22 min | plan 21 s + build 317 s + shard 940 s + merge 27 s | — | — |
| Unit tests (run `43265570785`) | 116 s step | — | ~2 200 tests | ~0.05 s |
| Second data point (`43265570785`, CI with colder caches) | Android 956 s, iOS shards 2029 s/1273 s | — | — | — |

### Measured — upstream CI (Build run `43293069656`, 2026-11-12, all green)

| Job | Wall | Inner breakdown |
|---|---|---|
| Android API 36 | 1 661 s | build+instrument 3 m 19 s; install 2 s; **2 554 tests in 18 m 31 s ≈ 0.44 s/test**; results+coverage 3 s |
| Android API 28 | 1 390 s | same shape |
| iOS Simulator | 2 047 s | no WDA — xharness drives the simulator directly |
| iOS 26.5 / Mac Catalyst | 1 223 s / 902 s | — |
| Windows packaged / unpackaged | 812 s / 961 s | — |

Upstream job wall times are *not* faster than our Appium legs — they run ~300× more
tests in that time. The honest comparison is throughput and reachable assertions,
not job minutes.

### Measured — local PoC (this machine, `emulator-5554` API 36 x86_64, Release no-AOT)

- Build: 158 s cold / 48 s incremental (Debug cold 81 s).
- `xharness android test`: **24 s wall** → install ~4 s + instrumentation ~16 s (process start + JIT + 4 s execution).
- **7/7 pass**: converter parity (identical assertions to `PasukMarkerTextConverterTests`) 0.50 s; platform measure 1.27 s; real `ButtonHandler` 0.42 s; XAML inflate 0.68 s; DeviceInfo 0.06 s; UI-thread 0.03 s; AppInfo 0.001 s. Standard xUnit XML pulled off the device; XHarness exit 0.
- Non-obvious requirements found by doing it: the `[Instrumentation]`/`[Activity]` manifest entries must be generated (missing → exit 82 `RETURN_CODE_NOT_SET`); Debug APKs ship no assemblies → `monodroid` aborts ("No assemblies found") — build Release or `EmbedAssembliesIntoApk`; results export needs the MediaStore path on API ≥ 30.
- PoC used a hand-written ~240-line runner (no source generator, no visual runner) — proving the *minimal* adoption is much smaller than the full vendored tree.

**Not measured** (missing evidence, not claims): iOS device-test run (no macOS host locally); Windows device test (no maui-windows workload installed); our real app code inside a device test (PoC linked one self-contained production file, `PasukMarkerTextConverter.cs`); cold CI numbers for a device-test leg (extrapolate: build ≈ our existing app build, run ≈ minutes not tens-of-minutes).

## 5. Bottleneck analysis (issue Q3)

Where our Appium wall time actually goes (measured above): restore/workload ~1–2 min
· app build 2–8 min (cached vs cold) · emulator/simulator launch 1–3 min ·
**WDA/Appium agent 2+ min on iOS** · per-test driver round-trips — the dominant
execution cost (~25–77 s/test) because every element lookup, scroll and source dump
is a network/USB hop · coverage pulls · artifact transfer/queue ~1 min.

A device-test layer changes the *execution* term drastically (in-process calls, ~0.5 s/test)
and removes WDA entirely on iOS. It does **not** remove emulator boot, app build or
workload install — those are shared costs. Critical-path wall time for an added
Android device-test leg ≈ existing Android leg shape (build ~2–8 min + emulator ~1–2 min + tests in seconds-to-minutes).

## 6. Feasibility against our infrastructure (issue Q4)

- **xUnit v3/MTP**: the runner is xUnit **2.9.3**; our suites are xUnit **v3 + MTP**. They coexist only as separate projects — a `BibleOnSite.DeviceTests` app referencing `xunit 2.9.3` + `IsTestProject=false`, exactly as upstream does (their csproj documents MTP rejecting non-MTP test projects otherwise). *Sources* could be shared only where assertions are API-identical (`[Fact]` basics) — plan for a small shared-source set, not wholesale reuse. FluentAssertions 8 targets both.
- **Results format**: XHarness emits xUnit v2 XML + an exit code — not MTP trx/JUnit. Needs an adapter step into our reporting/merge pipeline (or consume the XML directly — it carries per-test names/times already used by e2e-impact's evidence model).
- **Nuke**: new `TestDevice`/`DeviceTestsAndroid` targets, mirroring `RunMobileE2E` (`app/devops/Build.Test.cs`).
- **Selection/sharding**: upstream has only `Category=` filters — far coarser than our manifest selection + runtime-balanced shards. Our `e2e-impact` machinery works on xUnit sources and could target a device suite, but XHarness category plumbing would need a manifest→category bridge (or accept full-suite runs while the suite is small — the right first step).
- **Package/feed**: `Microsoft.DotNet.XHarness.*` ships only from the `dotnet-eng` Azure feed as `11.0.0-prerelease.*` — new `NuGet.config` feed + a pinned, periodically bumped prerelease dependency; already bumped once since the inspected head (§3).
- **Vendored runner upkeep**: ~70 files + source generator under MIT (attribution via `LICENSE-dotnet-maui.txt`); our PoC shows ~200 lines covers headless Android only. Adopting their full tree buys iOS/Catalyst/Windows + visual runner + tested runner fixes; hand-rolling buys less surface but re-owns maintenance. Recommend vendoring their trimmed headless subset with attribution, not the visual runner.
- **.NET 11 (#3335)**: upstream already builds with SDK 11 (`net11.0` TFM conditions; xharness package has `net11.0` assets). Our PoC ran on net10. Introducing the layer *during* the migration adds a moving part; stage Android first (works today), iOS alongside #3335.
- **Signing/packaging**: debug-signs itself for emulator/simulator; our packaged-app release smoke stays an Appium responsibility.
- **Security/supply chain**: prerelease feed dependency + vendored code — both pinnable and reviewable; no new external service.

## 7. Reliability & isolation (issue Q5)

- In-process tests share one app process: UI-thread access is via `MainThread`/`TestDispatcher` (PoC-verified); test-order/state leaks are possible — upstream mitigates with `PermanentGrantsLastOrderer`, capability probes that *skip visibly*, and an `EveryTestHasOneFeatureCategory` infrastructure test. A crashed app kills the run's results → their `SkipCategories` escape + explicit crash exit codes (80/94) keep it honest rather than silent.
- Android activity recreation mid-run is handled (`MauiTestActivity` single-pass guard — a bug they found and fixed); our PoC includes it.
- Appium's isolation is *stronger* per test (app process restart + session rebuild via `DeviceSessionDeath`/`DeviceTransportRecovery` machinery) — but it pays for it with the death/transport-loss flake classes the recovery code exists to absorb, plus WDA crashes. In-process eliminates the WDA/driver-transport flake class entirely; remaining flakes move to the device/app-under-test itself — the same class our Appium suite already carries.
- Watch out (issue's warning): an in-app layer that grows must not quietly trade skipped-per-capability for coverage — declare capabilities in CI env like upstream, and count skips in the report gate.

## 8. Options compared (issue Q2)

| Option | What it buys | Cost/risk | Verdict |
|---|---|---|---|
| Keep current architecture | zero churn | the handler/XAML/lifecycle gap stays; expensive UI assertions keep growing Appium time | insufficient |
| Selective improvements (better skips, infra-retry, capability declarations) | cheap reliability wins | doesn't reach new coverage | do regardless — adopt their *ideas* without the runner |
| **Add device-test layer (recommended)** | new coverage families at ~0.5 s/test; no WDA on iOS; complements e2e-impact selection | new project+feed+vendored runner; xUnit v2 island; results adapter | **adopt** |
| Full adoption (replace Appium) | none attainable — cannot drive the packaged app; loses install/startup/Release-smoke and genuine-journey coverage | — | **reject**; upstream's own design is library-testing, not product E2E |

## 9. Staged adoption plan

1. **Stage 0 — selective ideas now** (days): adopt capability declarations + infra-retry-only policy + "crashed app = visible failure" conventions in our Appium harness where missing. No new dependencies.
2. **Stage 1 — Android pilot layer** (one PR, post-research): `app/BibleOnSite.DeviceTests` (net-android first), vendored headless-runner subset + MIT attribution, pinned xharness local tool via dotnet-eng feed, ~10–20 tests covering the parity + device-only families demonstrated by the PoC (XAML inflate of a real page or control, RTL layout measures, handler registry, Preferences/FileSystem, popup/back in-app). New Nuke target + a CI leg beside `Appium Android` — *additive*, no existing job changed. Success metric: leg ≤ ~10 min wall including cold build, ≥95% non-infra pass rate over 2 weeks, per-test evidence XML consumed by reporting.
3. **Stage 2 — iOS leg with #3335**: xharness `apple test` on the xcode runners (drops WDA for this layer); evaluate Mac Catalyst as bonus coverage once the toolchain allows.
4. **Stage 3 — evaluate selectively**: migrate only scenarios that are device-but-not-journey (e.g., perush cell scroll survival) where the in-app version proves equivalent assertions; keep every genuine journey on Appium. Re-review flake rates after a month of data.
5. **Rollback**: the layer is a new project + one CI leg — deleting it restores status quo; no existing suite touched by Stages 0–2.

Non-goals: migrating portable unit tests, migrating Appium journey tests, the visual
runner, Windows device tests (FlaUI covers the Windows axis and upstream's own
Windows coverage path is the least complete part of their offering).

## Appendix — reproducible PoC

Pinned: `microsoft.dotnet.xharness.cli` + `Microsoft.DotNet.XHarness.TestRunners.Xunit`
`11.0.0-prerelease.26466.1` (dotnet-eng feed
`https://pkgs.dev.azure.com/dnceng/public/_packaging/dotnet-eng/nuget/v3/index.json`),
`xunit 2.9.3` + `xunit.runner.utility 2.9.3`, `Microsoft.Maui.Controls 10.0.120`,
SDK 10.0.403, maui-android 10.0.110. Emulator: `sdk_gphone64_x86_64`, API 36.

```bash
# tool (prerelease, dotnet-eng feed only)
dotnet tool install microsoft.dotnet.xharness.cli --tool-path ./tools \
  --version 11.0.0-prerelease.26466.1 \
  --add-source https://pkgs.dev.azure.com/dnceng/public/_packaging/dotnet-eng/nuget/v3/index.json

# build (Release embeds assemblies; Debug APKs crash: "No assemblies found")
dotnet build -c Release -p:AndroidPackageFormat=apk -p:RunAOTCompilation=false

# run
./tools/xharness android test \
  --app bin/Release/net10.0-android/com.bibleonsite.devicetests-Signed.apk \
  --package-name com.bibleonsite.devicetests \
  --instrumentation com.bibleonsite.devicetests.TestInstrumentation \
  --output-directory ./results --device-id emulator-5554 --timeout 00:05:00
```

The PoC source is committed under [`device-tests-poc/`](device-tests-poc/README.md)
(research code, not in the solution and not built by CI — deliberately kept out of
`app/` because the app NuGet-cache key hashes every `app/*.csproj`). It is a normal
single-project MAUI app (`net10.0-android`, `UseMaui`, `IsTestProject=false`) plus:
~240-line `Runner.cs` (TestDevice, HeadlessTestRunner extending
`AndroidApplicationEntryPoint`, `MauiTestActivity`, `MauiTestInstrumentation` with
the MediaStore results export), 4 entry-point classes (`[Application]`,
`[Activity MainLauncher]`, `[Instrumentation]`, `[Activity TestActivity]`), a
`MauiProgram` registering `TestOptions`/`HeadlessRunnerOptions`/`HeadlessTestRunner`
in DI, a `<Compile Include>` link to the production `PasukMarkerTextConverter.cs`
(the same file the portable suite links — linked, not copied) and
`Tests/DeviceTests.cs` (1 parity + 6 device-only tests). Upstream's generated code
produces the same manifest entries via source generator.
