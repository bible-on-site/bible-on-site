# Appium mobile E2E pilot

The shared C# suite in `../BibleOnSite.Tests.MobileE2E` runs on Android and iOS.
CI creates one independent runner per matrix entry (`app-mobile-e2e.yml`), with
`fail-fast: false`, and requires every applicable result through the main CI gate. Tests
on an individual device run sequentially. On Android the pilot installs the
app itself with a deterministic `adb install --no-incremental` — IncFS
incremental installs can crash Xamarin in libmonodroid's open_from_bundles
(#2773) — and sessions reuse that install under noReset; a driver-initiated
install has no incremental opt-out. On iOS the first session installs and
resets the app. Later scenarios restart the app's process with their launch
environment. The install and built search index survive these restarts.
Appium operates the simulator headlessly.

WDA releases its session without terminating the app through XCTest. That
termination path can stall `DELETE /session` after all assertions pass and
trigger recursive Appium teardown. Once the harness exits, `run.mjs` terminates
only this app on the explicit simulator within five seconds, before exporting
logs. It reads app PIDs from that device's live stream, inspects only those PIDs,
and verifies their installed executable paths include the explicit device UDID
before signaling them. A small helper is compiled before testing and reads only
kernel BSD state and the actual executable path. It does not inspect Mach tasks,
threads or mutable command arguments; even a PID-limited `ps` stalled past five
seconds on a loaded Mac. The native ownership regression also rejects an argv
prefix impersonating the app. This avoids expensive process snapshots. Confirmed already-stopped apps are accepted; transport
and timeout failures fail the run. `MOBILE_KEEP_APP=1` retains the review app.
The existing 15-second session-delete limit and the pilot deadline (below) remain intact.

CI runs the iOS suite across a dynamically planned set of independent
`xcode-27` runners, each with one simulator and one shared Appium session
(#2263). Before the matrix expands, the `plan_ios` job discovers the suite
statically, resolves the diff against the published coverage baseline, and
partitions the selected cases with a deterministic longest-processing-time
assignment balanced by the baseline's rolling per-case runtimes — unmeasured
cases take a fixed fallback weight and never narrow membership. The shard
count is the fewest runners whose estimated work fits a 26-minute per-runner
capacity (bounded by four): macOS runners are the queued, scarce resource and
each extra shard repeats about six minutes of setup, so today's full suite runs
on one runner and a legitimately empty selection starts no simulator at all.
Each runner executes exactly the case manifest it was assigned — it never
re-selects — under a deadline of 1.5 × its planned estimate + 5 minutes,
clamped to 15–45 minutes. A final merge requires each shard's executed manifest to
match its assignment, requires successful evidence for the whole planned run
set exactly once, rejects duplicates, and combines native line coverage and
execution/automation evidence. Only a full successful union can replace a
trusted iOS baseline.

A separate iOS build host restores MAUI and compiles/signs the app once, without
booting a simulator. All three device hosts receive the same archive, including the
prebuilt Debug harness/build tool and the exact OpenCover template. The archive
preserves executable modes and framework symlinks; its SHA256, source SHA,
checkout path and toolchain must match before extraction, and each host strictly
verifies the simulator signature before launch. Device hosts need the .NET SDK and run the delivered tool and test DLLs
directly, without project evaluation, MAUI restoration or app compilation.
A preflight discovers the device's exact scenarios through the production
launch path, then runs all harness unit cases with an empty NuGet cache. That
cache remains empty during native testing and coverage application.
Simulator/WDA preparation overlaps archive transfer. Android has no dependency
on the iOS builder. All pilot, interaction and watchdog budgets stay unchanged.

Shard timing history rides the same trusted baseline as the coverage tree
(#2263): the merge rolls each case's measured duration (JUnit report first,
evidence spans as fallback) and the mean per-shard non-case pilot overhead
into the tree, and only a complete successful master run publishes it. A
missing baseline simply leaves every case unmeasured — planning still runs at
the deterministic fallback weight and history accrues from normal execution.
`run-sharded` splitting on one host was removed with the fixed trait groups:
each shard is its own matrix job, so ports, devices and artifact roots are
isolated by the runner itself rather than by env offsets.
Before iOS tests, Appium downloads the official simulator WebDriverAgent matching
the locked driver dependency and launches it directly. This keeps cold Xcode
compilation outside session startup; `bun run test` also prepares the agent locally.
See the [Appium prebuilt-agent guide](https://appium.github.io/appium-xcuitest-driver/latest/guides/run-prebuilt-wda/).

The pilot covers packaged scripture and bottom navigation, adjacent perek
navigation with matching source **and** pesukim, and native flyout/preferences
navigation back to the original perek. The Debug app points to a closed local
endpoint for this pilot, so startup exercises offline behavior without relying
on production or an external API. The build restores any local API override
after packaging. Canonical content comes from the existing packaged database.

The pilot runs under an independent wall-clock supervisor (15 minutes, or the
planned shard deadline above), including
local harness builds and Appium setup. Cancellation stops the owned process
group and escalates after three seconds, including child processes left behind
by a terminated wrapper. Windows uses the in-box `taskkill /T` tree kill as
the fast path; when it reports a stalled or already-exited root, a detached
`powershell` CIM walk reaps the descendants (including orphans whose parent
died first) and reports live survivors on stderr. `pilot-timing.json` records duration and
timeout status.
Commentary searches use the shipped index and
the ordinary 45-second deadline, including on a fresh install.

## Android Release startup smoke (#2373)

The Appium legs build Debug, which defines `DISABLE_ANALYTICS` — so the suite
can never execute the `MainActivity.OnCreate` analytics initialization whose
missing `FirebaseAnalyticsImplementation.Initialize` crashed every #2247
store launch while all tests stayed green. The `android_release_smoke` leg
closes that gap: `bun run build:release-smoke` builds the **Release** pipeline
(profiled AOT, R8, embedded assemblies, merged manifest, analytics branch
compiled in) as an x86_64 APK — the ABI the CI emulator can run — and
`bun run release-smoke` installs and launches it on the same cached AVD.

Each launch must reach a genuinely usable reader (the same `PerekSource`
readiness the Appium `WaitForStartup` uses), keep the process and foreground
activity alive past the original crash window, and print
`[Analytics] collection enabled=false`. That line proves the Release branch
ran `Initialize` + `set_IsAnalyticsCollectionEnabled` — the exact member that
NRE'd — while keeping suite traffic out of production analytics (#2120); a
missing marker, `enabled=true`, or the `DISABLE_ANALYTICS` build line each
fail the leg. Phases: install plus `pm clear` for a true cold start with the
`BIBLE_E2E` intent extra, a force-stop relaunch over retained data (the
persisted marker file holds isolation — adb relaunches drop extras), and an
`install -r` reinstall followed by another verified launch. Scoped logcat, UI dumps, screenshots,
`build-manifest.json` (SHA256, source SHA, config) and
`release-smoke-summary.json` land in the run artifacts on failure and success.

Known differences from the store-delivered artifact: APK/x86_64/debug-key
signature here vs AAB/arm64/Play signing there — the compiled startup code
path, AOT profile, R8 output and manifest merge are the same. The leg runs on
API 36 `google_apis` x86_64 like the Debug Android leg; arm64 physical-device
coverage remains open in #2371.

Run it locally against a booted emulator with `MOBILE_UDID=emulator-5554`:

```bash
bun run --cwd app/mobile-e2e build:release-smoke
MOBILE_RELEASE_APK=<staged-apk> bun run --cwd app/mobile-e2e release-smoke
```

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
Cases need no shard traits: the CI planner partitions the discovered iOS suite
itself and hands each runner its case manifest (#2263).
Use `[Collection("Mobile device")]` on every mobile test class to serialize
scenarios that own the same device. Inject `MobileDeviceSession`; this collection
fixture owns one driver and releases it after the last scenario. The session
factory latches uncertain startup or cleanup failures. If either fails in a
way that could leave Appium working on the device, subsequent scenarios fail
without requesting another session on it; the original failure remains in the
test report. Failures matching `DeviceSessionDeath` mean the session is already
gone server-side, so they do not block the collection.

iOS waits for XCTest's `hittable` attribute before actions and sends one W3C touch
at the element's viewport center, with a 100 ms pause between down and up. This
exercises the real touch target of rounded floating controls while avoiding
XCTest's automatic hit-point selection. Native device logs record menu press,
release, click and completed animations to diagnose touch delivery. Android uses
native element clicks. UI assertions and readiness deadlines remain shared.
The startup gate requires a visible, nonempty perek source within the same
45-second deadline as ordinary scenario lookups and navigation. A failure
captures device diagnostics.
iOS disables XCTest idle checks (`waitForIdleTimeout` 0): every proxied WDA
command otherwise waits for the app main thread to stay quiet for the whole
threshold, which a reader that keeps re-rendering commentary cells (or a
navigation animation on a shared-CPU runner) never satisfies — queries stalled
for tens of seconds and once hit the 240s proxy timeout mid-scroll. Page objects
poll explicit element state instead of relying on implicit synchronization. See
the [Appium idle-wait capability](https://appium.github.io/appium-xcuitest-driver/latest/reference/capabilities/).
A session the device already dropped mid-startup or mid-scenario is recreated
once; ambiguous startup or cleanup failures still block the device, since stale
session work could race a replacement.

The pilot matrix deliberately covers Android and iOS. Existing Windows FlaUI
tests and Android gesture regressions remain separate. Additional device/OS
entries can reuse the same suite; each must own its emulator and artifacts.

## Android emulator caching

The Android job caches two layers so a truncated Google download cannot abort a
run before testing (as in run 37814563700):

1. **SDK packages** (`android-sdk-<os-tag>-<arch>-<components>`): `$ANDROID_HOME`'s
   `emulator`, `platform-tools`, `platforms;android-36`, `build-tools;37.0.0`
   and the `google_apis` x86_64 system image — about 2.3 GB. The key embeds each
   package's stable-channel revision and archive checksum resolved from
   Google's SDK manifests by `devops/github/ci/android-sdk-manifest.mjs`, so a
   Google-side update produces a fresh key instead of reviving a frozen copy.
   `package.xml` files ride inside the cached directories, letting sdkmanager
   recognize the restored packages. A one-level `android-sdk-<os-tag>-<arch>-`
   restore-key intentionally permits an older emulator revision: sdkmanager
   updates it in place while the large system image stays cached.
2. **Clean AVD snapshot** (`android-avd-<os-tag>-<arch>-api36-google_apis-x86_64-pixel_7-swiftshader-<emulator-rev>-<build>-<sha>-<recipe>-<readiness-hash>`):
   `~/.android/avd` after a cold boot that ran only the device readiness check —
   never the app install, an Appium session, commentary packaging, or test
   output. There are no restore-keys: a snapshot under different coordinates is
   worse than a cold boot. On a miss the workflow runs the documented two-stage
   pattern — a snapshot-creating invocation whose `script` is `android:ready`,
   then the pilot, which boots the saved `default_boot` quick-boot state with
   `-no-snapshot-save`.

Only `push` and `workflow_dispatch` runs save caches, so the default branch
publishes and pull requests restore (forks get no write scope), matching
GitHub's cache isolation rules. Saving is gated on validation: the SDK cache
requires a genuinely booted device (the shared `device-readiness.jsonl`
marker), and the AVD cache requires the persisted `snapshots/default_boot`
payload. Cache keys are immutable: a corrupt entry detected on restore is
deleted locally and rebuilt cold, then heals after natural eviction or a recipe
bump. `android-sdk-install.mjs` removes corrupt package directories before
bounded sdkmanager retries and forces a clean reinstall when `emulator
-version` fails despite installed metadata; `android-snapshot-check.mjs`
validates restored AVD structure. Before reuse and cache publication it requires
successful process-table and ADB device-list inspections proving the selected
AVD is stopped. Only then does it log and remove that AVD's root-level `*.lock`
entries, including `snapshot.lock.lock`; snapshot payload and configuration stay
intact. These locks contain host-local ownership state, so importing a PID from
another runner can prevent a valid snapshot from booting. Active or unknown
ownership blocks cleanup and cache publication. Shutdown keeps its existing
deadlines and signals only validated emulator PIDs. When manifest resolution
fails, both keys degrade to
`unresolved`, which always misses and never saves — the run falls back to the
original download path. Maintenance: bump `AVD_SNAPSHOT_RECIPE` when boot
options, device profile, readiness flow or the runner-action version change;
bump nothing else by hand — emulator and system-image updates rotate keys on
their own.

## MAUI workload caching

Both legs cache the workload payload under `$DOTNET_ROOT` (`packs`,
`metadata`, `sdk-manifests`, `template-packs`) under
`<os>-<arch>-dotnet-<sdk>-<workload>-<set>` — the `dotnet workload install`
download is a multi-GB silent NuGet fetch (~6 min cold), and restored packs
turn the install into a verify no-op. Exact key only: a partial restore is
worse than downloading. `DOTNET_SDK_VERSION`/`MAUI_WORKLOAD_SET` are the single
source for the pins shared by setup-dotnet, the toolchain id and the install.
Saves run in the background on `push`/`workflow_dispatch` misses.

## iOS simulator state caching

The iOS leg caches `~/Library/Developer/CoreSimulator/Devices/<udid>` under
`macOS-ios-sim-<udid>-<toolchain>-<recipe>`. The runner image bakes a fixed
device UDID per image version, so the key self-invalidates on every image
update, and the toolchain stamp covers updates that keep the UDID; there are
no restore-keys, since another device's state must never load over this one.
`ios:boot:resolve` runs the same selection as the boot path — without the
runtime download — and emits the UDID before restore, and `selectSimulator`
breaks name+runtime ties on UDID so resolve, boot and capture always agree.

Restoring a previously booted device skips the multi-minute first-boot
provisioning inside `simctl boot`. Capture runs post-test through
`ios-sim-state.mjs quiesce`: it removes the test app and WebDriverAgent so the
saved state stays clean (a leftover app could make Appium skip reinstalling the
fresh build), then shuts the device down so the directory is a consistent
Shutdown image rather than a mid-write Booted one. Only a fully Booted device
whose UDID matches the resolved key is captured — a runtime download, a
deregistered device or an unfinished boot all degrade to `saved=false` and the
run simply falls back to a cold boot next time. Saves follow the same
push/`workflow_dispatch` publishing rule as the Android caches; pull requests
only restore. Bump `IOS_SIM_STATE_RECIPE` when the capture or restore semantics
change.

## Running locally

Install the platform's .NET MAUI workload, Android SDK/JDK or compatible Xcode,
then run `bun install --frozen-lockfile` in this directory. Set `MOBILE_PLATFORM` to `Android` or `iOS`
and run `bun run build:app`. The build embeds assemblies in the Android x64
APK and completes the iOS arm64 simulator `.app` build.

Set `MOBILE_UDID` to a running device's identifier, then run `bun run test` here.
On macOS, `bun run ios:boot` selects an available iPhone runtime no newer than
the selected Xcode SDK, boots it, and prints the identifier and `MOBILE_OS_VERSION`.
Set both for local iOS runs; CI exports them automatically. In CI,
`ios:boot:start` runs after helper validation and kicks the asynchronous boot,
then emits the selected device's `udid` and runtime `version` as step outputs.
`ios:boot:wait` receives that exact identity through `MOBILE_UDID` and
`MOBILE_OS_VERSION`, validates the handoff against the selected Xcode SDK, and
monitors that device without listing or selecting simulators again. Its
`background: true` step overlaps readiness and Appium bridge preflight with
remaining build transfer and setup. A `wait` step before the tests surfaces the
finished boot and exported variables. Standalone wait without a handoff still
selects a real available device; a partial or invalid handoff fails. Both boot
steps retain their output in `ios-boot-start.log` and `ios-boot-wait.log` so
setup failures are included in the diagnostic artifact. The
coverage-tree baseline download and test selection also run as one background
step — the baseline REST fetch sees 1s–2m20s transfer variance, so it never
stalls `bun install --frozen-lockfile`, the boot or the build; each pilot waits on the manifest
through `wait`/`wait-all`.
`MOBILE_APP_PATH` can select another compatible build. Each local
run owns an Appium server on `127.0.0.1:4723` (override with
`MOBILE_APPIUM_PORT`); keep that port free. To reproduce one CI shard leg
locally, download the run's `app-mobile-e2e-plan.<run-id>.ios` artifact and
set `MOBILE_E2E_SELECTION` to the shard's `shards/shard-N.json`.

Set `MOBILE_KEEP_APP=1` to keep the installed app and its data for manual review
after a local run. The runner reinstalls the current build while preserving
that data; normal runs replace the package entirely. The floating search scenarios cover a
misspelled chapter reference, unpointed verse text, and inline commentary jumps.
Android system Back and the iOS edge-back gesture restore the original query,
filters, results, and list position. Verse results remain usable while the first
commentary index continues preparing.

`bun run test:unit` checks simulator selection and the locked driver module's
ESM loading without a device.
From `app/`, `dotnet run --project devops -- TestMobileE2EUnit` checks platform
configuration and device capabilities without a device or mobile workload.

Screenshots are captured for each scenario. Failed scenarios also save native
view trees; content assertions still inspect the complete native tree.
These captures are saved alongside
timestamped Appium and device logs, TRX and JUnit reports, under `app/.artifacts/mobile-e2e/<platform>`
(each iOS shard runner uploads its own artifact — including the executed
`case-manifest.json` — and the merge produces the combined top-level
`coverage-evidence/`).
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

## Coverage evidence and impacted-test selection

Each scenario writes a `coverage-evidence/*.json` record into the artifacts
directory — the automation ids it queried through `Platform.AutomationId` and
the sessions attributed to it. CI collects these into a per-platform coverage
tree (`app-mobile-e2e-coverage.master.<platform>` on master pushes) and the
`devops/github/ci/e2e-impact` selector maps the accumulated diff onto the
affected tests; per-file structural fingerprints persisted in the tree let
comment/formatting-only edits resolve as `unchanged-structural` instead of
invalidating coverage. Selection currently runs in shadow mode — the manifest is
reported while every test still runs — until evidence supports enforcement;
see [docs/tests/app/e2e-impact.md](../../docs/tests/app/e2e-impact.md).
`MOBILE_E2E_SELECTION=<manifest>` narrows `dotnet test` for enforce mode, for
a shard's assigned case manifest (#2263), and for local experiments.

## Dependency security

The `shell-quote` override replaces the non-bundled copy pinned by Appium support
with 1.12.0, which fixes command injection involving a line terminator after a
comment token. The pinned Android 8.7.0 and iOS 12.17.3 drivers still contain bundled shell-quote 1.10.0;
Android also bundles other vulnerable packages. npm overrides do not replace
those bundled files. Keep their alerts visible and follow
[#1995](https://github.com/bible-on-site/bible-on-site/issues/1995) for patched
upstream distributions. Verify nested copies after every driver upgrade.

On iOS, a command pending for 25 seconds records `native-hang-command.txt`
and requests one CoreSimulator frame in `native-interaction.png`, with the
existing five-second capture deadline. This is an observation while the
ordinary interaction deadline remains 45 seconds: a successful 42-second
lookup must not be treated as a failed test. A failed frame probe retains an
error artifact without replacing the test result. Process queries and LLDB
stack capture run only after a failed pilot, never alongside healthy tests.
Native live logs use info level so accessibility debug logging does not
amplify the workload being measured. Pilot and interaction limits are unchanged.

The Android CI action runs `android-pilot.mjs`, which retains the same supervised
pilot and exit code. After app coverage and logs are exported, it ends only the
explicit AVD/port's `-no-snapshot-save` QEMU process and its descendants, confirming
exit within five seconds. This disposable test device has no snapshot to flush;
clean snapshot creation retains its separate graceful shutdown path. Cleanup
failures fail CI and `android-emulator-cleanup.json` records the process IDs and
duration. The SDK package directories are assigned to the runner before restoring
their cached modes, avoiding root-owned directory extraction failures.

CI runs the shared iOS build on the dynamically planned shard legs: each
runner's cases come from its assigned manifest, so groupings follow measured
runtimes rather than a fixed partition (#2263). The merge requires one
artifact per planned shard and a disjoint union covering the whole planned
run set. Each device retains its startup coverage dump. Android continues to
run all six shared cases on one leg. Both scroll storms use at most two flicks
per request, retaining 80 pasuk flicks and 40 commentary flicks.

Large commentary accessibility frames are measured once per document/width in a
detached background CoreText layout. Native accessibility snapshots read those
cached frames and the live viewport transform; rotation and recycled-document
completions cannot apply stale geometry. Spoken sections and links remain complete.

If xUnit reports that foreground threads remain after the test summary, the
runner records live managed stacks from this run's registered harness processes
under `test-host-diagnostics`. The capture shares five seconds inside xUnit's
existing ten-second exit guard; it does not alter the process's exit code or
retry a failed run. MTP lifecycle logs travel with the test results.

The device harness delivers xUnit results synchronously, so its reporting worker
cannot outlive the sequential device collection. The required prebuilt
`testconfig.json` travels with the runtime. Before native scenarios, each host
verifies real managed stacks with default and synchronous reporting, then proves
that a deliberate foreground leak still triggers xUnit's original fatal guard
and is captured. This explicit probe does not enter the native or unit selections.
