# Testing Philosophy & Strategy

## Overview

This project follows a "catch things early" philosophy—issues should be detected as early as possible in the development lifecycle. Testing is structured to provide multiple layers of verification, and coverage measurement gives confidence in how representative the tests are.

## Test Types

Ideally, all modules should have unit tests, E2E tests, and performance tests. The table below shows the current implementation status:

| Module  | Unit Tests | E2E Tests | Performance Tests |
| ------- | ---------- | --------- | ----------------- |
| Website | ✅         | ✅        | ✅                |
| API     | ❌         | ✅        | ❌                |
| App     | ❌         | ❌        | ❌                |

### Unit Tests

Unit tests verify individual functions, components, and modules in isolation. They run quickly and provide fast feedback during development.

- **Website**: Uses Jest with SWC transformation
- See: [Website Coverage Documentation](./website/coverage/coverage.md)

### End-to-End (E2E) Tests

E2E tests verify complete user flows through the application, testing the integration between components, services, and external systems.

- **Website**: Uses Playwright with Monocart reporter
- **API**: Uses Playwright with cargo-make orchestration
- See: [Website Coverage Documentation](./website/coverage/coverage.md), [API Coverage Documentation](./api/coverage/coverage.md)

### Performance & Benchmarking

Performance tests measure application behavior under load and track metrics over time.

- **Website**: Performance tests run via Playwright with the `perf` configuration
- Benchmarks are collected and tracked via [Bencher](https://bencher.dev/)
- Results are reported on PRs and tracked on the master branch

## Coverage Reporting

Coverage data is collected during test runs and reported to external services for tracking and analysis.

### Coverage Services

| Service | Scope        | Purpose                                    |
| ------- | ------------ | ------------------------------------------ |
| Codecov | Per-module   | Tracks coverage per module (website, api)  |
| Codacy  | Cross-module | Tracks overall project coverage and trends |

### Coverage Flags

Codecov uses flags to separate coverage by module:

- `website` - Coverage from web/bible-on-site
- `api` - Coverage from web/api
- `app` - Coverage from app/BibleOnSite (when available)

See [codecov.yml](../../codecov.yml) for configuration details.

## Running Tests Locally

### Website

```bash
cd web/bible-on-site

# Unit tests
npm run test:unit

# E2E tests
npm run test:e2e

# Performance tests
npm run test:perf

# Coverage
npm run coverage:unit
npm run coverage:e2e
npm run coverage:merge
```

### API

```bash
cd web/api

# E2E tests
cargo make test-e2e

# Coverage
cargo make coverage-e2e
```

## CI/CD Integration

Tests run automatically in GitHub Actions:

1. **Unit tests** run first for fast feedback
2. **E2E tests** run in parallel when unit tests pass
3. **Performance tests** run in parallel to E2E tests
4. **Coverage merge** combines all coverage data
5. **Coverage upload** sends data to Codecov and Codacy

For workflow details, see [GitHub Workflows Documentation](../github/workflows/).
