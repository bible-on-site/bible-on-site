# App Coverage Collection

## Overview

The App module (`app/`) uses Coverlet for .NET coverage instrumentation. Coverage is collected during unit and integration test runs by the `coverlet.console` dotnet tool, which instruments the test assembly on disk before spawning the xunit.v3 Microsoft Testing Platform runner, then converted to LCOV format using ReportGenerator.

The test project defines `MAUI`, just as the app does, so chapter loading,
carousel preloading, commentary selection, search, navigation commands, and
sharing commands are included. It also links all binding converters and the
local database, chapter data, connectivity, and analytics services. Platform
boundaries accept MAUI interfaces, while tests exercise the real GraphQL client,
temporary files, SQLite databases, controls, and view models.

The app's Codecov project gate is **98.5%**. The expanded Release unit suite reaches
**99.43% line coverage (2,607 of 2,622 application lines)** and **96.85% branch
coverage** with 814 passing tests. Codecov counts partially covered branch lines
separately from fully covered lines; its stricter project percentage is about
**98.55%**, rather than the LCOV line-hit percentage above.
The `app` flag selects application sources; test-source coverage is not part of
this figure. No additional coverage exclusions were introduced.

This is coverage of the linked application sources in the portable test build.
XAML-generated pages and platform-specific Android/iOS implementations still
require device tests. The remaining uncovered lines include native singleton
adapters, platform fallbacks, defensive paths, and asynchronous disposal sequence
points. A high portable coverage percentage does not establish device coverage.

## Architecture

Each coverage target runs tests and generates LCOV internally:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Coverlet Instrumentation                       │
│            (coverlet.console dotnet tool, out-of-proc)              │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   dotnet tool run coverlet <dll>      │
              │   --target dotnet (xunit.v3 MTP app)  │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   Cobertura XML (intermediate)        │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   ReportGenerator (internal)          │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   LCOV Report                         │
              │   (.coverage/unit/lcov.info or        │
              │    .coverage/integration/lcov.info)   │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   Codecov                             │
              └───────────────────────────────────────┘
```

## NUKE Build Targets

The app uses [NUKE Build](https://github.com/nuke-build/nuke) ([devops/Build.cs](../../../../app/devops/Build.cs)) to orchestrate coverage:

### Coverage Targets

| Target                | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `CoverageUnit`        | Run unit tests with coverage → outputs `.coverage/unit/lcov.info`   |
| `CoverageIntegration` | Run integration tests with coverage → outputs `.coverage/integration/lcov.info` |
| `CoverageMerge`       | Merge unit + integration LCOV files → outputs `.coverage/merged/lcov.info` |
| `CoverageAll`         | Run both unit + integration coverage, then merge                    |

### Target Flow

```
CoverageUnit        → .coverage/unit/lcov.info
CoverageIntegration → .coverage/integration/lcov.info
CoverageMerge       → .coverage/merged/lcov.info (from unit + integration)
CoverageAll         → Runs Unit + Integration, then triggers Merge
```

## Configuration

### Coverlet Arguments ([Build.Coverage.cs](../../../../app/devops/Build.Coverage.cs))

The test projects run on the native Microsoft Testing Platform, so there is no VSTest data collector or runsettings file. `RunTestsWithCoverage` passes the same rules as coverlet.console command-line options:

```text
coverlet <test-bin-dir> --target dotnet
  --targetargs "<test-dll> <trait-filter> --results-directory <dir>
                --report-xunit-junit --report-xunit-junit-filename test-results.xml"
  --output <dir>/coverage.cobertura.xml --format cobertura
  --include "[BibleOnSite.Tests]*"
  --exclude "[xunit.*]*,[FluentAssertions]*,[Moq]*,[coverlet.*]*,[Microsoft.*]*"
  --exclude-by-attribute "Obsolete,GeneratedCodeAttribute,CompilerGeneratedAttribute,ExcludeFromCodeCoverageAttribute"
  --exclude-by-file "**/obj/**,**/bin/**,**/.nuget/**"
  --include-test-assembly --skipautoprops
