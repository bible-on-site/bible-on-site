# iOS Runner A/B Experiment (#2635)

Controlled comparison of `xcode-27` vs `namespace-profile-mac-os` for the Appium
iOS shards, per the reassessment's option-3 recommendation on
[#2635](https://github.com/bible-on-site/bible-on-site/issues/2635) (follow-up to
closed [#2312](https://github.com/bible-on-site/bible-on-site/pull/2312)).

## What the harness does

[`.github/workflows/app-mobile-e2e-ab.yml`](../../.github/workflows/app-mobile-e2e-ab.yml)
is `workflow_dispatch`-only and is **never called by `ci.yml`** — master CI is
untouched. Each dispatch ("iteration") runs:

1. **`plan_ios`** (ubuntu-latest) — identical selection/planning steps to
   `app-mobile-e2e.yml`, with `force_full_suite` (default on) so every
   iteration plans the same full-suite case manifest. It also resolves the leg
   order: **odd iterations run `xcode-27` as leg A, even iterations run
   `namespace-profile-mac-os` as leg A** — the alternation that cancels
   time-of-day/drift effects across the pair set.
2. **`build_ios`** — the shared `.app` is always built on `xcode-27`, so both
   legs of a pair restore the same build artifact
   (`app-mobile-e2e-build.<run>.ios`).
3. **`probe_namespace`** — a ~1-minute job on `namespace-profile-mac-os` that
   records `uname`/`sw_vers`/CPU/RAM/disk, `xcodebuild -version` after
   selecting `/Applications/Xcode_27.app` (the exact path every iOS leg
   hard-selects), and the simulator runtimes. It proves the Namespace pool
   still schedules for this repo and that its image carries the expected
   toolchain **before** any shard minutes are spent; both legs require it to
   succeed.
4. **`leg_a` then `leg_b`** — the planned shard matrix runs twice,
   sequentially: every shard on `runner_a`, then every shard on `runner_b`,
   each via `app-mobile-e2e-runner.yml` `mode: prebuilt-run` with the same
   `ios_plan_artifact`. `fail-fast: false`, `always()` guards — a failed leg
   is data, never blocks its pair partner.
5. **`report`** — writes `shards.csv` (one row per shard leg: iteration, run,
   attempt, leg, shard, runner labels, conclusion, run-created→job-start,
   job duration) into the `ios-ab-report.<run>.<attempt>` artifact (90-day
   retention, outlives the 14-day diagnostics artifacts).

A workflow-level concurrency group serializes iterations
(`cancel-in-progress: false` + `queue: max`), so every dispatch is kept and
queued runs execute one at a time instead of interleaving — a third
dispatch can no longer silently replace a still-pending iteration.

## Protocol (from the issue)

- **>=20 shard-pairs**: one pair = the same shard index executed on both
  runners within one iteration. The planner normally yields 2–3 shards per
  iteration, so expect **~7–10 iterations**. Dispatch with increasing
  `iteration` numbers until the CSVs cover >=20 completed pairs.
- **Same inputs for both legs**: identical `.app` artifact, identical shard
  manifests, identical Xcode/simulator selection, identical cache *reads*.
  All legs pass `publish_caches: false` (new input on
  `app-mobile-e2e-runner.yml`, default `true` — master behavior unchanged) so
  experiment legs write **no** Actions caches; this keeps a
  namespace-captured simulator state from ever being restored by `xcode-27`
  legs or master runs.
- **First attempts only** for the primary failure metric; reruns are recorded
  but excluded (the CSV carries `run_attempt`).
- **No loosened timeouts, retries, or manifest changes** mid-experiment.
- **Freeze the experiment ref**: do not push commits to the dispatched branch
  while collecting — every iteration must test the same SHA or the artifact
  and manifest are no longer comparable.
- **Pinned planning baseline**: `force_full_suite` fixes case selection, but
  the planner's timing-based shard count and membership still follow
  `--history`. The first iteration therefore republishes the latest master
  `app-mobile-e2e-coverage.master.ios` artifact under the SHA-scoped name
  `ios-ab-baseline.<experiment-sha>`; every later iteration on the same
  frozen ref downloads that pin instead of master's rolling baseline, so all
  iterations plan identical shards. Pushing a new commit starts a new pin —
  keep the ref frozen. To verify, compare `fingerprint` inside
  `ios-shard-plan.json` across iterations' `app-mobile-e2e-ab-plan.*`
  artifacts; identical pins yield identical fingerprints.

## Running an iteration

After this PR merges (the workflow must exist on the default branch before it
can be dispatched):

```bash
# Pick the experiment branch (the PR branch works; keep it frozen).
gh workflow run app-mobile-e2e-ab.yml --ref devin/2635-runner-ab -f iteration=1

# Watch it; the probe job is the early-warning gate.
gh run list --workflow app-mobile-e2e-ab.yml --limit 5
gh run watch <run-id>
```

- Verify the **probe** job succeeded and its `ios-ab-probe.*` artifact shows
  `xcodebuild -version` matching the `xcode-27` image's Xcode 27.x. A toolchain
  mismatch makes `restore-build` fail on every namespace leg — that is a
  valid (negative) experimental result, but check the probe first so you don't
  burn 20 pairs on a known-incompatible image.
- Repeat with `iteration=2,3,…` until >=20 pairs are collected. Iterations are
  automatically ordered xcode-first / namespace-first by parity.

## Collecting and classifying results

Per iteration, download the `ios-ab-report.<run>.<attempt>` artifact
(`shards.csv`) and keep the `appium-ios-shard<N>-leg<A|B>-<run>-<attempt>`
diagnostics artifacts for any failure. Classify each first-attempt failure
with the #2635 taxonomy (primary cause counted once):

| Category | Examples |
|---|---|
| Missing/wrong UI state | element condition waits, LINQ sequence-no-match |
| Artifact/toolchain/setup — pre-pilot | `Finish iPhone simulator setup`, `Prepare prebuilt iOS automation agent` (`spawnSync … ETIMEDOUT`, `simctl` crashes) |
| Artifact/toolchain — other | artifact download/upload timeouts, coverage-step kill |
| Unanswered WDA command / session startup | `mobileLaunchApp`/`POST /session` timeouts |
| Pilot deadline | 15-min wall clock / 20-min step timeout |
| Test-host shutdown / cleanup | app cleanup over budget |
| Unresolved | answered-but-wrong WDA errors, harness-synthesized actions |
| App/framework crash | crash signature in device.log |

Report per leg (runner label): first-attempt failure rate **by category**,
shard exec time (`job_duration_s`), run-created→shard-start (`queue_s`),
pilot wall (first shard start → last shard end per iteration), and
runner-minute cost if Namespace pricing is verifiable from the contract —
the CSV's per-leg durations are the runner-minute basis.

## Decision rule (from the issue)

- Reopen/reframe #2312 as a performance+reliability migration if Namespace
  shows materially lower **infra-class** failures (the artifact/toolchain,
  WDA-transport and deadline categories — roughly half of the window's
  failures) **and** preserves the measured speed win.
- Keep #2312 closed and pursue app/harness fixes plus setup hardening
  (bounded `download-wda` retries, `simctl` sanity check) if infra failures
  persist on both runners — the 13 missing-UI failures need app/harness work
  regardless of runner.
- Missing-UI failures are expected on both legs; they are not evidence for or
  against the runner.

## Abort criteria

- `probe_namespace` queues indefinitely → the `namespace-profile-mac-os`
  profile is no longer available to this repo (Namespace integration removed
  or profile deleted). Document and stop — do not substitute another label.
- Probe fails on missing `/Applications/Xcode_27.app` or an incompatible
  `xcodebuild -version` → the image drifted; re-validate before continuing.
- Repeated `restore-build` "build identity mismatch" failures on namespace
  legs only → toolchain skew; the legs cannot share the artifact, so the
  experiment as specified cannot run — record and escalate.
