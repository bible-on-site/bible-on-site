# Deterministic E2E Impact Selection (#2085)

The `devops/github/ci/e2e-impact/` tooling maintains a per-test coverage tree
for an E2E suite and uses the accumulated diff since the tree's snapshot to
select only the tests a change could affect — deterministically, with no LLM
or ML in the loop. The Appium mobile suite (`app-mobile-e2e`) is the first
consumer; the same contract extends to the website, admin and API E2E suites.

## Pipeline

```
 e2e-impact.json ──► discover ──► select ──► selection-manifest.json
                      ▲              ▲              │         │
                 test sources        │              │         ▼
                                     │              │       plan ──► ios-shard-plan.json
                                     │              │        (#2263)    + shards/shard-N.json
                                     │              │              ├─ every iOS leg: MOBILE_E2E_SELECTION
                                     │              │              └─ shadow partitions the full suite
                                     │              ├─ enforce (Android): MOBILE_E2E_SELECTION
                                     │              └─ shadow (Android): report only (default)
        baseline tree ◄─── collect-appium ◄─── coverage-evidence/*.json
        (master artifact)                    (written by the C# harness)
```

## Suite contract: `e2e-impact.json`

Each suite declares its rules in `app/mobile-e2e/e2e-impact.json`:

- `tests` — root, file glob, framework and the `Category` trait that owns the
  suite. Discovery parses the xUnit sources directly (`xunit-discovery.ts`):
  test identity is the `Namespace.Class.Method` FullyQualifiedName, platform
  applicability comes from the `Platform` trait (`Shared` runs on every
  platform job).
- `sources` — the app source files scanned for automation ids.
- `alwaysRun` — a documented smoke subset that runs on every platform.
- `runAllOnChange` — files whose change cannot be narrowed through evidence
  and always selects the full applicable suite: app bootstrap and shell,
  styles and resources, native platform code, project/lock files, build and
  CI tooling, packaged data and the test harness itself.
- `noImpact` — files that provably cannot affect the suite.
- `scope` — in-scope files that select the full suite when the baseline
  cannot map them (conservative); out-of-scope files select nothing.

## Coverage evidence and the tree

`CoverageEvidence` (`app/BibleOnSite.Tests.MobileE2E`) brackets every scenario
attempt through `MobileDeviceTest.Run` and writes one JSON record into
`<artifacts>/coverage-evidence/` per attempt. The platform adapters report
each automation id they translate into a locator, so the record lists exactly
the ids the test queried plus the Appium session ids attributed to it.

`collect-appium` maps each recorded id back to the app source files declaring
it (`AutomationId="X"` in XAML, `AutomationId = "X"` / `$"Prefix{n}"` /
`SetAutomationId` in C#), groups files into logical units (`X.xaml` +
`X.xaml.cs` + verified `X.*.cs` partials), and emits a `CoverageTree`:

- `snapshotSha` — the commit whose code produced the evidence;
- `platform`, `suite`, `collectorVersion`, `collectedAtUtc`, `complete`;
- `sourceUnits`/`sourceFiles` — the scanned source surface;
- `sourceFingerprints` — a trivia-insensitive structural digest per scanned
  file plus its extracted declaration signatures (see below);
- per test: declared file, reached files, automation ids, unmapped ids
  (evidence gaps), sessions and last outcome;
- per test `timing` (#2263) — the rolling per-case runtime (`samples`,
  `meanMs`, `lastMs`, `updatedAtUtc`) used only for shard scheduling;
- `overhead` (#2263) — the rolling mean of non-case pilot time (supervisor
  elapsed minus measured case durations: Appium/WDA bring-up, fixtures,
  teardown). Kept off the case records so setup is never charged to a test.

Evidence is best-effort instrumentation, not an oracle: locators built
outside `AutomationId` (raw XPath, native gestures) are unattributed, and a
scenario dying before `Finish` leaves no record. The selector treats every
gap conservatively, so missing evidence widens selection rather than
silently skipping tests.

## Structural fingerprints

`fingerprint.ts` computes a per-file `SourceFingerprint`: a `semantic` sha256
over a normalized token stream — comments, whitespace, line endings and
quoting style removed, literal bytes and preprocessor directives kept — plus
a sorted list of extracted declaration signatures (`namespace`, types,
member signatures for C-family sources; `x:Class`/`x:Name`/`AutomationId`
identity attributes for XAML/XML). The collector persists one fingerprint
per scanned source file in `sourceFingerprints`.

At selection time `select` fingerprints every modified file again and
compares digests:

- **Identical** → the diff touched only trivia (comments, formatting, line
  shifts). The file resolves `unchanged-structural` and selects nothing —
  formatting stops invalidating coverage, which is the whole point.
- **Different, missing either side, wrong fingerprint version or
  unparseable** → the file is treated as changed and falls through to the
  normal rules. Unparseable inputs (unterminated literals, binary content,
  unknown extensions, ambiguous regex contexts in scripts) return `null` —
  an input the lexer cannot prove it parsed can never narrow a selection.

Equivalence applies only to plain `modified` entries: test files always run
their declared tests, `runAllOnChange` stays absolute (bootstrap/config
edits are safety rails, not coverage), and renames evaluate both paths
because the path itself is part of the evidence identity. A diff where every
file resolves to nothing still trips the `empty-selection-guard` into a
full run — the fingerprint narrows which files contribute, never the
suite-level safety net.

## Selection semantics

`select` resolves the accumulated diff between the baseline snapshot commit
and the tested commit (GitHub compare API; ancestor divergence, truncation or
API failure are blocking problems), then resolves each changed file:

1. under the test root: a runnable test file selects exactly its declared
   tests (a changed or new test always runs); any other file is shared
   harness and selects everything;
