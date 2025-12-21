# API Coverage Collection

## Overview

The API module (`web/api`) uses `cargo-llvm-cov` for Rust coverage instrumentation. Coverage is collected during E2E test runs via a graceful shutdown mechanism that allows the coverage data to be written before the process exits.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      cargo-llvm-cov                                 │
│              (LLVM-based coverage instrumentation)                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Actix-Web API Server        │
              │   (instrumented binary)       │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Playwright E2E Tests        │
              │   (via cargo make)            │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   POST /api/shutdown          │
              │   (graceful termination)      │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   LLVM Coverage Report        │
              │   → LCOV output               │
              └───────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Codecov                     │
              └───────────────────────────────┘
```

## Cargo Make Tasks

The API uses `cargo-make` ([Makefile.toml](../../../../web/api/Makefile.toml)) to orchestrate coverage:

### Coverage Tasks

| Task                     | Description                                |
| ------------------------ | ------------------------------------------ |
| `run-for-coverage`       | Full coverage run (clean, run, report)     |
| `coverage-run-base`      | Run instrumented binary with llvm-cov      |
| `coverage-report-lcov`   | Generate LCOV report from coverage data    |
| `coverage-report-browser`| Open HTML coverage report (local only)     |

### Task Dependencies

```
run-for-coverage
    ├── clean
    ├── coverage-run-base    ← Server starts (terminated via shutdown endpoint)
    ├── coverage-report-lcov ← Generates .coverage/lcov.info
    └── coverage-report-browser (CI skipped)
```

## Shutdown Endpoint

The API exposes a `/api/shutdown` endpoint in non-production profiles to enable graceful shutdown for coverage collection.

### Server-Side Implementation ([app.rs](../../../../web/api/src/startup/app.rs))

```rust
if env::var("PROFILE").unwrap_or_default() != "prod" {
    cfg.service(web::resource("/api/shutdown").guard(guard::Post()).to({
        let shutdown_signal = shutdown_signal.clone();
        move || {
            let shutdown_signal = shutdown_signal.clone();
            async move {
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    shutdown_signal.store(true, Ordering::SeqCst);
                });
                "Shutting down..."
            }
        }
    }));
}
```

Key points:
- Only available when `PROFILE != "prod"` (safety guard)
- Uses `AtomicBool` to signal shutdown across threads
- 1-second delay allows response to be sent before shutdown
- The main server loop polls this flag and exits gracefully

### Client-Side Trigger ([playwright-global-teardown.mjs](../../../../web/api/tests/playwright-global-teardown.mjs))

```javascript
const globalTeardown = async () => {
    await fetch("http://127.0.0.1:3003/api/shutdown", {
        method: "POST",
    });

    if (shouldMeasureCov) {
        await waitForCoverageFile();
    }
};
```

The teardown:
1. Sends POST to `/api/shutdown`
2. Waits for the coverage file to be written (with timeout)

## Coverage File Waiting

Since `cargo-llvm-cov` writes coverage data on process exit, the test teardown must wait for the file:

```javascript
const waitForCoverageFile = async () => {
    await mkdir(COVERAGE_DIR_PATH, { recursive: true });
    if (await isCoverageReady()) return;

    // Watch for file changes with timeout
    const controller = new AbortController();
    setTimeout(() => controller.abort(), COVERAGE_WAIT_TIMEOUT_MS);

    for await (const event of watch(COVERAGE_DIR_PATH, { signal: controller.signal })) {
        if (await isCoverageReady()) {
            controller.abort();
            break;
        }
    }
};
```

## Running Coverage

```bash
cd web/api

# Full coverage run (includes E2E tests)
cargo make run-for-coverage

# Just run E2E tests (no coverage)
cargo make test-e2e

# Just E2E coverage (server must be running with llvm-cov)
cargo make coverage-e2e
```

## LLVM-Cov Configuration

Coverage uses the `dev` profile for debug info:

```toml
[tasks.coverage-run-base]
env = { PROFILE = "test" }
command = "cargo"
args = ["llvm-cov", "run", "--profile", "dev", "--no-report"]

[tasks.coverage-report-lcov]
command = "cargo"
args = [
    "llvm-cov", "report",
    "--profile", "dev",
    "--lcov",
    "--output-path", ".coverage/lcov.info"
]
```

## Integration with Playwright

The E2E tests use Playwright but are orchestrated via cargo-make:

```toml
[tasks.test-e2e]
command = "${NPM_BIN}"
args = ["run", "--prefix", "tests", "test:e2e"]

[tasks.coverage-e2e]
command = "${NPM_BIN}"
args = ["run", "--prefix", "tests", "coverage:e2e"]
```

This allows the Rust build system to control when tests run, ensuring the instrumented server is ready.

## Cross-Module Merge

API coverage is merged with website coverage at the repository root:

```bash
cd devops
npm run coverage:merge
```

This produces a combined LCOV file at `.coverage/lcov.info` that includes both Rust and TypeScript coverage, which is then uploaded to Codacy.
