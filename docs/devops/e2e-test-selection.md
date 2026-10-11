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
| Real app-process coverage collection (AltCover + in-app recorder + per-test dumps) | In flight (#2156, branch `devin/e2e-coverage-merge`) | `app/BibleOnSite.E2eCoverage/`, `app/BibleOnSite.Tests.MobileE2E/AppCoverage.cs`, `app/devops/E2ECoverageApply.cs` |
| Executable coverage-tree extraction (this slice) | This document + tool | `devops/e2e-coverage-trees/` |
| AST-aware change comparison, selection wiring | Later slices | — |

Two evidence channels exist today and answer different questions:

- **Automation-id evidence** (`coverage-evidence/*.json`, written by
  `CoverageEvidence.cs`): which AutomationIds a scenario queried through the
  driver, mapped back to the XAML/C# files declaring them. This is the input
  `e2e-impact.ts collect-appium` turns into `coverage-tree.json` — today's
  selector input. It is a *view-reachability* proxy, not executed code.
- **Executable coverage** (`app-coverage/*.json` + `coverage-app/`): the real
  IL sequence/branch points the app process executed per scenario, collected
  inside the running app by the AltCover `AltCover.Recorder.g` substitute and
  pulled over a loopback endpoint by `AppCoverage.cs`. This is the input the
  tool in this slice turns into the per-test coverage tree the issue describes.

The selector will eventually consult both channels; they are complementary
evidence about the same suite, not replacements. This slice only defines and
builds the executable tree.

## Where the evidence lands today

`run.mjs` (app/mobile-e2e) sets `MOBILE_E2E_ARTIFACTS` and `npm test` runs the
xUnit suite through `dotnet run --project devops -- TestMobileE2E`
(`app/devops/Build.Test.cs`). Per platform, the artifacts directory
`app/.artifacts/mobile-e2e/<platform>/` contains:

| Path | Producer | Content |
| --- | --- | --- |
| `coverage-evidence/<fileBase>-<outcome>.json` | `CoverageEvidence.cs` | `test` (xUnit FQN), `platform`, `outcome`, `sessions[]`, `automationIds[]`, `startedUtc`/`endedUtc` — the per-test session boundaries |
| `app-coverage/<fileBase>-<outcome>.json` | `AppCoverage.cs` (#2156) | `app-e2e-coverage-dump/1`: `test` (fileBase = scenario method name), `outcome`, `collectedUtc`, `snapshot.modules[hash][pointKey]=hits` (`altcover-visits/1`) |
| `app-coverage/_startup-passed.json` | `AppCoverage.cs` | Launch-path hits recorded once per session before the post-connect reset — app-init code is shared evidence, never one test's |
| `app-coverage/*.coverage-error.txt` | `AppCoverage.cs` | Diagnostics for dumps that could not be pulled; the scenario itself is unaffected |
| `coverage-app/template.opencover.xml` | app build (`-p:E2ECoverage=true`) | AltCover OpenCover template mapping `Module@hash` + `uspid` → `File`, `Class`, `Method`, sequence/branch points |
| `coverage-app/coverage.opencover.xml` | `CoverageMobileE2E` (Nuke) | Template with all dumps applied into `vc` — the merged report |
| `coverage-app/lcov.info` | `CoverageMobileE2E` + ReportGenerator | LCOV for the cross-module codecov merge |
| `coverage-app/coverage-manifest.json` | `PublishE2ECoverageBuildArtifacts` | `app-e2e-coverage-build/1`: `sourceSha`, `platform`, `configuration`, `collectorVersion` (AltCover version) |
| `coverage-app/coverage-report-manifest.json` | `ApplyE2ECoverageLayer` | `app-e2e-coverage/1`: apply statistics, `incompatibleDumps`, `unknownPointIds`, `complete` |
| `results/mobile-e2e.trx`, `results/mobile-e2e.xml` | xUnit MTP reporters | Per-test identity (FQN via `TestMethod@className`+`@name`), outcomes, start/finish times |
| `coverage-tree.json` | `e2e-impact.ts collect-appium` | The automation-id tree (schemaVersion 1) |
| `selection-manifest.json` | `e2e-impact.ts select` | The deterministic selection manifest |

Artifact upload (`app-mobile-e2e.yml`):

- `appium-<platform>-<run_id>-<attempt>` — the whole artifacts directory
  (diagnostics, evidence, dumps, reports).
- `app-e2e-coverage.<run_id>.<platform>` — `coverage-app/` per run (#2156).
- `app-e2e-coverage.master.<platform>` — `coverage-app/` baseline, published
  only from successful master pushes.
- `app-mobile-e2e-coverage.master.<platform>` — automation-id tree baseline,
  same trust rule.

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

**Shared mode**: when no per-test dumps exist (coverage not split per test —
the current state on master until #2156 lands), `--report` (an OpenCover
document with real `vc` values, e.g. `coverage.opencover.xml`) plus the
executed-test list attributes *all* covered nodes to *every* executed test
with `attribution: "shared"`. The tree stays usable and honest; the
`shared` bucket carries the union and `diagnostics.attribution` records the
degraded mode. **TODO(issue #2085):** delete the shared-mode fallback only
once per-test dumps are mandatory on both platforms.

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

## Known gaps (explicit, by design)

- **No per-test split on master yet**: `MOBILE_E2E_COVERAGE` and the dump
  pipeline land with #2156. Until then the tool runs shared mode and the tree
  is coarse by construction — wired in code as the `--report` path, flagged
  `shared` everywhere it matters.
- **Theory case attribution**: `fileBase` is the method name, so theory cases
  sharing a method overwrite one dump file — per-case coverage cannot exist
  with this naming. Trees record method-level entries plus `cases` when the
  TRX reveals them. A future harness change should fold a case hash into
  `fileBase` (TODO in `extract.ts`).
- **Dependency edges**: nodes carry `parents` containment only. Call graph,
  XAML↔code-behind bindings, resource/config/data mappings and service/API
  dependencies belong to the AST slice; until then `runAllOnChange` in
  `e2e-impact.json` keeps non-code changes conservative.
- **Coverage of framework code**: only the instrumented app module(s) appear;
  MAUI/framework hits are out of evidence scope.
- **iOS**: identical schema and code path (`platform: "ios"`), validated by
  the same tool; per-test dumps depend on the #2156 endpoint on simulator.

## Determinism contract

Same artifacts + same baseline + same snapshot sha ⇒ byte-identical tree
except `collectedAtUtc`. All sets are sorted; the XML reader is a small
dependency-free parser (`xml.ts`); no clocks, randomness, environment or
network inputs leak into the extracted content — only into `collectedAtUtc`
and diagnostics messages.