2. `noImpact` selects nothing; `runAllOnChange` selects everything;
3. a modified file whose tested-revision fingerprint is identical to the
   baseline-persisted one is trivia-only and selects nothing
   (`unchanged-structural`);
4. a file recorded in the tree selects the tests covering it; its logical
   unit does the same;
5. any other in-scope change selects everything; out-of-scope selects
   nothing.

Additionally: tests absent from the baseline are treated as new and always
run; tests whose last recorded outcome was not `passed` re-run; deleted
files still select their recorded tests; renames evaluate both paths. A
missing, corrupt, incompatible (wrong platform/suite/schema) or non-ancestor
baseline, an undeterminable diff and an empty selection all fall back to the
full applicable suite — **a selector failure is never a green run of zero
tests**. Identical inputs produce an identical manifest (sorted output,
content fingerprint). The iOS `plan_ios` job opts into `--allow-empty`: a
clean zero-affected diff legitimately schedules no shards instead of
selecting everything, while every uncertain path still selects the suite.

## Runtime-balanced iOS sharding (#2263)

`plan` turns the selection manifest into a bounded shard plan before the
matrix expands:

- **Run set** — `enforce` partitions the selected cases; `shadow` partitions
  the full applicable suite (selection stays advisory). Timing history only
  ever moves cases between shards — membership always comes from the
  manifest, which must enumerate the suite discovered at the tested revision
  or planning fails.
- **Estimates** — each case weights its baseline `timing.meanMs`; unmeasured
  or malformed entries take a fixed fallback (`--fallback-seconds`, default
  120 s). An absent or unreadable history leaves every case unmeasured —
  scheduling stays deterministic and cold-start history accrues from the
  run's own measurements.
- **Shard count** — `ceil(total estimated case ms / target)` clamped to
  `[1, min(--max-shards = 4, case count)]`. A shard holding less than a
  minute of work folds into its least-loaded peer: the job bring-up
  (`DEFAULT_SETUP_MS` plus measured `overhead`) would dwarf it.
- **Assignment** — longest-processing-time-first onto the least-loaded
  shard; equal estimates break on sorted case id, equal loads on lower shard
  index. Identical (run set, history, config) yields a byte-identical plan —
  the emitted `fingerprint` proves it.
- **Empty plans** — zero shards emits an empty matrix value; the job-level
  `if` on the runner matrix skips before expansion, so no simulator starts
  and the aggregate result stays green only because nothing was selected —
  never because planning failed.

Each iOS runner leg stages `shards/shard-N.json` as `case-manifest.json` in
its artifacts and enforces it through `MOBILE_E2E_SELECTION` (the partition
is an assignment in both modes — it does not wait for `enforce`). The merge
job downloads every `ios-shard<N>` artifact and the plan, then:

1. requires exactly one artifact per planned shard — no missing, no
   duplicates;
2. verifies each shard's `case-manifest.json` is exactly its assignment;
3. requires a clean `pilot-timing.json` exit, only passing evidence, and a
   disjoint union covering the planned run set exactly once;
4. merges per-test evidence, exec trees, LCOV and `case-timings.json`, and
   reports the mean per-shard overhead as `overhead-ms` for the collector;
5. lets `collect-appium` roll those observations into `timing`/`overhead` —
   the same trusted publish gate (`complete`, successful master push) then
   refreshes history alongside the impact baseline, so provisional PR
   evidence never writes scheduling state either.

## CI wiring (`app-mobile-e2e.yml`)

1. **plan_ios** (#2263) — a single predecessor job: `baseline-download` →
   `select --allow-empty` → `plan` → `appium-matrix.mjs`, publishing the
   `app-mobile-e2e-plan.<run>.ios` artifact (plan, selection manifest and
   one `shards/shard-N.json` per shard) and the `ios-matrix` output the
   runner matrix expands from. The Android leg is untouched — it still
   resolves selection inside its own runner.
2. **baseline-download** — fetches the newest
   `app-mobile-e2e-coverage.master.<platform>` artifact through the REST API
   (`actions: read`). Absent baselines are reported, not fatal.
3. **select** — writes `selection-manifest.json` plus a step summary of the
   selected/unselected tests and their reasons.
4. **tests** — an iOS leg enforces its assigned `case-manifest.json`; the
   Android leg receives `MOBILE_E2E_SELECTION` only in `enforce` mode.
   `TestMobileE2E` intersects the manifest's `FullyQualifiedName` list with
   the existing category/platform filter and refuses a non-`selectAll`
   manifest that selects nothing.
5. **merge_ios** (#2263) — downloads the plan and every shard artifact,
   validates the complete disjoint run set, merges evidence/coverage/timing
   and re-downloads the baseline as `collect-appium --history` input.
6. **collect-appium** — the merge collects the union tree; per-runner
   collects stay marked incomplete.
7. **publish** — only a completed, successful `master` push uploads the
   `.master` baseline (`overwrite`), so provisional PR/merge-queue evidence
   can never poison the authoritative tree — or its timing history.

Rollout modes are `workflow_dispatch`/`workflow_call` inputs:
`e2e_selection_mode` (`shadow` default, `enforce`) and `force_full_suite`
(bypasses selection entirely). Skipping stays disabled until shadow runs
demonstrate the selection contract; enforcement is a one-input switch.

## Remaining phases

- Evidence-gated switch to `enforce` for the Appium suite.
- Website/admin/API suites: per-test application-process collectors (the
  website already records Istanbul coverage per Playwright test).
- Finer-grained structural mapping: the persisted declaration signatures
  currently serve provenance and file-level equivalence; mapping individual
  coverage entries to declarations would let a member-level edit select only
  the tests that reach that member.
- Snapshot refresh/invalidation policies and cross-suite shared-dependency
  edges (e.g. API schema → app tests).
