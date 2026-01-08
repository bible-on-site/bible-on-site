# Testing Philosophy & Strategy

## Overview

This project follows a "catch things early" philosophy—issues should be detected as early as possible in the development lifecycle. Testing is structured to provide multiple layers of verification, and coverage measurement gives confidence in how representative the tests are.

## Testing Strategy

**Prefer unit tests over e2e tests.** When implementing features:

1. **Extract pure business logic** into separate, testable functions that don't depend on framework-specific APIs (e.g., Next.js `headers()`, React hooks).
2. **Write unit tests first** for the extracted logic - they run faster, are more reliable, and provide better error isolation.
3. **Add e2e tests** for integration verification - confirming the full stack works together (e.g., HTTP endpoints, rendered pages).
4. **Design for testability** - if a function can only be tested via e2e, refactor it to separate pure logic from side effects.

Example pattern:

```typescript
// ❌ Hard to unit test - depends on Next.js headers
export default async function sitemap() {
  const headers = await headers();
  // ... all logic mixed with framework code
}

// ✅ Testable - pure logic extracted
export function generateSitemapEntries(config: SitemapConfig) {
  // ... pure business logic, easily unit tested
}

export default async function sitemap() {
  const headersList = await headers();
  return generateSitemapEntries({ baseUrl: ..., lastModified: new Date() });
}
```

### Test Description Conventions

When writing tests, follow this naming convention for `describe` and `it`/`test` blocks:

- **Top-level `describe` blocks**: Use the subject being tested (e.g., component name, function name, module name)
- **Nested `describe` blocks**: Use contextual descriptions or scenarios (e.g., "when user is authenticated", "with invalid input")
- **Leaf `it`/`test` blocks**: Use expectation verbs describing the expected behavior (e.g., "returns the correct value", "throws an error", "renders the component")

Example:

```typescript
describe('UserService', () => {
  describe('getUser', () => {
    describe('when user exists', () => {
      it('returns the user object', () => { ... });
    });
    describe('when user does not exist', () => {
      it('throws UserNotFoundError', () => { ... });
    });
  });
});
```

## Test Types

Ideally, all modules should have unit tests, E2E tests, and performance tests. The table below shows the current implementation status:

| Module  | Unit Tests | E2E Tests | Performance Tests |
| ------- | ---------- | --------- | ----------------- |
| Website | ✅         | ✅        | ✅                |
| API     | ❌         | ✅        | ❌                |
| App     | ✅         | ✅        | ❌                |

### Unit Tests

Unit tests verify individual functions, components, and modules in isolation. They run quickly and provide fast feedback during development.

- **Website**: Uses Jest with SWC transformation
- **App**: Uses xUnit with FluentAssertions and Moq (tests in `BibleOnSite.Tests`)
- See: [Website Coverage Documentation](./website/coverage/coverage.md)

### End-to-End (E2E) Tests

E2E tests verify complete user flows through the application, testing the integration between components, services, and external systems.

- **Website**: Uses Playwright with Monocart reporter
- **API**: Uses Playwright with cargo-make orchestration
- **App**: Uses xUnit with FlaUI for Windows UI Automation (tests in `BibleOnSite.Tests.E2E`)
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

### App

```bash
cd app

# All tests (unit + integration)
dotnet run --project devops -- Test

# Unit tests only (fast)
dotnet run --project devops -- TestUnit

# Integration tests (requires API server)
dotnet run --project devops -- TestIntegration

# E2E tests (Windows, auto-starts API)
dotnet run --project devops -- TestE2E

# Coverage
dotnet run --project devops -- CoverageUnit
dotnet run --project devops -- CoverageIntegration
```

**Note**: Integration tests use `[Trait("Category", "Integration")]` to distinguish from unit tests. The API server must be running at `http://127.0.0.1:3003` for integration tests.

## CI/CD Integration

Tests run automatically in GitHub Actions:

1. **Unit tests** run first for fast feedback
2. **E2E tests** run in parallel when unit tests pass
3. **Performance tests** run in parallel to E2E tests
4. **Coverage merge** combines all coverage data
5. **Coverage upload** sends data to Codecov and Codacy

For workflow details, see [GitHub Workflows Documentation](../github/workflows/).