```

Key configuration:
- **Include**: Coverage is collected on `BibleOnSite.Tests` assembly (which includes linked source files from BibleOnSite)
- **IncludeTestAssembly**: Set to `true` because source files are linked into the test project. This works with coverlet.console because it instruments the assembly before spawning the runner; the in-process `coverlet.MTP` extension cannot instrument an assembly that is itself the test controller (coverlet#1911)
- **Exclude**: Skip test frameworks and third-party libraries
- **ExcludeByFile**: Skip build artifacts and NuGet cache
- **ExcludeByAttribute**: Skip generated code and explicitly excluded code
- **SkipAutoProps**: Don't count auto-properties in coverage

The trait filter selects the suite (`--filter-not-trait Category=Integration` for unit, `--filter-trait Category=Integration` for integration), and xUnit's built-in `--report-xunit-junit` writes the JUnit report consumed by CI.

### dotnet Tools ([.config/dotnet-tools.json](../../../../app/.config/dotnet-tools.json))

The following tools are used for coverage:

- `nuke.globaltool` - Build automation
- `coverlet.console` - Coverage instrumentation and Cobertura collection
- `dotnet-reportgenerator-globaltool` - Coverage report generation and merging

## Running Coverage Locally

```bash
cd app

# Restore tools first
dotnet tool restore

# Run unit tests with coverage (generates .coverage/unit/lcov.info)
dotnet run --project devops -- CoverageUnit

# Run integration tests with coverage (generates .coverage/integration/lcov.info)
# Note: Requires API server running at http://127.0.0.1:3003
dotnet run --project devops -- CoverageIntegration

# Merge unit + integration coverage
dotnet run --project devops -- CoverageMerge

# Run everything (unit + integration + merge)
dotnet run --project devops -- CoverageAll
```

## Output Locations

| Output              | Path                                 |
| ------------------- | ------------------------------------ |
| Unit coverage       | `.coverage/unit/lcov.info`           |
| Integration coverage| `.coverage/integration/lcov.info`    |
| Merged coverage     | `.coverage/merged/lcov.info`         |

## Test Project Structure

The test project ([BibleOnSite.Tests.csproj](../../../../app/BibleOnSite.Tests/BibleOnSite.Tests.csproj)) includes source files directly rather than referencing the MAUI project:

```xml
<ItemGroup>
  <Compile Include="..\BibleOnSite\Config\*.cs" Link="Config\%(Filename)%(Extension)" />
  <Compile Include="..\BibleOnSite\Data\*.cs" Link="Data\%(Filename)%(Extension)" />
  <!-- ... -->
