# Website Coverage Collection

## Overview

The website module (`web/bible-on-site`) uses Istanbul-compatible coverage instrumentation via the `swc-plugin-coverage-instrument` SWC plugin. This ensures consistent branch line mappings between unit and E2E tests, enabling accurate coverage merging.

## Coverage improvement strategy (asymptote to 100%)

Goal: move coverage toward 100% in a repeatable cycle.

1. **Push** — Add or extend tests to cover uncovered code; raise the bar (e.g. bump Codecov project target in [codecov.yml](../../../../codecov.yml) when ready).
2. **Monitor** — Rely on CI (unit + e2e coverage, merge, upload) and Codecov to track project and patch coverage; watch for regressions and variance.
3. **Stabilize** — Fix flaky tests, resolve e2e/merge variance or noise, and ensure the new level is repeatable before raising targets again.
4. **Repeat** — Push again (more tests, higher target), then monitor and stabilize.

Treat small e2e coverage variance as noise; only block or revert on sustained drops or large regressions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SWC Coverage Instrumentation                     │
│              (swc-plugin-coverage-instrument v0.0.32)               │
└─────────────────────────────────────────────────────────────────────┘
                    │                           │
                    ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────────────┐
        │     Jest (Unit)     │     │   Playwright (E2E/Perf)     │
        │ @swc/jest transform │     │   Next.js dev server        │
        └─────────────────────┘     └─────────────────────────────┘
                    │                           │
                    ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────────────┐
        │  Istanbul Coverage  │     │    Istanbul Coverage        │
        │  global.__coverage__│     │  global.__coverage__        │
        │                     │     │  (browser + server drain)   │
        └─────────────────────┘     └─────────────────────────────┘
                    │                           │
                    ▼                           ▼
        ┌─────────────────────┐     ┌─────────────────────────────┐
        │  Monocart Reporter  │     │     Monocart Reporter       │
        │  → LCOV output      │     │     → LCOV output           │
        └─────────────────────┘     └─────────────────────────────┘
                    │                           │
                    └───────────┬───────────────┘
                                ▼
                    ┌─────────────────────────┐
                    │   LCOV Merge (Docker)   │
                    │   normalize + combine   │
                    └─────────────────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  Codecov / Codacy       │
                    └─────────────────────────┘
