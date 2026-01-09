# App Coverage Collection

## Overview

The App module (`app/`) uses Coverlet for .NET coverage instrumentation. Coverage is collected during unit and integration test runs using the `XPlat Code Coverage` data collector, then converted to LCOV format using ReportGenerator.

## Architecture

Each coverage target runs tests and generates LCOV internally:

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

The app uses [NUKE Build](https://nuke.build/) ([devops/Build.cs](../../../../app/devops/Build.cs)) to orchestrate coverage:

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

### RunSettings File ([coverlet.runsettings](../../../../app/coverlet.runsettings))

Coverage collection is configured via a runsettings file:

```xml
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="XPlat Code Coverage">
        <Configuration>
          <Format>cobertura</Format>
          <ExcludeByFile>**/obj/**,**/bin/**,**/.nuget/**</ExcludeByFile>
          <Include>[BibleOnSite.Tests]*</Include>
          <Exclude>[xunit.*]*,[FluentAssertions]*,[Moq]*,[coverlet.*]*,[Microsoft.*]*</Exclude>
          <ExcludeByAttribute>Obsolete,GeneratedCodeAttribute,CompilerGeneratedAttribute,ExcludeFromCodeCoverageAttribute</ExcludeByAttribute>
          <IncludeTestAssembly>true</IncludeTestAssembly>
          <SkipAutoProps>true</SkipAutoProps>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

Key configuration:
- **Include**: Coverage is collected on `BibleOnSite.Tests` assembly (which includes linked source files from BibleOnSite)
- **IncludeTestAssembly**: Set to `true` because source files are linked into the test project
- **Exclude**: Skip test frameworks and third-party libraries
- **ExcludeByFile**: Skip build artifacts and NuGet cache
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

## CI Integration

In CI ([.github/workflows/ci.yml](../../../../.github/workflows/ci.yml)), the `app_ci` job:

1. Checks out the repository
2. Sets up .NET 9.0
3. Restores dotnet tools and dependencies
4. Runs unit tests with coverage via `CoverageUnit` target (generates LCOV directly)
5. Copies coverage to merged location for artifact upload
6. Uploads coverage artifact for cross-module merge

The coverage is then:
- Uploaded to Codecov with the `app` flag
- Merged with other modules' coverage for Codacy reporting
