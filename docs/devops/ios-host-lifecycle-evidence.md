# iOS host lifecycle evidence

What the iOS e2e legs capture on the macOS host while the suite runs, what the
bounded shutdown check measures, and how to reproduce it.

## Always-on capture (`run.mjs`, iOS legs only)

Three host-side observers start before the tests and are joined at the end of
the run (`stopNativeLogStreams`, five-second cap each):

| Artifact | Command | Purpose |
| -------- | ------- | ------- |
| `simulator-host-live.log` | `/usr/bin/log stream --style compact --level info --predicate <see iosHostLogArguments>` | Survives a device shutdown; records CoreSimulator service, Simulator app, `launchd_sim`, `simctl` and every `com.apple.CoreSimulator` subsystem client — the candidate requesters. |
| `simulator-host-classic-live.log` | `/usr/bin/tail -c +<offset> -F ~/Library/Logs/CoreSimulator/CoreSimulator.log` | CoreSimulator's plain-file log, started at a recorded byte offset (`*.source.json`). |
| `simulator-live.log` / `automation-live.log` | `xcrun simctl spawn <udid> log stream …` | Device-scoped app/WebDriverAgent records; these die with the device. |

## Bounded shutdown check (`verify-ios-host-log.mjs`)

Runs as the *Measure simulator host lifecycle evidence* step in
`app-mobile-e2e-runner.yml`, on `pull_request` and `merge_group` iOS legs once
the pilot and coverage steps succeed. It deliberately shuts down **only this
job's own device** — never `all`, never a device that fails the identity and
Booted-state guard — and measures what host logging retains. The job VM is
disposable; other simulators and jobs are untouched.

Stages (each with its own cap; see the file for exact bounds):

1. **target state query** — `plutil -extract {UDID,state}` on the job's
   `device.plist` (no `simctl list`, which blocks on service re-init).
2. **host logger startup** — the info-level contract stream, a **debug-level
   probe** on the same predicate, the classic file tail, and a per-device
   `~/Library/Logs/CoreSimulator/<udid>/system.log` tail when that file still
   exists on the image. Shutdown is only issued after every piped reader has
   printed its filter banner.
3. **environment capture** — `sw_vers`, `xcodebuild -version`, the device's
   persisted `runtime` key, and a best-effort
   `sudo -n log config --mode level:debug,persist:debug --subsystem
   com.apple.CoreSimulator` — emission and persistence are configured
   separately, so the post-hoc query can only test debug persistence when
   both are enabled (restored with `--reset` in cleanup, on its own budget
   so cancellation cannot strand it).
4. **owned simulator shutdown command** — `xcrun simctl shutdown <udid>` with
   the child pid and timestamps recorded (`request` field).
5. **shutdown state verification** — the persisted state must read `Shutdown`.
6. **observe service shutdown record** — a fixed five-second window.
7. **post-hoc log query** — `log show --last <window>s --style compact
   --info --debug --predicate <same>` into `<artifact>.posthoc.log`,
   recovering records a live stream can drop and testing the persistence
   configuration. The window is bounded to the measurement itself so an
   earlier shutdown of the same device cannot count as controlled evidence.

### Reading `simulator-host-shutdown-contract.log.measurement.json`

- `stateTransitionVerified` — the owned device provably went Booted → Shutdown
  under the recorded client (`request.command/args/pid/requestedAt/completedAt`).
- `sources` — shutdown-correlated lines **per source** (`unified`, `debug`,
  `classic`, `device`, `posthoc`). A line only counts when a lifecycle
  emitter (`CoreSimulatorService`, `DeviceHub`, `simulatord`, `launchd_sim`,
  …) names the UDID *and* a shutdown event — requester-side mentions are
  context, not proof (`shutdownEvidence`).
- `udidCorrelated` — per-source count of *any* record naming the device,
  regardless of vocabulary (what the OS chose to persist about it).
- `requestingClient` — observed records carrying the request pid
  (`simctl[pid]`, `peer[pid]`): presence of who connected, never proof of
  what they asked.
- `samples.shutdown` — bounded excerpts of the correlated lines themselves.
- `lifecycleRecordStatus` / `observation` — `observed` when a service
  shutdown record arrived inside the fixed window, `after-window` when only
  drained/post-hoc bytes retain one, `not-observed` when none exists.
- `collectionGap` — `true` when an augmented source retained a record the
  info-level contract missed; the limitation then calls for a collection
  correction rather than blaming the OS.
- `limitation` — `null` when the contract itself retained the record;
  otherwise states plainly that reason/requesting client are not established
  at the probed sources and levels.
- `environment` / `debugPersistence` — `sw_vers`, `xcodebuild -version`,
  device runtime, per-device log offset, and the debug-persistence attempt
  and restore outcome.
- `sourceSha`, `runId`, `host` — exact revision, run and host build.

### Reproduce

The check only runs in CI and only against this job's booted UDID — the guards
on `GITHUB_ACTIONS`, the event name and `MOBILE_PLATFORM` keep it from ever
shutting down an unrelated local simulator:

```sh
MOBILE_PLATFORM=iOS MOBILE_UDID=<booted-simulator-udid> \
MOBILE_E2E_ARTIFACTS=<artifact-dir> \
node app/mobile-e2e/verify-ios-host-log.mjs
```

(equivalently, re-run the *Measure simulator host lifecycle evidence* step on
any `pull_request`/`merge_group` iOS leg.) Artifacts land under
`$MOBILE_E2E_ARTIFACTS` and upload inside the `appium-ios-shardN-*` artifact:
`simulator-host-shutdown-contract.log` (+ `.debug.log`, `.classic.log`,
`.device.log`, `.posthoc.log`, `.measurement.json`).

## Findings on the measured image

macOS 26 (Darwin 27.0.0, `xcode-27` runner image, Xcode 27, iOS 27 simruntime),
first measured at `d5c9e2a` / run `43262338256`:

- The state transition is real and attributable (`xcrun simctl shutdown
  24E299B4-…`, pid observed). Both iOS shards produced identical results.
- **No** shutdown/lifecycle record for the UDID appears in the info-level
  unified stream or the classic `CoreSimulator.log` — and none appears in the
  ~25-minute full-run captures either. At info level the service emits only
  repeated `Failed to get a device identity` errors (MobileActivation −25)
  and XPC connection noise; privacy redaction shows as `<private>` payloads.
- The requesting client *is* observable, but only as presence:
  `CoreSimulatorService.peer[37166]` XPC endpoint records and
  `com.apple.CoreSimulator.simctl[37166]` client records — never an
  action-named shutdown record.
- Whether debug level, the subsystem-wide client predicate, the post-hoc
  `log show` sweep or a per-device `system.log` retains more is exactly what
  the strengthened measurement in this change reports per run; a true
  `collectionGap` surfaces as `::warning::` on the step.

Until a run shows `lifecycleRecordStatus: "observed"`, the documented
guarantee stays qualified: the helper proves the observer **survives** the
shutdown and retains the controlled trigger evidence, while the shutdown's
reason and requesting client are not established from the probed host
sources on this image.
