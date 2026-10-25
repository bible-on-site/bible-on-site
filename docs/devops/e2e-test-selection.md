# Deterministic E2E Test Selection — Coverage Trees

Issue: [#2085](https://github.com/bible-on-site/bible-on-site/issues/2085).

The app mobile E2E suite is the most expensive job in CI: every scenario pays an
Appium session, a simulator/emulator, and a fresh app install. The goal of #2085
is to select only the tests a change can affect — deterministically, with no
LLM or ML in the loop — by keeping a **per-test coverage tree** and comparing
the accumulated diff against it. This document is the design contract for the
coverage-tree layer as it exists in this repository, and the specification of
the executable-coverage tree produced by `devops/e2e-coverage-trees/`.

## Status and prior art

| Piece | State | Where |
| --- | --- | --- |
| Automation-id coverage tree + selector (shadow/enforce) | Merged (#2092) | `devops/github/ci/e2e-impact/`, `app/mobile-e2e/e2e-impact.json`, `.github/workflows/app-mobile-e2e.yml` |
| Real app-process coverage collection (AltCover + in-app recorder + per-test dumps) | Merged (#2156) | `app/BibleOnSite.E2eCoverage/`, `app/BibleOnSite.Tests.MobileE2E/AppCoverage.cs`, `app/devops/E2ECoverageApply.cs` |
| Executable coverage-tree extraction | Merged (#2183) | `devops/e2e-coverage-trees/` |
| Selector bridge: exec evidence unions into `coverage-tree.json` | Merged (#2195, #2230) | `devops/e2e-coverage-trees/to-selector-tree.ts`, `collect-appium --exec-tree`, `.github/workflows/app-mobile-e2e.yml` |
| Playwright suites (website, admin, API): evidence, discovery, collectors, shadow CI | Merged (#2241) | `web/shared/tests-util/e2e-impact.ts`, `*/e2e-impact.json`, `collect-playwright`, `.github/workflows/ci.yml` |
| iOS runtime-planned shard split + merged-tree baseline publication | Merged (#2266, #2279, #2263) | `.github/workflows/app-mobile-e2e.yml` `plan_ios`/`merge_ios`, `devops/github/ci/e2e-impact/shard-plan.ts`, `app/mobile-e2e/merge-runner-shards.mjs` |
| Member-granularity narrowing (C# member fingerprints ↔ exec member evidence) | Merged (#2297) | `extractMembers`/`SourceFingerprint.members`, `CoveredNode.member`, `memberGaps`, `covered-members`/`member-widened` reasons |
| Shadow-mode parity verification (manifest ↔ observed outcomes) | This slice | `e2e-impact.ts verify`, `devops/github/ci/e2e-impact/verify.ts`, `selection-verify.json` in every suite's run diagnostics |
| Selection enforcement beyond the mobile opt-in inputs | Opt-in (#2085) | `e2e-impact.ts playwright-args` renders the manifest into `playwright test` args; `ci.yml` honors `e2e_selection_mode`/`force_full_suite` dispatch inputs and the `E2E_SELECTION_MODE`/`E2E_FORCE_FULL_SUITE` repo variables for all three Playwright suites. Shadow stays the default. |
| AST-aware change comparison beyond member level, dependency edges | Planned, not implemented | — |

Two evidence channels exist today and answer different questions:

- **Automation-id evidence** (`coverage-evidence/*.json`, written by
  `CoverageEvidence.cs`): which AutomationIds a scenario queried through the
  driver, mapped back to the XAML/C# files declaring them. This is the input
  `e2e-impact.ts collect-appium` turns into `coverage-tree.json` — today's
  selector input. It is a *view-reachability* proxy, not executed code.
- **Executable coverage** (`app-coverage/*.json` + `coverage-app/`): the real
  IL sequence/branch points the app process executed per scenario, collected
  inside the running app by the AltCover `AltCover.Recorder.g` substitute and
  pulled over a loopback endpoint by `AppCoverage.cs`. `e2e-coverage-trees.ts
  extract` turns it into the per-test `exec-coverage-tree`.

The selector consults both channels; they are complementary evidence about
the same suite, not replacements. The merged bridge unions the exec
channel's per-test file evidence into `coverage-tree.json` at collection
time (see "Selector bridge" below) — the selector schema and the selection
order stay unchanged apart from the shared-coverage widening and the
member-granularity narrowing it adds.

## Where the evidence lands today

`run.mjs` (app/mobile-e2e) sets `MOBILE_E2E_ARTIFACTS` and `pnpm test` runs the
xUnit suite through `dotnet run --project devops -- TestMobileE2E`
(`app/devops/Build.Test.cs`). Per platform, the artifacts directory
`app/.artifacts/mobile-e2e/<platform>/` contains:

| Path | Producer | Content |
| --- | --- | --- |
| `coverage-evidence/<fileBase>-<outcome>.json` | `CoverageEvidence.cs` | `test` (xUnit FQN — also `fileBase`, so shared method names cannot collide), `platform`, `outcome`, `sessions[]`, `automationIds[]`, `startedUtc`/`endedUtc` — the per-test session boundaries |
| `app-coverage/<fileBase>-<outcome>.json` | `AppCoverage.cs` (#2156) | `app-e2e-coverage-dump/1`: `test` (fileBase = scenario method name), `outcome`, `collectedUtc`, `snapshot.modules[hash][pointKey]=hits` (`altcover-visits/1`) |
| `app-coverage/_startup-passed.json` | `AppCoverage.cs` | Launch-path hits recorded once per session before the post-connect reset — app-init code is shared evidence, never one test's |
| `app-coverage/*.coverage-error.txt` | `AppCoverage.cs` | Diagnostics for dumps that could not be pulled; the scenario itself is unaffected |
| `coverage-app/template.opencover.xml` | app build (`-p:E2ECoverage=true`) | AltCover OpenCover template mapping `Module@hash` + `uspid` → `File`, `Class`, `Method`, sequence/branch points |
| `coverage-app/coverage.opencover.xml` | `CoverageMobileE2E` (Nuke) | Template with all dumps applied into `vc` — the merged report |
| `coverage-app/lcov.info` | `CoverageMobileE2E` + ReportGenerator | LCOV for the cross-module codecov merge |
| `coverage-app/coverage-manifest.json` | `PublishE2ECoverageBuildArtifacts` | `app-e2e-coverage-build/1`: `sourceSha`, `platform`, `configuration`, `collectorVersion` (AltCover version) |
| `coverage-app/coverage-report-manifest.json` | `ApplyE2ECoverageLayer` | `app-e2e-coverage/1`: apply statistics, `incompatibleDumps`, `unknownPointIds`, `complete` |
| `results/mobile-e2e.trx`, `results/mobile-e2e.xml` | xUnit MTP reporters | Per-test identity (FQN via `TestMethod@className`+`@name`), outcomes, start/finish times |
| `exec-coverage-tree.json` | `e2e-coverage-trees.ts extract` | The exec tree (schemaVersion 1) — per-test executed files + the `shared` bucket |
| `coverage-tree.json` | `e2e-impact.ts collect-appium` | The selector tree (schemaVersion 1): automation-id entries unioned with `--exec-tree` evidence when a compatible exec tree exists; also carries per-case `timing` and `overhead` history (#2263) |
| `selection-manifest.json` | `e2e-impact.ts select` | The deterministic selection manifest |
| `ios-shard-plan.json` + `shards/shard-N.json` | `e2e-impact.ts plan` (`plan_ios` job, #2263) | The deterministic shard plan and the per-shard case manifests the iOS legs enforce |
| `case-manifest.json` | iOS runner leg | The shard manifest this leg actually executed — the merge replays it against the plan's assignment |
| `case-timings.json` | `merge-runner-shards.mjs` | Merged per-case durations across all shards — the collector's timing-history input |
| `runner-union.json` | `merge-runner-shards.mjs` | Union report: planned-vs-observed per-shard durations, completeness and pilot timings |

Artifact upload (`app-mobile-e2e-runner.yml` + `app-mobile-e2e.yml`):

- `app-mobile-e2e-plan.<run_id>.ios` — the `plan_ios` output consumed by every
  iOS leg and by `merge_ios` (#2263).
- `app-mobile-e2e-build.<run_id>.ios` — the shared iOS build consumed by all
  iOS shard legs.
- `app-mobile-e2e-shard.<run_id>.ios-shard<N>` — one iOS leg's merge inputs
  (`case-manifest.json`, trees, manifests, evidence, dumps, LCOV) consumed by
  `merge_ios`.
- `appium-<artifact>-<run_id>-<attempt>` — the whole per-leg artifacts
  directory (diagnostics, evidence, dumps, reports, `exec-coverage-tree.json`);
  `<artifact>` is `android`, `ios-build` or `ios-shard<N>`. The merged iOS
  result additionally uploads as `appium-ios-<run_id>-<attempt>` from
  `merge_ios`.
- `app-e2e-coverage.<run_id>.<artifact>` — `coverage-app/` per leg;
  `merge_ios` merges the iOS shard LCOVs into `app-e2e-coverage.<run_id>.ios`.
- `app-mobile-e2e-coverage.master.<platform>` — selector tree baseline
  (`coverage-tree.json`), published only from a completed, successful
  default-branch run.
- `app-mobile-e2e-exec-coverage.master.<platform>` — exec tree baseline,
  same trust rule, skipped when the run produced no exec evidence.
- `app-e2e-coverage.master.<platform>` — `coverage-app/` baseline, same
  trust rule.

On iOS all three `*.master.ios` baselines are published by `merge_ios`
(rather than inside a shard leg) and only when the merged evidence reports
`complete == true` — a shard whose own tree is marked `--incomplete` can
still contribute to a complete merged baseline, while a partial union
cannot poison it.

## Executable coverage-tree schema

Produced by `devops/e2e-coverage-trees/e2e-coverage-trees.ts extract` as
`exec-coverage-tree.json`. `kind: "exec-coverage-tree"`, `schemaVersion: 1`.
Every map key and list is sorted; identical inputs produce identical output
except `collectedAtUtc` (provenance only, never a selection input).

```jsonc
{
	"kind": "exec-coverage-tree",
	"schemaVersion": 1,
	"suite": "app-mobile-e2e",            // suite rules name
	"platform": "android",                // one platform per tree, never mixed
	"configuration": "Debug",
	"snapshotSha": "<40-hex>",            // commit whose build was instrumented
	"collector": "altcover-app-dump",
	"collectorVersion": "9.0.145",        // AltCoverVersion from the build manifest
	"collectedAtUtc": "<iso>",
	"complete": true,                     // false when the run did not finish
	"envFingerprint": "<sha256>",         // sha256 over suite+platform+collector+
	                                      // version+module hashes — tree↔build
	                                      // compatibility check
	"modules": [{ "name": "BibleOnSite", "hash": "…" }],
	"nodes": {
		"method:Namespace.Type.Name": {
			"kind": "method",
			"decl": "Namespace.Type.Name",   // position-independent identity
			"token": "0x06000001",           // snapshot-local disambiguator
			"file": "app/BibleOnSite/…",     // repo-relative primary file
			"files": ["app/BibleOnSite/…"],  // every file the decl's points span
			"span": [42, 61],                // min(sl)..max(el) of its points
			"member": "Namespace.Type.Name#<sig>",   // source-member identity the
			                                      // node's span maps into — the
			                                      // `SourceFingerprint.members`
			                                      // key space (C# only; absent
			                                      // when unmapped/unparseable)
			"memberType": "Namespace.Type",  // the member's enclosing type —
			                                      // the widening tier above member
			"parents": ["type:Namespace.Type"],
			"points": { "sequence": 9, "branch": 2 }
		},
		"type:Namespace.Type": { "kind": "type", "decl": "Namespace.Type",
			"files": ["…"], "parents": ["file:app/BibleOnSite/…"] },
		"file:app/BibleOnSite/PerekView.xaml.cs": { "kind": "file",
			"decl": "app/BibleOnSite/PerekView.xaml.cs" }
	},
	"tests": {
		"BibleOnSite.Tests.MobileE2E.PerekPilotTests.StartupDisplaysPackagedPesukimAndUsableBottomNavigation": {
			"id": "<the FQN key>",
			"cases": [],                     // Theory case display suffixes when known
			"attribution": "per-test",       // per-test | shared | unmeasured | error
			"measured": true,
			"outcome": "passed",
			"evidenceSha": "<sha of the run that measured this entry>",
			"sessions": ["<appium session ids>"],
			"startedUtc": "…", "endedUtc": "…",
			"nodes": ["method:…"],
			"files": ["app/BibleOnSite/…"],
			"visits": { "sequence": 41, "branch": 6, "methodEntries": 12 }
		}
	},
	"shared": {                            // conservative bucket — see below
		"reasons": ["app-startup", "unmatched-dump:_startup-passed.json"],
		"nodes": ["method:…"], "files": ["app/BibleOnSite/App.xaml.cs"]
	},
	"unmatchedEvidence": ["<dump names that resolved to no known test>"],
	"diagnostics": {
		"attribution": "per-test",           // per-test | shared | mixed
		"dumpsTotal": 21, "dumpsApplied": 20,
		"errorDumps": ["<fileBase>-failed"],
		"incompatibleDumps": ["<dump from a different build>"],
		"unknownPointIds": 0,
		"missingDumps": ["<tests that ran but produced no dump>"]
	}
}
```

### Identity rules

- **Test identity** is the xUnit FullyQualifiedName `Namespace.Class.Method` —
  the same id `e2e-impact` discovery and `E2eSelection.cs` already use. Theory
  *case* identity is recorded under `cases` (TRX display-name suffixes) where
  recoverable; see Known gaps for why it currently cannot be.
- **Node identity** is the declaration name (`Namespace.Type.Method`), not a
  line number or traversal index. Overloads sharing a name inside one type get
  a `#<metadata-token>` suffix — deterministic within a snapshot but not across
  builds; the AST comparison layer must join on `decl`, never on `token`.
- **Files** are repo-relative POSIX paths normalized from the build machine's
  `File@fullPath`; files that cannot be normalized stay raw and are flagged
  external — they widen selection later, never narrow it.
- **`envFingerprint`** binds the tree to an exact instrumented build: module
  hashes + collector + collector version + suite + platform. A template or
  dump keyed to another build cannot silently extend a tree.

### The `shared` bucket

Coverage that cannot be attributed to one test is recorded here instead of
being dropped: app-startup hits (the `_startup` dump), dumps that matched no
known test, and — in shared mode — the entire covered set. Its selection
semantic is deliberately conservative: a change touching a shared node or
file must widen toward every applicable test. Missing attribution evidence
must never read as "no test is affected".

## Extraction and attribution

`extract` resolves per-test evidence in this order:

1. `coverage-evidence/<fileBase>-<outcome>.json` — the exact join: gives the
   FQN plus the session ids and UTC boundaries the harness already brackets
   every scenario with.
2. `results/mobile-e2e.trx` (`UnitTestResult` + `TestMethod@className/@name`)
   or `results/mobile-e2e.xml` — the executed-test list, outcomes and times
   when evidence records are absent.
3. Source discovery (`xunit-discovery` reused from `e2e-impact`) — a fileBase
   that maps to exactly one declared method resolves to that method's FQN;
   ambiguous names do not resolve and land in `unmatchedEvidence`.
4. Everything else goes to `shared`, never silently dropped.

Per-test mode requires `app-coverage/*.json` dumps. Point keys follow the
recorder contract (`E2ECoverageApply`): `key < 0` → branch point `uspid =
key & 0x7fffffff`; `key >= 0` → sequence-point `uspid`, else the method's
metadata token (`0x06xxxxxx`) → method-entry visit. Dumps whose module hashes
match nothing in the template are *incompatible* — counted, diagnosed, never
applied. `*.coverage-error.txt` files produce `attribution: "error"` entries
that do not overwrite measured baseline evidence on merge.

**Shared mode**: when no per-test dumps exist (per-test coverage dumps are
produced on both platforms since #2156, but a run without `MOBILE_E2E_COVERAGE`
or a leg whose dump pipeline was skipped still lands here), `--report` (an
OpenCover document with real `vc` values, e.g. `coverage.opencover.xml`) plus
the executed-test list attributes *all* covered nodes to *every* executed test
with `attribution: "shared"`. The tree stays usable and honest; the
`shared` bucket carries the union and `diagnostics.attribution` records the
degraded mode. **TODO(issue #2085):** delete the shared-mode fallback only
once per-test dumps are mandatory on every leg.

## Selector bridge

`devops/e2e-coverage-trees/to-selector-tree.ts` maps the exec tree onto the
selector's `coverage-tree.json` (schemaVersion 1). The Appium workflow runs
`extract` and then `collect-appium --exec-tree <exec-coverage-tree.json>`,
which unions the two evidence channels inside one tree — same file covered
by either channel selects the test.

**What maps** — per `ExecCoverageTest`, keyed by the shared xUnit FQN
identity:

- `attribution: "per-test"` only. `shared`, `unmeasured` and `error`
  entries never map onto a test — they carry no single test's claim.
  `measured: false` per-test entries (baseline-carried evidence) still map;
  they record real execution. `stale` entries never map either: a
  baseline-carried test id the current revision no longer discovers cannot
  run, and a file covered only by a ghost must not narrow to a selection
  that executes nothing.
- `files` ∪ into `CoverageTreeTest.files` — executed files union with
  automation-id-mapped files; never replace.
- `sessions` ∪ into `CoverageTreeTest.sessions`.
- `outcome`: a non-`passed` value from either channel wins — the
  previously-failing selection policy keys on `outcome !== "passed"`, so a
  recorded failure can never be masked by the other channel's `passed`.
- `file` (the declaring test file) resolves through the same discovery the
  automation channel uses; exec-only tests join `unmatchedEvidence` when
  discovery cannot claim them — same convention as evidence records.
- `members`: `file → source-member keys` the test's executed nodes mapped
  into (`CoverageTreeTest.members`). A file key is present — possibly with
  an empty list — only when the test's exec coverage for that file is
  member-qualified; automation-id-only coverage stays unqualified.
- `memberGaps`: `file → source-level type names` whose covered nodes could
  not map to a single member (no span, unparsable source, `#if`-twin spans,
  file-scope code). A changed member inside a gapped type widens to the
  file's tests — partial member evidence never narrows a type the
  extractor admitted it could not fully map.
- Decl-level detail the selector schema cannot express (node ids,
  `parents` containment edges, visit counts, per-entry `evidenceSha`) is
  dropped deliberately — the exec tree stays the rich artifact for the AST
  slice; `coverage-tree.json` keeps only file + member evidence.

**Shared bucket → `sharedFiles`**: the exec tree's `shared.files` land on
the optional `CoverageTree.sharedFiles` (additive; automation-id-only
baselines predate it). During `select`, a changed file in `sharedFiles` —
or sharing a logical unit with one — resolves `shared-coverage` and
selects every applicable test: shared hits can widen but never narrow to a
per-test claim. The check runs after `noImpact`/`runAllOnChange` and the
structural-equivalence proof, before per-test file/unit narrowing.

**Member granularity**: when the baseline fingerprint and the tested file
both carry C# member digests (`SourceFingerprint.members` — member keys
are `Ns.Type.Name#<sig>` over the declaration signature, position- and
trivia-independent) *and* at least one covering test is member-qualified
for the file, `select` diffs the member maps instead of the whole file.
Tests that executed a changed member resolve `covered-members`; tests
without member evidence for the file stay selected regardless — evidence
absence can widen but never narrow. A member diff that maps to no exec
evidence (added/removed member, `type:`-shape change, member inside a
`memberGaps` type) widens to the file's covering set, as does a diff
outside every member (usings, directives, file-scope code); those resolve
`member-widened`, which is also reported when the member pass ends at the
file's whole covering set. Baselines or sources without member data
resolve plain `covered-file` — the pre-member behavior.

**Incompatibility is diagnosed, never applied**: `collect-appium` applies
the exec tree only when `validateExecTree` passes for the suite+platform
**and** `snapshotSha` equals the collected snapshot — coverage measured on
another commit would attach wrong-revision files to tests. A missing,
corrupt or mismatched `--exec-tree` logs a warning and the output stays
byte-identical to the automation-id-only collection. `complete` merges as
`AND`: an incomplete exec tree keeps the merged tree incomplete so a
partial run can never publish a baseline.

## Playwright suites (website, admin, API)

The same coverage-tree contract covers the three Playwright suites —
`website-e2e` (`web/bible-on-site`), `admin-e2e` (`web/admin`) and `api-e2e`
(`web/api`) — each shipping an `e2e-impact.json` suite contract and a
`collect-playwright` collection step wired into `ci.yml` in shadow mode.

### Test identity and discovery

Identity is `<testDir-relative file> :: <describe> :: <test title>` — the
exact string the runtime reporter computes from `test.titlePath()` with the
project element (`titlePath[1]`) dropped: a selection can never run a test
on one Playwright project but not another, so Desktop/Mobile evidence for
the same test unions under one id.

`playwright-discovery.ts` parses test sources with a small tokenizer —
deliberately *not* `playwright --list`, which would require installed
`node_modules` and a bootable config. Literal `test`/`test.describe` titles
resolve to ids; a file whose declarations cannot all be resolved statically
(non-literal or template title, dynamic describe, parse anomaly, or a
glob-matched file yielding zero declarations) is recorded in
`dynamicTestFiles`: a change to it selects the whole suite, and enforce-mode
runners must execute it wholesale rather than by id.

### Evidence layout and the shared reporter

`web/shared/tests-util/e2e-impact.ts` is the single evidence module every
suite consumes. It does nothing unless `E2E_IMPACT_DIR` is set — each
suite's Playwright config sets it to `<package>/.coverage/e2e-impact/` under
`MEASURE_COV=1` (the `coverage:e2e` scripts) and registers the reporter.

| Path | Producer | Content |
| --- | --- | --- |
| `discovered.json` | `E2eImpactReporter.onBegin` | The runtime test list (`e2e-impact-discovery/1`) reconciled against static discovery as diagnostics |
| `test-results.json` | `E2eImpactReporter.onTestEnd/onEnd` | Per-test `{id, project, retry, status, outcome}` across projects and retries |
| `coverage/<hash>-<project>-<seq>.json` | `dumpImpactCoverage` (browser fixtures) | One istanbul map per drain, tagged `realm` |

The **realm** tag carries the conservative split:

- `browser` — `window.__coverage__` drained per test by the suite's custom
  fixture (website `tests/util/playwright/test-fixture.ts`, admin
  `tests/util/test-fixture.ts`). Per-context counters are exact → per-test
  `CoverageTreeTest.files` claims.
- `server` — the dev-server `/api/dev/coverage` drain. The dev server is one
  shared process across parallel workers, so its counters can mix tests →
  every server-realm file lands in `CoverageTree.sharedFiles`, never a
  per-test claim.

Tests bypassing the fixture or producing no dump are marked
`unattributed: true` and cover the union of every attributed file plus
shared coverage — they run on any covered change and can never be narrowed
away. Dumps whose id static discovery cannot claim (dynamic files) widen
into `sharedFiles` as well; dump filenames carry the worker index and
retry number so a retried attempt can never overwrite an earlier dump.
Corrupt evidence files — and missing `test-results.json`/`discovered.json`
reporter output — mark the tree `complete: false`; incomplete trees can
neither publish a baseline (the publish step gates on the tree's
`complete` flag) nor serve as one (`validateTree` rejects them, so
selection falls back to the full suite).

### The `api-operations` collector

Rust has no per-test coverage channel (`cargo llvm-cov` is suite-level; the
API process is shared by every test), so `web/api` attributes tests
*statically* via `api-map.ts`:

- GraphQL operation names in test-file `query:`/`document:`/`mutation:`
  payload literals resolve to the `#[Object] impl` resolver file declaring
  them (`#[graphql(name = "…")]` renames honored); a `use`-graph closure
  over `web/api/src` and `web/api/entities/src` widens each test to the
  modules its resolvers can reach. `use` trees expand recursively
  (`crate::{a::b::{C, D}, e}`), `mod child;` declarations add file → child
  module edges (e.g. `article_search.rs` → `article_search/lsa.rs`), and
  `self::`/`super::` prefixes resolve relative to the declaring module.
- Nested selection fields widen attribution further: every field name at
  any selection depth resolves through a field map covering `#[Object]`,
  `#[ComplexObject]` and `#[Interface]` impl methods plus
  `#[derive(SimpleObject)]` members — so `authors { articlesCount }`
  reaches the DTO impl that computes it, not just the root resolver.
  Unresolved nested names are scalar fields and are ignored.
- REST path literals resolve through `web::resource("…").to(handler)`
  registrations; registrar/dispatch files (`startup/app.rs`,
  `startup/schema_builder.rs`) are shared, never per-test.
- The reporter's `discovered.json`/`test-results.json` still provide the
  outcome and runtime-discovery evidence for the tree.

Unresolved operations land in `unmappedIds` (diagnostics); unresolved
in-scope source changes resolve `unmapped-in-scope` → full suite, so
under-attribution can only over-select.

### Selection specifics

- `filter.playwright` replaces `filter.vstest` for these suites: selected
  tests grouped as `{file, titles}` where each title is the describe path
  joined by spaces — the string `playwright test --grep` matches. In shadow
  mode it is diagnostics; enforce mode feeds it through
  `e2e-impact.ts playwright-args`, which emits the package-relative spec
  list plus an anchored `--grep` alternation covering every selected title
  and every runtime-discovered title inside `dynamicTestFiles` (a `--list`
  enumeration supplies them; without discovery the args degrade to
  `selectAll`).
- Structural fingerprints cover `.ts`/`.tsx`/`.js`/`.mjs` sources; `.rs`
  files fingerprint as `null`, so Rust edits always count as real changes.
- Baselines publish only from completed, successful `master` pushes as
  `website-e2e-coverage.master`, `admin-e2e-coverage.master` and
  `api-e2e-coverage.master`; every run downloads them for the shadow
  manifest and stores the manifest/tree as run diagnostics.

## Storage and refresh policy

- **Per-run**: `exec-coverage-tree.json` inside the platform artifacts dir —
  it ships inside the `appium-<platform>-<run>-<attempt>` artifact with the
  rest of the diagnostics.
- **Authoritative baseline**: artifact `app-mobile-e2e-exec-coverage.master.
  <platform>` — published only by a *completed, successful* default-branch
  run (the same guard as `app-mobile-e2e-coverage.master.*` and
  `app-e2e-coverage.master.*`: `push` on `master`, pilot `success`, collect
  `success`). PR and merge-queue evidence is provisional and can never
  overwrite it. Android and iOS baselines are separate artifacts and separate
  trees — `validate` and merge refuse a platform mismatched baseline.
- **Committed seeds**: `devops/e2e-coverage-trees/baselines/<suite>/<platform>
  .json` — an optional human-reviewable seed for local shadow runs and for
  recovering from baseline-artifact expiry (90-day retention). Seeds are
  committed only from a green full master run and record `snapshotSha`,
  `envFingerprint`, and `complete: true`.
- **Update semantics**: `--baseline` merges a trusted tree with a fresh
  extraction. Only entries actually measured in the new run (`measured:
  true`, `attribution` of `per-test` or `shared`) replace baseline entries —
  each entry carries the `evidenceSha` of the run that measured it. Entries
  not measured this run keep their baseline evidence, `outcome` and
  `evidenceSha` verbatim, surface with `measured: false` (the evidence did
  not come from this tree's run), and are flagged `stale` when their test id
  is no longer discovered. `shared` unions across runs. A tree with
  `complete: false` must never be published as a baseline.

## Shadow-mode parity verification

`e2e-impact.ts verify` is the rollout gate's measurement. Shadow mode runs
every test while the manifest proposes a subset, so each run can score the
selection against observed reality: `verify --manifest <selection-manifest>
--tree <coverage-tree> --out <verify.json>` joins the manifest's
`selected`/`unselected` lists onto the same run's `CoverageTreeTest.outcome`
values and emits `kind: "e2e-impact-verify"` (schemaVersion 1).

- **`missed`** — an unselected test whose run outcome was a failure: the
  subset would have hidden a real failure. The metric that must stay at zero
  before enforcement is considered; any non-pass outcome string (`failed`,
  `timedOut`, unknown future states) counts. A `::warning::` annotates the
  run when misses exist.
- **`flakyMissed`** — unselected tests that flaked (failed then passed): a
  weaker signal, reported separately.
- **`unobserved`** — unselected tests with no verdict (skipped, `unknown`,
  absent from the tree): nothing proven either way.
- **`caught` / `selectedUnobserved`** — selected tests that failed (the
  selection worked) and selected tests the run never observed (a
  runner-fidelity anomaly, meaningful once enforce mode runs subsets).
- **`passedUnselected`** — the correctly-skipped count: the win metric.

Inputs that cannot be joined — missing/corrupt files, suite or platform
mismatch, or a tree collected from a different revision than
`manifest.testedSha` — emit a report carrying `problem` instead of a
verdict, with empty buckets. Verify is pure diagnostics: it never throws on
evidence gaps and never gates the job. Reports ship per run inside each
suite's diagnostics artifact: `selection-verify.json` under
`.coverage/e2e-impact/` for the three Playwright suites (ci.yml), inside
`$MOBILE_E2E_ARTIFACTS` for the Android leg, and under
`app/.artifacts/mobile-e2e/ios/` for iOS — where `merge_ios` joins the
plan's suite-level manifest against the merged tree, since per-shard
manifests are execution assignments, not suite selections.

## Known gaps (explicit, by design)

- **Enforcement is opt-in**: every suite computes and stores its selection
  manifest; `app-mobile-e2e.yml` and `ci.yml` now both expose
  `e2e_selection_mode=enforce` / `force_full_suite` (dispatch inputs, or the
  `E2E_SELECTION_MODE` / `E2E_FORCE_FULL_SUITE` repository variables).
  Default remains shadow everywhere until parity evidence supports
  narrowing. #2085's AST-aware comparison and dependency edges are
  still unimplemented.
- **Theory case attribution**: `fileBase` is the method name, so theory cases
  sharing a method overwrite one dump file — per-case coverage cannot exist
  with this naming. Trees record method-level entries plus `cases` when the
  TRX reveals them. A future harness change should fold a case hash into
  `fileBase` (TODO in `extract.ts`).
- **Dependency edges**: nodes carry `parents` containment only. Call graph,
  XAML↔code-behind bindings, resource/config/data mappings and service/API
  dependencies belong to the AST slice; until then `runAllOnChange` in
  `e2e-impact.json` keeps non-code changes conservative. Member narrowing
  is per-file only: a member in file A that calls into file B is not an
  edge — a change to B narrows by B's own covering members, so tests that
  reach B only transitively still select through B's member evidence.
- **Member mapping is span containment**: exec nodes map to the member
  whose source span contains the node's point span (constructors fall back
  to the member containing the span's tail — field initializers execute
  inside `.ctor`). Nodes outside every member, in unparseable files or
  under `#if`-twin spans stay unmapped and report `memberGaps`; a changed
  member in a gapped type widens to the file set. Member evidence exists
  only for C# sources under the mapped source root — XAML, generated code
  and external files remain file-granular.
- **Coverage of framework code**: only the instrumented app module(s) appear;
  MAUI/framework hits are out of evidence scope.
- **iOS sharding**: each shard extracts a per-shard tree marked
  `--incomplete` (it holds only its assigned slice of the plan by
  construction); `merge_ios` validates the union against the shard plan —
  every assignment observed exactly once — and only then can the merged
  tree publish baselines. A per-shard `coverage-tree.json` is therefore
  diagnostic, never baseline input. The split is `plan_ios`'s
  runtime-driven assignment (#2263): each leg executes its
  `case-manifest.json` verbatim rather than a static `Shard` trait.
  The manifest skip runs in-process, so a leg's TRX/JUnit still
  enumerates the whole suite — unassigned cases land in the tree as
  skipped/not-executed `unmeasured` placeholders that claim no
  execution; the merge deduplicates them freely and requires only the
  claiming (measured, error or ran-but-undumped) entries to be disjoint.

## Determinism contract

Same artifacts + same baseline + same snapshot sha ⇒ byte-identical tree
except `collectedAtUtc`. All sets are sorted; the XML reader is a small
dependency-free parser (`xml.ts`); no clocks, randomness, environment or
network inputs leak into the extracted content — only into `collectedAtUtc`
and diagnostics messages.
