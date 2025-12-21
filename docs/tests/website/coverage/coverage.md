# Website Coverage Collection

## Overview

The website module (`web/bible-on-site`) uses Istanbul-compatible coverage instrumentation via the `swc-plugin-coverage-instrument` SWC plugin. This ensures consistent branch line mappings between unit and E2E tests, enabling accurate coverage merging.

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
        │  global.__coverage__│     │    (via CDP protocol)       │
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

### Flow

1. **Instrumentation**: Next.js dev server uses SWC with the coverage plugin
2. **Warmup**: Global setup warms up the server to ensure coverage is collected for key pages
3. **Execution**: Playwright tests run against the instrumented dev server
4. **Collection**: Global teardown connects via Chrome DevTools Protocol (CDP) to extract coverage
5. **Reporting**: Monocart reporter generates LCOV from Istanbul coverage data

### Key Files

- [next.config.mjs](../../../../web/bible-on-site/next.config.mjs) - Next.js SWC plugin configuration
- [playwright-global-setup.js](../../../../web/bible-on-site/playwright-global-setup.js) - Warms up server for coverage
- [playwright-global-teardown-coverage.js](../../../../web/bible-on-site/playwright-global-teardown-coverage.js) - Extracts coverage via CDP
- [playwright.base.config.ts](../../../../web/bible-on-site/playwright.base.config.ts) - Monocart reporter configuration

### CDP Coverage Extraction

The teardown connects to the Next.js server's debug port via CDP:

```javascript
const client = await CDPClient({ port: getRouterDebugPort() });
const coverageData = await client.getIstanbulCoverage();
await client.close();
```

## Coverage Merge

The merge process combines unit and E2E coverage into a single report.

### Normalization

Before merging, function names are normalized to avoid conflicts:

- Anonymous functions become `anonymous_L{line}` (e.g., `anonymous_L42`)
- This ensures consistent function identification across different instrumentation runs

### Merge Command

```bash
npm run coverage:merge
```

This runs [merge-coverage.mts](../../../../web/bible-on-site/tests/util/coverage/merge-coverage.mts) which:

1. Normalizes function names in both LCOV files
2. Uses Docker `lcov-cli` to merge the normalized files
3. Outputs combined coverage to `.coverage/merged/lcov.info`

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
npm run coverage:unit

# E2E coverage only
npm run coverage:e2e

# Merge all coverage
npm run coverage:merge

# View merged coverage
cat .coverage/merged/lcov.info
```
