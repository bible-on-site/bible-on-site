# iOS shard reliability reassessment (#2635)

Reassessment of first-attempt iOS shard failures on master and the controlled
`xcode-27` vs `namespace-profile-mac-os` comparison, per
[#2635](https://github.com/bible-on-site/bible-on-site/issues/2635)
(follow-up to closed [#2312](https://github.com/bible-on-site/bible-on-site/issues/2312)).

**Verdict: keep #2312 closed — no runner migration yet.** The failure problem
persists (11.5% of executed first-attempt shards) but is heterogeneous;
Namespace did not demonstrate a reliability benefit in 20 controlled pairs
(0 vs 1 infra-class failure — noise). Namespace *is* ~3.4x faster per shard
and ~2.4x faster dependency-ready→leg-done, so a performance migration stays
plausible — see [Recommendation](#recommendation) for the short re-verification
prescribed before swapping.

## Scope and method

- **Window**: Continuous Integration (`ci.yml`, workflow `105623149`)
  master-push runs created **2026-10-25 00:00 through 2026-11-07 23:59
  Asia/Jerusalem** (inclusive). Run `created_at` is UTC; bounds were applied
  after conversion (Jerusalem was UTC+3 through Oct 25, UTC+2 after the DST
  transition — the two earliest runs, created Oct 24 ~21:00Z, are inside).
- **Run set**: 381 runs fetched via `gh run list`/`gh api` with full
  pagination; per-run jobs enumerated through all `/jobs` pages
  (`per_page=100`), so late-created shard sub-jobs are not truncated.
- **Unit of analysis**: first-attempt `Appium iOS shard N / iOS prebuilt-run
  shard N` jobs. Workflows that planned zero shards, or whose shards were
  skipped/cancelled before running, are counted separately and never enter
  the denominator.
- **Experiment**: 10 `app-mobile-e2e-ab.yml` dispatch iterations on the
  frozen SHA `4c99f0eff051eb050db713e989c2ea3107c58d9a` (branch
  `exp/ios-runner-ab-frozen`), 2 shards each → **20 same-shard runner pairs**.
  Protocol per the [A/B runbook](../ios-runner-ab-experiment.md): same `.app`
  artifact built on `xcode-27`, same pinned plan/manifest, same Xcode
  (`/Applications/Xcode_27.app`) and iPhone 17 / iOS 27.0 simulator, cache
  reads shared, `publish_caches: false`, leg order alternated by iteration
  parity, first attempts only.
- **Classification**: every first-attempt failure was assigned one primary
  cause from job logs (failed-test XML/TRX and test-host diagnostics where
  retained), using the issue taxonomy. Downstream symptoms (diagnostics
  capture failures, cleanup warnings after the deciding error, expected-error
  lines printed by the runner's own unit tests) are not counted.

## Master window results (all `xcode-27`)

381 master runs → 139 runs reached the iOS E2E stage → **133 runs executed at
least one shard** (6 runs had only never-started shard placeholders).

| Measure | Count |
|---|---|
| First-attempt shard jobs that ran | **312** |
| — succeeded | 271 |
| — failed | **36** |
| — cancelled mid-flight (excluded from the rate denominator) | 5 |
| **Failure rate over non-cancelled first-attempt shards** | **36/307 = 11.73%** (36/312 = 11.54% if cancelled shards are counted) |
| First-attempt shard jobs skipped before start | 6 |
| Rerun shard attempts (`run_attempt` > 1) | 3 (all passed; one manual full-workflow rerun of an already-green run, `41491927041`) |

Failure rate vs. the prior Oct 15–22 audit (14/156 = 8.97%): worse, not
better — the app/toolchain fixes that landed did not eliminate the tail.

### Category breakdown (primary cause, one per failure)

| Category | n | Share | Representative evidence |
|---|---|---|---|
| Artifact/toolchain/setup — **pre-pilot** | 14 | 38.9% | `spawnSync …/node ETIMEDOUT` and `spawnSync xcrun ETIMEDOUT` during host setup (12 jobs, Oct 26–29 cluster); `xcrun simctl` boot abort `SIGABRT` on `devicePair` (1); artifact download exhausted 5 retries + `ENOTFOUND` (1) |
| Missing/wrong UI state | 13 | 36.1% | Element condition waits on `PerekSource` (6), `SearchResultTitle` (3), `PerekSearchInput` (2), `CommentaryTextSection` (1); LINQ `Sequence contains no matching element` (1) |
| Unanswered WDA command / session startup | 3 | 8.3% | `mobileLaunchApp` silent 120s; `POST /session` HTTP timeout 300s; `getPageSource` silent 120s → 20-min step timeout |
| Artifact/toolchain — **post-pilot** | 3 | 8.3% | Tests passed, then `Failed to CreateArtifact: ENOTFOUND` (2); `CoverageMobileE2E` target process exit 137 (1) |
| Pilot deadline | 1 | 2.8% | 15-min wall-clock deadline, pilot exit 124, no test summary |
| Test-host shutdown/cleanup | 1 | 2.8% | Tests passed; iOS app cleanup exceeded its 5s budget → run exit 1 |
| Unresolved | 1 | 2.8% | `Invalid parameter not satisfying: point.x != INFINITY` — answered-but-wrong WDA coordinate error |

**Infra-class failures** (toolchain/artifact + WDA-transport + deadline, per
the runbook definition): **21/36 = 58%**. Missing/wrong-UI failures are
app-side and runner-agnostic.

## A/B results (frozen SHA `4c99f0e`, 20 pairs)

Run IDs: `42870971025`, `42887112344`, `42907049970`, `42907054774`,
`43650238678`, `43650242025`, `43650244521`, `43650246978`, `43650249297`,
`43650251753`. Dataset: [ab-legs.csv](ab-legs.csv).

### Reliability (first attempts)

| Runner | Failed legs | Categories |
|---|---|---|
| `xcode-27` | **3/20 (15%)** | missing-UI ×1 (`SearchResultTitle` 45s), WDA session-start ×1 (preinstalled WDA failed to start in 180s, all tests blocked), test-host shutdown ×1 (tests passed 22m; scenario-failure handoff channel failed) |
| `namespace-profile-mac-os` | **5/20 (25%)** | missing-UI ×5 — **all one root cause**, below |

Infra-class split: `xcode-27` 1/20, `namespace` 0/20 — not a material
difference at n=20 (the runbook's reliability criterion for reopening is
**not** met).

**The Namespace cluster is a fixed harness bug, not a runner defect.** All 5
Namespace failures throw `StaleElementReferenceException` on the *live*
`.Text` read of a resolved `PasukText` element inside
`PerekPage.get_FirstPasuk`, called from `WaitForFirstPasukOffTop`
(`PerekReselectScrollTests.cs`). At the frozen SHA,
`FirstPasuk => WaitFor("PasukText", …).Text` re-read text from the returned
live element after the wait — racy whenever the collection rebuilds between
lookup and read, and hit far more often on the faster runner (4/5 hits in
`ReselectingTextTabAfterChapterChangeScrollsOnlyTheCurrentPerek`, 1/5 in
`ReselectingTextTabReturnsTheActivePerekToItsFirstPasuk`; stack:
`AppiumElement.get_Text` ← `PerekPage.cs:58` ← `WaitForFirstPasukOffTop`).
Current master already carries the fix: `f5f9dadb3` (#3311, merged
2026-11-13) introduced `WaitForText`, which captures text from the
snapshot-backed condition element *inside* the poll — no live property call.
Same-class live reads still exist (`ReadFrame(first)` in the same test file,
`WaitFor(…).Enabled/.Location` at `IosReaderTests.cs:21`,
`PerekPilotTests.cs:173,288`, settings rows) — worth hardening regardless of
runner.

### Speed

`job_duration_s` is the full shard job (restore + setup + pilot + coverage +
upload); `queue_from_dependency_s` is per-shard wait measured from when the
leg could start (leg A: shared build completion; leg B: leg-A shard
completion — because legs serialize, this isolates the *runner pool* wait
from experiment serialization).

| Metric | `xcode-27` (n=20) | `namespace` (n=20) | ns vs x27 |
|---|---|---|---|
| Shard job duration, median | 1657.5s (27.6m) | **482.5s (8.0m)** | **3.4x faster** |
| Shard job duration, mean | 1602s | 581s | 2.8x faster |
| Runner queue wait, median | 559s | 421.5s | ~equal |
| Runner queue wait, mean | 1147s | 357s | shorter tail on ns |
| Wait + run (queue + duration), median | 2203.5s | **938.5s** | **2.3x faster** |
| Leg wall (dep-ready → last shard end), median | 2441s (40.7m) | **1024s (17.1m)** | **2.4x faster** |

The speed advantage is large and consistent with the earlier single-sample
observation (58.7% lower native test duration). Note the pool-queue nuance:
later experiment iterations serialized behind each other, but the
dependency-based queue measurement above isolates real runner-pool waits —
`xcode-27` shard waits hit a 60-minute tail once (shared hosted pool under
repo CI load); Namespace waits stayed ≤ ~17 minutes.

### Cost

Not evaluated — no verifiable Namespace pricing/usage evidence. The
per-runner `job_duration_s` sums are the runner-minute basis if pricing
becomes available.

## Post-`f5f9dadb3` re-verification attempt (2026-11-17) — aborted

A re-verification dispatch on frozen SHA `1c6da483` (post-`f5f9dadb3` master;
pre-#3421 merge) aborted on the runbook's probe-queue criterion: the
`namespace-profile-mac-os` profile did not schedule a runner for the
`probe_namespace` job for over two hours while the same run's `xcode-27` jobs
scheduled normally — the profile is not currently available to this repo.

**Decision impact**: #2312 stays closed. The performance migration is blocked
by runner availability, not by data; re-run ≥10 iterations on then-current
master (post-`f5f9dadb3` and post-#3421) if the profile is restored. Full
execution detail is on
[#3422](https://github.com/bible-on-site/bible-on-site/issues/3422).

## Interpretation per the issue's decision rule

1. **Reliability migration: not justified.** Namespace did not show
   materially lower infra-class failures (0 vs 1 of 20). The 5-leg missing-UI
   cluster is one app/harness race that master has since fixed — it is
   evidence *about the frozen code*, not the runner.
2. **Current failure problem is real but not runner-shaped.** 11.5% of
   first-attempt shards fail; 58% of those are infra-class, dominated by
   `spawnSync node/xcrun ETIMEDOUT` (host toolchain stalls on the hosted
   image, Oct 26–29 cluster) and GitHub-network `ENOTFOUND`/artifact errors —
   image/environment issues a runner swap does not provably fix (Namespace
   legs showed zero toolchain failures, but n=20 cannot certify that).
3. **The missing-UI class (36%) needs app/harness work on any runner** —
   `PerekSource`/`SearchResultTitle`/`PerekSearchInput` condition waits fail
   identically on both pools.
4. **Speed is the real finding.** ~3.4x median shard duration and ~2.3x
   queue-inclusive leg wall is a material CI-time win if reliability on
   current code holds.

## Recommendation

**Keep #2312 closed for now** (issue option 1): today's failures need
app/harness fixes and hosted-image hardening, and the controlled data shows
no runner reliability benefit. **But** the measured speed win justifies a
bounded re-verification rather than dropping the idea:

- Re-run the A/B for **≥10 iterations on current master** (post-`f5f9dadb3`)
  — same runbook, nothing to rebuild. If `namespace` legs hold a
  first-attempt failure rate ≤ `xcode-27` with the ~3x speed win intact,
  reframe #2312 as a *performance* migration and flip
  `ios_runner` in `app-mobile-e2e.yml` (a one-line `runs-on` input change —
  runner selection is not AWS-impacting).
  *(Attempted 2026-11-17; aborted on the probe-queue criterion — see the
  re-verification section above.)*
- In parallel, file the app/harness follow-ups the data points at:
  - convert remaining live-element reads (`ReadFrame`/`Enabled`/`.Location`
    after `WaitFor`) to the snapshot/condition-element pattern that
    `WaitForText` established;
  - hosted-image hardening for the `spawnSync ETIMEDOUT`/`simctl` stalls
    (e.g., a `simctl` sanity pre-check — already hinted in the runbook);
  - the recurring `PerekSource`/`SearchResultTitle`/`PerekSearchInput`
    condition-wait failures (13/36 — the largest app-side bucket).

## Reproduction

```bash
# Master window (bounds in Asia/Jerusalem; created_at is UTC)
gh run list --repo bible-on-site/bible-on-site \
  --workflow "Continuous Integration" --branch master \
  --created "2026-10-24T21:00:00Z..2026-11-07T21:59:59Z" --limit 400 --json databaseId,createdAt,headSha,conclusion,runAttempt
# Per-run jobs: gh api repos/bible-on-site/bible-on-site/actions/runs/<id>/jobs?per_page=100 --paginate
# Keep only 'Appium iOS shard N / iOS prebuilt-run shard N', attempt 1.
# Failed-job logs: gh run view --job <job-id> --log

# A/B iterations: each run's ios-ab-report.<run>.<attempt> artifact (shards.csv);
# true per-leg queue = shard.started_at − dependency completion
# (leg A: build job completed_at; leg B: max leg-A shard completed_at).
```

Datasets: [master-window-shards.csv](master-window-shards.csv) (all 321
shard-job rows incl. skipped/rerun markers and per-failure category +
evidence) and [ab-legs.csv](ab-legs.csv) (40 leg rows incl. true queue).

## Limitations

- **Config drift inside the window**: the WDA pin moved 16.17.1 → 16.17.5 →
  16.17.6 → 16.17.7 and hosted node 26.12.1 → 26.13.0 between Oct 24 and
  Nov 6; `download-wda` retry hardening (#3284) also landed mid-window.
  Counts aggregate the whole window as required; the spawnSync-ETIMEDOUT
  cluster is concentrated Oct 26–29 and may partly be a bad hosted-image
  period rather than a steady state.
- **Selection differs between sources**: master shards run the shadow-mode
  impact-selected subset (median job ~17.5m) while A/B legs ran the forced
  full suite (x27 median ~28m) — do not compare master-window durations
  against A/B durations; the *within-experiment* runner comparison is the
  valid one.
- **20 pairs is the protocol minimum**: it resolves the 3x speed gap cleanly
  but cannot distinguish infra-class rates near ~5%/leg; the 0-vs-1
  infra split is reported, not extrapolated.
- **The frozen A/B SHA predates the `FirstPasuk` fix** (`f5f9dadb3`, master
  2026-11-13): the 5-leg Namespace stale-text cluster measures a code path
  that no longer exists. Re-verification on current master was attempted on
  2026-11-17 and aborted on the runbook's probe-queue criterion (see above);
  it remains the open item pending `namespace-profile-mac-os` availability.
- Three rerun shard attempts and five mid-flight cancellations were excluded
  from the primary rate per protocol; the five cancelled shards belong to two
  run-level workflow cancellations (`41026307444`, `41226836955`), not
  failure classifications.
- GitHub Actions `jobs.list` exposes sub-jobs under expanded names; runner
  *labels* come from the job record (`xcode-27` verified on every master
  shard row; skipped placeholder rows carry no label).
