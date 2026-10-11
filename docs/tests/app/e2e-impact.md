# Deterministic E2E Impact Selection (#2085)

The `devops/github/ci/e2e-impact/` tooling maintains a per-test coverage tree
for an E2E suite and uses the accumulated diff since the tree's snapshot to
select only the tests a change could affect — deterministically, with no LLM
or ML in the loop. The Appium mobile suite (`app-mobile-e2e`) is the first
consumer; the same contract extends to the website, admin and API E2E suites.

## Pipeline

```
 e2e-impact.json ──► discover ──► select ──► selection-manifest.json
                      ▲              ▲              │
                 test sources        │              ├─ enforce: MOBILE_E2E_SELECTION
                                     │              └─ shadow: report only (default)
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
  (evidence gaps), sessions and last outcome.

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
content fingerprint).

## CI wiring (`app-mobile-e2e.yml`)

1. **baseline-download** — fetches the newest
   `app-mobile-e2e-coverage.master.<platform>` artifact through the REST API
   (`actions: read`). Absent baselines are reported, not fatal.
2. **select** — writes `selection-manifest.json` plus a step summary of the
   selected/unselected tests and their reasons.
3. **tests** — `MOBILE_E2E_SELECTION` receives the manifest only in `enforce`
   mode; `TestMobileE2E` intersects its `FullyQualifiedName` list with the
   existing category/platform filter. A non-`selectAll` manifest without a
   filter fails rather than running zero tests.
4. **collect-appium** — runs `always()`; failed runs still collect evidence
   for their passed tests but mark the tree `complete: false`.
5. **publish** — only a completed, successful `master` push uploads the
   `.master` baseline (`overwrite`), so provisional PR/merge-queue evidence
   can never poison the authoritative tree.

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
