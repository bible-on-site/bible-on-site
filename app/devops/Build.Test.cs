using System.IO;
using System.Text.Json;
using Nuke.Common;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    // Note: Test project includes source files directly (not a project reference),
    // so it compiles independently and doesn't need the main MAUI project to be built.

    Target Test => _ => _
        .Description("Run all tests (unit + integration) - for CI, compiles all platforms first")
        .DependsOn(Compile)
        .Executes(() =>
        {
            DotNetTest(s => s
                .SetProjectFile(TestProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target TestUnit => _ => _
        .Description("Run unit tests only (fast - only compiles test project)")
        .DependsOn(CompileTests)
        .Executes(() =>
        {
            DotNetTest(s => s
                .SetProjectFile(TestProject)
                .SetConfiguration(Configuration)
                .SetFilter("Category!=Integration")
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target TestIntegration => _ => _
        .Description("Run integration tests (requires API server)")
        .DependsOn(CompileTests)
        .Executes(() =>
        {
            DotNetTest(s => s
                .SetProjectFile(TestProject)
                .SetConfiguration(Configuration)
                .SetFilter("Category=Integration")
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target TestE2E => _ => _
        .Description("Run E2E tests (API auto-started by test fixture if needed)")
        .DependsOn(CompileE2E)
        .Executes(() =>
        {
            // Note: API is managed by the test fixture - reuses if running, starts if not
            DotNetTest(s => s
                .SetProjectFile(E2ETestProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target TestMobileE2E => _ => _
        .Description("Run Appium mobile E2E tests against the explicit device and app")
        .Executes(() =>
        {
            var artifacts = Environment.GetEnvironmentVariable("MOBILE_E2E_ARTIFACTS")
                ?? throw new ArgumentException("Set MOBILE_E2E_ARTIFACTS (npm test prepares it).");
            DotNetTest(s => s
                .SetProjectFile(MobileE2ETestProject)
                .SetConfiguration("Debug")
                .SetProperty("RestoreLockedMode", "true")
                .SetFilter(MobileE2ESelectionFilter())
                // Per test: up to 5 min Appium session setup (IOSDriver budget), plus the
                // first commentary search's one-time FTS import of the whole notes pack —
                // ~7m on a loaded macOS runner, and every fresh session reinstalls the app
                // so no prior build progress survives — plus scenario and diagnostics.
                // A test that exceeds its own waits fails normally well before this guard;
                // it exists only for a genuinely dead test host.
                .SetBlameHangTimeout("18m")
                .SetBlameHangDumpType("mini")
                .SetResultsDirectory(Path.Join(artifacts, "results"))
                .SetLoggers("console;verbosity=normal", "trx;LogFileName=mobile-e2e.trx", "junit;LogFilePath=" + Path.Join(artifacts, "results", "mobile-e2e.xml")));
        });

    // When MOBILE_E2E_SELECTION points at an e2e-impact manifest (#2085), the
    // selected FullyQualifiedName list narrows the run; the category/platform
    // predicate stays as an independent guard. A manifest without a filter —
    // selectAll, fallbacks — keeps the full applicable suite. An unreadable or
    // empty manifest fails the run rather than silently skipping tests.
    string MobileE2ESelectionFilter()
    {
        var baseFilter = $"Category=MobileE2E&(Platform=Shared|Platform={(MobileIsAndroid ? "Android" : "iOS")})";
        var selectionPath = Environment.GetEnvironmentVariable("MOBILE_E2E_SELECTION");
        if (string.IsNullOrEmpty(selectionPath))
        {
            return baseFilter;
        }
        using var manifest = JsonDocument.Parse(File.ReadAllText(selectionPath));
        var root = manifest.RootElement;
        var selectAll = root.TryGetProperty("selectAll", out var flag) && flag.GetBoolean();
        var vstest = root.TryGetProperty("filter", out var filter)
            && filter.TryGetProperty("vstest", out var value)
            && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
        if (selectAll)
        {
            return baseFilter;
        }
        if (string.IsNullOrWhiteSpace(vstest))
        {
            throw new InvalidOperationException(
                $"Selection manifest {selectionPath} is not selectAll but carries no filter; refusing to run zero tests.");
        }
        return $"{baseFilter}&({vstest})";
    }

    Target TestMobileE2EUnit => _ => _
        .Description("Validate mobile E2E configuration without a device or MAUI workload")
        .Executes(() => DotNetTest(s => s
            .SetProjectFile(MobileE2ETestProject)
            .SetConfiguration("Debug")
            .SetProperty("RestoreLockedMode", "true")
            .SetFilter("Category=Unit")));
}