</ItemGroup>
```

This allows coverage to be collected on the actual source files without needing to build the full MAUI application with all platform targets.

## Cross-Module Merge

App coverage is merged with website and API coverage at the repository root:

```bash
cd devops
npm run coverage:merge
```

This produces a combined LCOV file at `.coverage/lcov.info` that includes TypeScript (website), Rust (API), and C# (app) coverage, which is then uploaded to Codacy.

## Real App-Process E2E Coverage

Unit and integration coverage measure the portable test build. The mobile E2E
suites additionally measure the **running application itself** (#1232): the
device build is IL-instrumented so every executed sequence and branch point is
counted inside the app process, exactly like unit coverage — never inferred
from automation ids or selection fingerprints.

### Instrumentation (`E2ECoverage`)

`BibleOnSite.csproj` defines an `E2ECoverage` switch used only by instrumented
test builds. When enabled:

- `AltCover` rewrites `BibleOnSite.dll` after `XamlC` so every sequence point
  calls `AltCover.Recorder.Instance.Visit(moduleHash, pointId)` (branch points
  pass `int.MinValue | uspid`), emitting an OpenCover **template** keyed by the
  build's module hash.
- The `app/BibleOnSite.E2eCoverage` project supplies a substitute
  `AltCover.Recorder.g` assembly (same name, version and public key token as
  AltCover's generated recorder) that accumulates hits in memory and serves the
  live snapshot from a loopback HTTP endpoint on `127.0.0.1:4787`:
  `GET /coverage`, `GET /coverage/health`, `POST /coverage/reset`.
- The endpoint starts with the first instrumented visit, listens only on
  loopback, and a plain build afterwards restores the untouched assembly, so
  instrumentation can never leak into store or production builds.

### Collection (test harness)

`MobileDeviceTest` pulls the snapshot after every scenario — while the app is
still running, because Appium may kill the process at session teardown — and
drops one `app-e2e-coverage-dump/1` JSON per test under
`<artifacts>/app-coverage/`. A `_startup` dump captures app-launch hits before
the per-test reset. Android tunnels the device loopback through `adb forward`;
the iOS simulator shares the host loopback. Failed pulls leave
`*.coverage-error.txt` diagnostics instead of failing the test.

Enable locally with `MOBILE_E2E_COVERAGE=1`; the Windows FlaUI fixture uses
`E2E_COVERAGE=1` and writes the same dump shape under `E2E_ARTIFACTS`.

### Applying dumps → LCOV

`CoverageMobileE2E` (and `CoverageE2EWindows` for the local Windows suite)
replays dump hit counts onto the build's OpenCover template — matched by
module hash, so dumps from a different build are reported `incompatible`
rather than misapplied — then ReportGenerator converts it to `lcov.info`:

```bash
cd app
MOBILE_PLATFORM=Android MOBILE_E2E_COVERAGE=1 dotnet run --project devops -- CompileMobileE2E
npm test --prefix mobile-e2e          # runs the suite, collecting dumps
MOBILE_PLATFORM=Android dotnet run --project devops -- CoverageMobileE2E
# → .artifacts/mobile-e2e/android/coverage-app/lcov.info
```

The per-platform output directory keeps the applied OpenCover, per-test dumps
and a `coverage-report-manifest.json` (`complete`, `dumpErrors`,
`incompatibleDumps`, `unknownPointIds`) for diagnostics.

### Authoritative merge

`cross_module_ci` merges the three layers into the single app report consumed
by the `app` Codecov flag (98.5% gate, 0% threshold):

```
unit/lcov.info + integration/lcov.info + e2e/{android,ios}/lcov.info
        └─ merge-lcov.mts --relocate app/BibleOnSite/ --hits-only <e2e>
           →  .coverage/merged/lcov.info
```

- `merge-lcov.mts` unions records **by covered location** (`DA`, `BRDA`,
  `FNDA` hit counts take the max), so a line exercised on any layer or
  platform counts exactly once and lines executed nowhere stay uncovered.
- The E2E inputs merge with `--hits-only`: their OpenCover template
  enumerates a separately instrumented build's full sequence-point
  universe, so their zero-hit records are dropped — covered locations
  still union in, while unexecuted e2e lines and files do not inflate
  the flag's denominator (#2270).
- `--relocate` canonicalizes absolute runner paths (Linux Android leg, macOS
  iOS leg, local Windows) onto `app/BibleOnSite/`, so the same source line
  never double-counts across runners.
- When the mobile suite did not run, the trusted per-platform master baselines
  (`app-e2e-coverage.master.{android,ios}`) fill the E2E layer; a successful
  run must produce both platform reports or the merge fails.
- The combined report is stored as `app-coverage.<run>` and, on master,
  `app-coverage.master` — the baseline always contains every layer, so a
  partial run can never overwrite a complete one.

## CI Integration

In CI ([.github/workflows/ci.yml](../../../../.github/workflows/ci.yml)), the `app_ci` job:

1. Checks out the repository
2. Sets up .NET 10.0
3. Restores dotnet tools and dependencies
4. Runs unit tests with coverage via `CoverageUnit` target (generates LCOV directly)
5. Runs integration tests against the API and merges the coverage reports
6. Uploads the unit+integration coverage artifact for cross-module merge

The `app_mobile_e2e` job ([app-mobile-e2e.yml](../../../../.github/workflows/app-mobile-e2e.yml)):

1. Builds an instrumented Debug app (`MOBILE_E2E_COVERAGE=1` → `CompileMobileE2E`)
2. Runs the Appium suite; the harness collects a per-test coverage dump even
   when the scenario fails
3. Applies the dumps via `CoverageMobileE2E` (runs even after a failed pilot so
   partial coverage stays diagnosable) and uploads `app-e2e-coverage.<run>.<platform>`
4. Publishes `app-e2e-coverage.master.<platform>` only from a completed,
   successful default-branch run

`cross_module_ci` then merges all layers as described above and publishes the
authoritative report to Codecov with the `app` flag and to Codacy through the
cross-module merge.