```

## SWC Plugin Configuration

Both Jest and Next.js use the same SWC plugin configuration to ensure consistent instrumentation:

### Next.js Configuration ([next.config.mjs](../../../../web/bible-on-site/next.config.mjs))

```javascript
experimental: {
  swcPlugins: [
    ["swc-plugin-coverage-instrument", { unstableExclude: covIgnoreList }],
  ],
},
```

### Jest Configuration ([jest.config.js](../../../../web/bible-on-site/jest.config.js))

When `MEASURE_COV=1` is set:

```javascript
const swcCoverageConfig = [
  "@swc/jest",
  {
    jsc: {
      parser: { syntax: "typescript", tsx: true },
      transform: { react: { runtime: "automatic" } },
      experimental: {
        plugins: [
          ["swc-plugin-coverage-instrument", { unstableExclude: covIgnoreList }],
        ],
      },
    },
  },
];
```

## Unit Test Coverage

### Flow

1. **Instrumentation**: Jest uses `@swc/jest` with the coverage plugin when `MEASURE_COV=1`
2. **Execution**: Tests run and populate `global.__coverage__`
3. **Collection**: `jest.coverage-setup.js` writes coverage to `.coverage/unit/istanbul-coverage.json` after tests complete
4. **Reporting**: Custom Jest reporter reads the JSON file and generates LCOV via Monocart

### Key Files

- [jest.config.js](../../../../web/bible-on-site/jest.config.js) - Jest configuration with SWC coverage
- [jest.coverage-setup.js](../../../../web/bible-on-site/jest.coverage-setup.js) - Writes coverage to file after tests
- [tests/util/jest/coverage/index.js](../../../../web/bible-on-site/tests/util/jest/coverage/index.js) - Custom reporter that generates LCOV

### Why a Separate Setup File?

Jest reporters run in a separate process from the tests themselves. The `global.__coverage__` object populated by SWC instrumentation exists only in the test process. The setup file uses `afterAll()` to capture coverage data before the test process exits, writing it to a file that the reporter can read.

## E2E Test Coverage

**Server:** E2E (and coverage) always use the **Next.js dev server** (`next dev`). The standalone server is not used for e2e because it can throw `NoFallbackError` on some routes.

**Speed:** E2E coverage runs only the **Desktop** project (`--project=Desktop`) to avoid running the same tests twice (Desktop + Mobile), roughly halving runtime. Coverage from the Desktop viewport is sufficient for reporting.

### Flow

1. **Instrumentation**: Next.js dev server uses SWC with the coverage plugin
2. **Warmup**: Global setup warms up the server to ensure coverage is collected for key pages
3. **Execution**: Playwright tests run against the instrumented dev server
4. **Collection**: Per-test, `window.__coverage__` (browser) and `GET /api/dev/coverage` (server's `global.__coverage__`) drain through `sanitizeCoverage`; global teardown drains the server counters one last time
5. **Projection**: `sanitizeCoverage` rewrites every record onto the canonical instrumented map ([coverage-universe.js](../../../../web/bible-on-site/tests/util/coverage/coverage-universe.js)) and drops records that name no real instrumentable src file (#2670)
6. **Reporting**: Monocart reporter generates LCOV from Istanbul coverage data

### Key Files

- [next.config.mjs](../../../../web/bible-on-site/next.config.mjs) - Next.js SWC plugin configuration
- [playwright-global-setup.js](../../../../web/bible-on-site/playwright-global-setup.js) - Warms up server for coverage
- [playwright-global-teardown-coverage.js](../../../../web/bible-on-site/playwright-global-teardown-coverage.js) - Final server `__coverage__` drain via `/api/dev/coverage`
- [tests/util/coverage/coverage-universe.js](../../../../web/bible-on-site/tests/util/coverage/coverage-universe.js) - Canonical instrumented map per src file + variant-hit projection (#2670)
- [playwright.base.config.ts](../../../../web/bible-on-site/playwright.base.config.ts) - Monocart reporter configuration

### E2E coverage variance

E2E coverage is **slightly unstable** between runs: same tests and code can yield a small spread in covered lines (LH). In three consecutive runs, LF stayed 842 while LH was 641, 643, 648 (about 76.1%–77.0%). So CI/Codecov may see small fluctuations; treat minor e2e coverage dips as noise unless they persist or are large.

### Server coverage drain and the canonical universe (#2670)

Server-side counters accumulate in the dev server process's `global.__coverage__`. The dev-only route [src/app/api/dev/coverage/route.ts](../../../../web/bible-on-site/src/app/api/dev/coverage/route.ts) returns that object and resets it; the browser fixture drains it per test, and the global teardown drains it once more after the suite.

`global.__coverage__` is the only correct source: an earlier implementation pulled V8 coverage over CDP (`CDPClient.getIstanbulCoverage()`), and V8→Istanbul conversion enumerates a completely different coordinate set — including generated modules — than the SWC plugin.

Even with real plugin counters, dev-server (turbopack) compiles emit a *variant* instrumented map: comments are lost before the plugin runs so `istanbul ignore` regions get instrumented, generated modules (`data<hash>` chunks, `[json].cjs`/`[text].mjs` wrappers, font chunks) appear under fake src-relative paths, and the `.next` filesystem cache can keep stale variants alive. Left alone that made the e2e denominator jitter between identical runs (#2670). `sanitizeCoverage` therefore builds the canonical universe — the map jest's transform produces for every src file — projects each record's hit counts onto it (matching locations by equality, then containment), and drops records naming no real instrumentable src file.

## Coverage Merge

The merge process combines unit and E2E coverage into a single report.

### Normalization

Before merging, function names are normalized to avoid conflicts:

- Anonymous functions become `anonymous_L{line}` (e.g., `anonymous_L42`)
- This ensures consistent function identification across different instrumentation runs

### Merge Command

```bash
bun run coverage:merge
```

This runs [merge-coverage.mts](../../../../web/bible-on-site/tests/util/coverage/merge-coverage.mts) which:

1. Normalizes function names in both LCOV files
2. Merges them with [devops/merge-lcov.mts](../../../../devops/merge-lcov.mts) — both inputs are `--require`d and merged as a plain union of DA/FNDA/BRDA records
3. Outputs combined coverage to `.coverage/merged/lcov.info`

### Why a plain union is safe (#2670)

Both reports enumerate the same canonical coordinate space: `sanitizeCoverage` (see "Server coverage drain and the canonical universe" above) projects every collected record onto the map jest's transform emits for the file, so identical `DA:line`/`BRDA:line,block,branch` tuples mean the same thing on both layers. Files only the e2e layer ever instruments (e.g. dev-only API routes) still contribute their full canonical universe — no coverage is lost to a unit-side pin — while dev-server generated modules and variant coordinates can never reach the merge, so the denominator stays a deterministic function of the source tree and the test suite's instrumented set.

## Ignore Patterns

Coverage ignores certain files via [.covignore.mjs](../../../../web/bible-on-site/.covignore.mjs):

- CSS files (`**/*.css`)
- Font files (`**/*.woff`, `**/*.woff2`)
- Icon files (`**/*.ico`)
- Config files (`**/instrumentation.ts`, etc.)

## Previous Approach: ts-jest with Istanbul

> **Note**: This section documents the previous approach that was replaced due to branch mapping inconsistencies.

Before the SWC alignment, Jest used `ts-jest` for transformation with Jest's built-in Istanbul coverage:

```javascript
// Previous jest.config.js configuration
const config = {
  collectCoverage: shouldMeasureCov,
  coverageReporters: ["none"], // Suppressed - custom reporter used instead
  collectCoverageFrom: shouldMeasureCov
    ? ["./src/**/*.{ts,tsx,css,scss,js,json}"]
    : undefined,
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  // ... custom Monocart reporter for LCOV output
};
```

This approach used `ts-jest` which internally relies on `istanbul-lib-instrument` for coverage. However, Next.js uses `swc-plugin-coverage-instrument` for E2E coverage, causing branch line mapping inconsistencies (e.g., the same ternary operator might be reported on line 50 in unit tests but line 51 in E2E tests).

The current approach—using `@swc/jest` **with** `swc-plugin-coverage-instrument`—ensures both unit and E2E tests use identical instrumentation, eliminating merge conflicts.

### Reverting to ts-jest with Istanbul

If needed, to revert to the previous ts-jest approach:

1. In `jest.config.js`, change `collectCoverage: false` to `collectCoverage: shouldMeasureCov`
2. Add `coverageReporters: ["none"]` and `collectCoverageFrom` patterns
3. Remove `setupFilesAfterEnv` for coverage setup
4. Change `transform` to use `ts-jest` instead of `swcCoverageConfig`
5. Accept that branch line mappings may differ from E2E coverage, requiring `--ignore-errors inconsistent` flag in LCOV merge

## Running Coverage

```bash
cd web/bible-on-site

