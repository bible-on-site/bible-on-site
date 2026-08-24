---
description: "Testing strategy, conventions, naming, coverage, and commands by module"
applyTo: "**"
---

# Testing Practices

## Strategy

Prefer unit tests over e2e: extract pure logic, unit test it, then add e2e for integration. If something is only testable via e2e, refactor to separate pure logic from side effects.

## Test Naming

Top-level `describe` = subject; nested `describe` = context ("when user is authenticated"); `it` = expectation verb ("returns the correct value", "throws an error").

## Coverage (Website)

Use `/* istanbul ignore next */` with a short reason for defensive/unreachable code; `tests/util/coverage/sanitize-coverage.js` makes SWC instrumentation honor it.

To find gaps — never hand-parse lcov or write ad-hoc scripts:

1. `npm run coverage:unit` (writes `.coverage/unit/lcov.info`).
2. `npm run coverage:gaps -- <path-substring> ...` prints missed lines/branches (no args = every file with gaps).
3. Read each missed region and write a targeted test per real path. lcov line numbers can be off by one or duplicated (SWC sourcemap artifacts) — verify against the source before chasing a "missed" line existing tests clearly cover.
4. Every gap in a file you touched is yours to close; there is no "pre-existing" exclusion. Truly dead defensive branches get an ignore comment with a reason instead of a contrived test.

## Coverage (Data)

Same gap workflow, module-specific commands:

1. `cargo make coverage-unit` (in `data/`, writes `.coverage/unit/lcov.info`).
2. `node devops/coverage-gaps.mjs [filter...]` prints missed lines/branches and an overall line percentage; `--lcov <path> --root <prefix>` points it at any module's report.

## Commands by Module

| Module  | Unit                                      | E2E                                      | Coverage                                                                              |
| ------- | ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Website | `npm run test:unit`                       | `npm run test:e2e`                       | `npm run coverage:unit` / `coverage:e2e`                                              |
| API     | (cargo)                                   | `cargo make test-e2e`                    | `cargo make coverage-e2e`                                                             |
| App     | `dotnet run --project devops -- TestUnit` | `dotnet run --project devops -- TestE2E` | `dotnet run --project devops -- CoverageUnit`                                         |
| Data    | `cargo make test-unit` (in `data/`)       | `cargo make test-integration`            | `cargo make coverage-unit` / `coverage-integration` + `node devops/coverage-gaps.mjs` |

App integration tests are marked `[Trait("Category", "Integration")]` and need the API at `http://127.0.0.1:3003`.
