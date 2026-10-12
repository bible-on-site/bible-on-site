using System.IO;
using System.Text.Json;
using Nuke.Common;
using Nuke.Common.Tooling;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    // Note: Test project includes source files directly (not a project reference),
    // so it compiles independently and doesn't need the main MAUI project to be built.

    static void DotNetTestApp(string dotnetArgs, string appArgs = "")
    {
        var arguments = $"test {dotnetArgs}";
        if (appArgs.Length > 0)
        {
            arguments += $" -- {appArgs}";
        }

        ProcessTasks.StartProcess(DotNetPath, arguments, RootDirectory)
            .AssertZeroExitCode();
    }

    Target Test => _ => _
        .Description("Run all tests (unit + integration) - for CI, compiles all platforms first")
        .DependsOn(Compile)
        .Executes(() =>
        {
            DotNetTestApp($"--project \"{TestProject}\" --configuration {Configuration} --no-restore --no-build");
        });

    Target TestUnit => _ => _
        .Description("Run unit tests only (fast - only compiles test project)")
        .DependsOn(CompileTests)
        .Executes(() =>
        {
            DotNetTestApp($"--project \"{TestProject}\" --configuration {Configuration} --no-restore --no-build",
                "--filter-not-trait \"Category=Integration\"");
        });

    Target TestIntegration => _ => _
        .Description("Run integration tests (requires API server)")
        .DependsOn(CompileTests)
        .Executes(() =>
        {
            DotNetTestApp($"--project \"{TestProject}\" --configuration {Configuration} --no-restore --no-build",
                "--filter-trait \"Category=Integration\"");
        });

    Target TestE2E => _ => _
        .Description("Run E2E tests (API auto-started by test fixture if needed)")
        .DependsOn(CompileE2E)
        .Executes(() =>
        {
            // Note: API is managed by the test fixture - reuses if running, starts if not
            DotNetTestApp($"--project \"{E2ETestProject}\" --configuration {Configuration} --no-restore --no-build");
        });

    Target TestMobileE2E => _ => _
        .Description("Run Appium mobile E2E tests against the explicit device and app")
        .Executes(() =>
        {
            var artifacts = Environment.GetEnvironmentVariable("MOBILE_E2E_ARTIFACTS")
                ?? throw new ArgumentException("Set MOBILE_E2E_ARTIFACTS (npm test prepares it).");
            var resultsDirectory = Path.Join(artifacts, "results");
            DotNetTestApp($"--project \"{MobileE2ETestProject}\" --configuration Debug -p:RestoreLockedMode=true" +
                          $" --results-directory \"{resultsDirectory}\"",
                $"--filter-query \"/[{MobileE2ESelectionFilter()}]\"" +
                // The host guard includes Appium session setup and diagnostics.
                // The delivered index keeps searches within ordinary interaction deadlines.
                // corpus construction must never justify extending this budget.
                " --hangdump --hangdump-timeout 10m --hangdump-type Mini" +
                " --report-xunit-trx --report-xunit-trx-filename mobile-e2e.trx" +
                " --report-xunit-junit --report-xunit-junit-filename mobile-e2e.xml");
        });

    // When MOBILE_E2E_SELECTION points at an e2e-impact manifest (#2085) the
    // manifest's selected list narrows the run inside the test process —
    // xunit's query language cannot OR arbitrary method names — so the query
    // keeps only the category/platform guard. The manifest is still validated
    // here so an unreadable or empty selection fails before the suite starts
    // rather than silently skipping every test.
    string MobileE2ESelectionFilter()
    {
        // Every predicate stays parenthesized — the filter-query grammar treats
        // a bare `A=B|C=D` group as one malformed predicate and runs zero tests.
        var baseFilter = $"(Category=MobileE2E)&((Platform=Shared)|(Platform={(MobileIsAndroid ? "Android" : "iOS")}))";
        var selectionPath = Environment.GetEnvironmentVariable("MOBILE_E2E_SELECTION");
        if (string.IsNullOrEmpty(selectionPath))
        {
            return baseFilter;
        }
        using var manifest = JsonDocument.Parse(File.ReadAllText(selectionPath));
        var root = manifest.RootElement;
        var selectAll = root.TryGetProperty("selectAll", out var flag) && flag.GetBoolean();
        var selectedCount = root.TryGetProperty("selected", out var selected)
            && selected.ValueKind == JsonValueKind.Array
            ? selected.GetArrayLength()
            : 0;
        if (!selectAll && selectedCount == 0)
        {
            throw new InvalidOperationException(
                $"Selection manifest {selectionPath} is not selectAll but selects no tests; refusing to run zero tests.");
        }
        return baseFilter;
    }

    Target TestMobileE2EUnit => _ => _
        .Description("Validate mobile E2E configuration without a device or MAUI workload")
        .Executes(() => DotNetTestApp(
            $"--project \"{MobileE2ETestProject}\" --configuration Debug -p:RestoreLockedMode=true",
            "--filter-trait \"Category=Unit\""));
}
