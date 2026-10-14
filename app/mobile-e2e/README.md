# Appium mobile E2E pilot

The shared C# suite in `../BibleOnSite.Tests.MobileE2E` runs on Android and iOS.
CI creates one independent runner per matrix entry (`app-mobile-e2e.yml`), with
`fail-fast: false`, and requires every applicable result through the main CI gate. Tests
on an individual device run sequentially. The first session installs and resets
the app; later scenarios restart its process with their launch environment.
The install and built search index survive these restarts. Appium operates
the simulator headlessly.

WDA releases its session without terminating the app through XCTest. That
termination path can stall `DELETE /session` after all assertions pass and
trigger recursive Appium teardown. Once the harness exits, `run.mjs` terminates
only this app on the explicit simulator within five seconds, before exporting
logs. It reads app PIDs from that device's live stream, inspects only those PIDs,
and verifies their installed executable paths include the explicit device UDID
before signaling them. This avoids expensive host-wide process snapshots. Confirmed already-stopped apps are accepted; transport
and timeout failures fail the run. `MOBILE_KEEP_APP=1` retains the review app.
The existing 15-second session-delete and 15-minute pilot limits remain intact.

CI runs the complete iOS suite across three independent `xcode-27` runners,
each with one simulator and one shared Appium session. Each host has 3 CPUs and
7 GB RAM. `Shard=1|2|3` forms a disjoint 3/4/3 partition. The rapid verse-scroll
storm runs on runner 1 and the long-commentary storm on runner 2; the short
flyout case occupies the remaining reader-group slot. All ten iOS cases and
six Android shared cases remain. Each pilot keeps its 15-minute deadline. A final merge requires
successful evidence for the whole discovered suite, rejects duplicates, and
combines native line coverage and execution/automation evidence. Only a full
successful union can replace a trusted iOS baseline.

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

Optional sharding remains available on a host with sufficient resources (#2083):
`ios:boot` provisions a second same-model clone of the selected device when
`MOBILE_E2E_SHARD_COUNT=2`, and `npm run test:sharded` runs two `run.mjs`
children in parallel — each with its own `MOBILE_UDID`, Appium port
(`MOBILE_APPIUM_PORT`, 4723/4724), WebDriverAgent listen port
(`MOBILE_WDA_PORT`, 8100/8101 — simulators share the host loopback, so
concurrent WDA instances must not collide), artifacts subdirectory
(`<platform>/shard<N>/`) and disjoint `Shard` trait group (`MOBILE_E2E_SHARD`,
added to the `TestMobileE2E` filter by the Nuke target). Device one combines
CI groups 1 and 3; device two runs group 2, retaining the full disjoint suite.
Each iOS-applicable fact has exactly one CI group, inherited from its class or
assigned on the method. Android uses no shard filter and runs all six shared
cases. `ShardAssignmentTests` verifies every assignment, the ten-case union
and the 3/4/3 balance. `run-sharded.mjs` merges the per-shard
`coverage-evidence/` back into the top-level artifacts directory for the
coverage-tree collect step and fails if both shards produced the same test's
evidence.
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

The pilot runs under an independent 15-minute wall-clock supervisor, including
local harness builds and Appium setup. Cancellation stops the owned process
group and escalates after three seconds, including child processes left behind
by a terminated wrapper. Windows requires PowerShell 7 (`pwsh`); its native
.NET process-tree termination keeps the existing two-second command limit and
avoids the stalled `taskkill` query. `pilot-timing.json` records duration and
timeout status.
The sharded runner builds the harness once; its children use those outputs
without restoring or rebuilding. Commentary searches use the shipped index and
the ordinary 45-second deadline, including on a fresh install.

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
Every class runnable on iOS must also carry exactly one
`[Trait("Shard", "1")]` or `[Trait("Shard", "2")]` for optional sharding.
`ShardAssignmentTests` fails
the harness unit run when a class is left out.
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
validates restored AVD structure and confirms the emulator process exited
before any snapshot save. When manifest resolution fails, both keys degrade to
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
then run `npm ci` in this directory. Set `MOBILE_PLATFORM` to `Android` or `iOS`
and run `npm run build:app`. The build embeds assemblies in the Android x64
APK and completes the iOS arm64 simulator `.app` build.

Set `MOBILE_UDID` to a running device's identifier, then run `npm test` here.
On macOS, `npm run ios:boot` selects an available iPhone runtime no newer than
the selected Xcode SDK, boots it, and prints the identifier and `MOBILE_OS_VERSION`.
Set both for local iOS runs; CI exports them automatically. In CI,
`ios:boot:start` kicks the asynchronous boot right after Xcode selection —
it touches no `node_modules`, so it can run before `npm ci` — and
`ios:boot:wait` then runs as a `background: true` step once dependencies are
installed, overlapping the readiness monitor and Appium bridge preflight with
the MAUI workload install and the app build. A `wait` step before the tests is
the gate that surfaces the finished boot and the exported variables. The
coverage-tree baseline download and test selection also run as one background
step — the baseline REST fetch sees 1s–2m20s transfer variance, so it never
stalls `npm ci`, the boot or the build; each pilot waits on the manifest
through `wait`/`wait-all`.
`MOBILE_APP_PATH` can select another compatible build. Each local
run owns an Appium server on `127.0.0.1:4723` (override with
`MOBILE_APPIUM_PORT`); keep that port free. To reproduce the CI shard split
locally, run `MOBILE_E2E_SHARD_COUNT=2 npm run ios:boot` to provision both
simulators, then `npm run test:sharded`.

Set `MOBILE_KEEP_APP=1` to keep the installed app and its data for manual review
after a local run. The runner installs the current build while preserving that
data; normal runs still reset the app. The floating search scenarios cover a
misspelled chapter reference, unpointed verse text, and inline commentary jumps.
Android system Back and the iOS edge-back gesture restore the original query,
filters, results, and list position. Verse results remain usable while the first
commentary index continues preparing.

`npm run test:unit` checks simulator selection and the locked driver module's
ESM loading without a device.
From `app/`, `dotnet run --project devops -- TestMobileE2EUnit` checks platform
configuration and device capabilities without a device or mobile workload.

Screenshots are captured for each scenario. Failed scenarios also save native
view trees; content assertions still inspect the complete native tree.
These captures are saved alongside
timestamped Appium and device logs, TRX and JUnit reports, under `app/.artifacts/mobile-e2e/<platform>`
(`shard<N>/` subdirectories when the iOS suite runs sharded, with merged
`coverage-evidence/` at the top level).
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
`MOBILE_E2E_SELECTION=<manifest>` narrows `dotnet test` through a
FullyQualifiedName filter for enforce mode and local experiments.

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

CI runs the shared iOS build on three independent devices: three shared cases on
shard 1, four iOS-specific cases on shard 2, and three shared cases on shard 3.
The merge requires all three artifact inputs and the full ten-case disjoint union.
Each device retains its startup coverage dump (13 dumps for the complete suite).
Local two-device `test:sharded` combines groups 1 and 3 on its first device; Android
continues to run all six shared cases. Both scroll storms use at most two flicks
per request, retaining 80 pasuk flicks and 40 commentary flicks.

Large commentary accessibility frames are measured once per document/width in a
detached background CoreText layout. Native accessibility snapshots read those
cached frames and the live viewport transform; rotation and recycled-document
completions cannot apply stale geometry. Spoken sections and links remain complete.
