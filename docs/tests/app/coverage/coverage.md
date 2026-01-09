# App Coverage Collection

## Overview

The App module (`app/`) uses Coverlet for .NET coverage instrumentation. Coverage is collected during unit and integration test runs using the `XPlat Code Coverage` data collector, then merged and converted to LCOV format using ReportGenerator.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Coverlet Instrumentation                       │
│              (coverlet.collector NuGet package)                     │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   dotnet test --collect:"XPlat       │
              │       Code Coverage"                  │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   Cobertura XML Reports              │
              │   (.coverage/unit/, .coverage/       │
              │    integration/)                      │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   ReportGenerator                     │
              │   (dotnet tool)                       │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   LCOV Report                         │
              │   (.coverage/merged/lcov.info)        │
              └───────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────────────────────────────┐
              │   Codecov                             │
              └───────────────────────────────────────┘
```

## NUKE Build Targets

The app uses [NUKE Build](https://nuke.build/) ([devops/Build.cs](../../../../app/devops/Build.cs)) to orchestrate coverage:

### Coverage Targets

| Target                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `CoverageUnit`        | Run unit tests with coverage (excludes Integration)      |
| `CoverageIntegration` | Run integration tests with coverage (requires API)       |
| `CoverageMerge`       | Merge coverage reports and convert to LCOV               |
| `CoverageAll`         | Run both unit + integration coverage, then merge         |

### Target Dependencies

```
CoverageAll
    ├── CoverageUnit        ← Unit tests, generates .coverage/unit/coverage.cobertura.xml
    ├── CoverageIntegration ← Integration tests, generates .coverage/integration/coverage.cobertura.xml
    └── Triggers: CoverageMerge ← Merges both into .coverage/merged/lcov.info
```

## Configuration

### RunSettings File ([coverlet.runsettings](../../../../app/coverlet.runsettings))

Coverage collection is configured via a runsettings file:

```xml
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat Code Coverage">
        <Configuration>
          <Format>cobertura</Format>
          <Include>[BibleOnSite]*</Include>
          <Exclude>[*.Tests]*,[*.Tests.E2E]*,[xunit.*]*,[FluentAssertions]*,[Moq]*</Exclude>
          <ExcludeByAttribute>Obsolete,GeneratedCodeAttribute,CompilerGeneratedAttribute,ExcludeFromCodeCoverageAttribute</ExcludeByAttribute>
          <SkipAutoProps>true</SkipAutoProps>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

Key configuration:
- **Include**: Only cover `BibleOnSite` namespace
- **Exclude**: Skip test assemblies and third-party libraries
- **ExcludeByAttribute**: Skip generated code and explicitly excluded code
- **SkipAutoProps**: Don't count auto-properties in coverage

### dotnet Tools ([.config/dotnet-tools.json](../../../../app/.config/dotnet-tools.json))

The following tools are used for coverage:

- `nuke.globaltool` - Build automation
- `dotnet-reportgenerator-globaltool` - Coverage report generation and merging

## Running Coverage Locally

```bash
cd app

# Restore tools first
dotnet tool restore

# Run unit tests with coverage
dotnet run --project devops -- CoverageUnit

# Run integration tests with coverage (requires API server)
dotnet run --project devops -- CoverageIntegration

# Merge coverage reports
dotnet run --project devops -- CoverageMerge

# Run everything (unit + integration + merge)
dotnet run --project devops -- CoverageAll
```

## Output Locations

| Output                     | Path                                    |
| -------------------------- | --------------------------------------- |
| Unit coverage (Cobertura)  | `.coverage/unit/coverage.cobertura.xml` |
| Integration coverage       | `.coverage/integration/coverage.cobertura.xml` |
| Merged LCOV                | `.coverage/merged/lcov.info`            |

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

## CI Integration

In CI ([.github/workflows/ci.yml](../../../../.github/workflows/ci.yml)), the `app_ci` job:

1. Checks out the repository
2. Sets up .NET 9.0
3. Restores dotnet tools and dependencies
4. Runs unit tests with coverage via `CoverageUnit` target
5. Merges coverage reports via `CoverageMerge` target
6. Uploads coverage artifact for cross-module merge

The coverage is then:
- Uploaded to Codecov with the `app` flag
- Merged with other modules' coverage for Codacy reporting