# Unit coverage only
bun run coverage:unit

# E2E coverage only
bun run coverage:e2e

# Merge all coverage
bun run coverage:merge

# View merged coverage
cat .coverage/merged/lcov.info
```

## Investigating coverage drops / Codecov inconsistency

When Codecov reports a lower project coverage (e.g. 89.84% vs target 92%) but the PR did not add new uncovered source code, the drop can be due to:

1. **Calculation vs report**
   - Codecov **project** coverage = line coverage of all files in the flag path (`web/bible-on-site/src/`) from the uploaded report.
   - The number is computed from the merged LCOV we upload. If the merged report truly has lower coverage, Codecov will show it.

2. **Possible causes**
   - **Non-determinism in hit counts**: E2E or unit runs may hit different code paths (timing, order), so covered lines can vary between runs. The instrumented *universe* is canonical on both layers (#2670), so the denominator itself cannot jitter from e2e compilation order or generated modules.
   - **Merge or inputs**: If unit/e2e LCOV inputs were partial, the merged report differs. The “Merge Test Coverage (Unit + E2E)” step runs `bun run coverage:merge` and **fails the job** on error — both inputs are `--require`d, so a missing layer fails the merge instead of publishing a partial report; the following “Store” step additionally fails (`if-no-files-found: error`) if the merged file is missing.
   - **Path/flag mismatch**: Codecov applies the `website` flag path `web/bible-on-site/src/`. If LCOV `SF:` paths differ (e.g. absolute vs repo-relative), more or fewer files can be counted and the percentage can shift.
   - **New files in denominator**: Only files under `src/` are in the project. New test files under `tests/` are not in the flag path and do not affect project coverage.

3. **Steps to investigate**
   - In **Codecov**, open the PR → “Files” / “Components” for the website project and compare base vs head: which files lost coverage or were added?
   - In **CI logs**, check the “Log merged coverage summary” step (if present): it prints the LCOV summary for the merged file. Compare that percentage to Codecov’s project percentage to see if the gap is in our report or in Codecov’s handling.
   - **Run coverage locally** and compare to CI/Codecov:
     ```bash
     cd web/bible-on-site
     bun run coverage:unit && bun run coverage:e2e && bun run coverage:merge
     # Then e.g. use lcov --summary .coverage/merged/lcov.info if available
     ```
   - Confirm the **merge step** in the failing run succeeded; if it failed, the job itself fails — and even a merge that produced no output would fail on “Store Website Coverage Report (wf)” when the file is missing.
