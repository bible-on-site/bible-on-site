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
                .SetFilter($"Category=MobileE2E&(Platform=Shared|Platform={(MobileIsAndroid ? "Android" : "iOS")})")
                .SetBlameHangTimeout("6m")
                .SetBlameHangDumpType("mini")
                .SetResultsDirectory(Path.Join(artifacts, "results"))
                .SetLoggers("trx;LogFileName=mobile-e2e.trx", "junit;LogFilePath=" + Path.Join(artifacts, "results", "mobile-e2e.xml")));
        });

    Target TestMobileE2EUnit => _ => _
        .Description("Validate mobile E2E configuration without a device or MAUI workload")
        .Executes(() => DotNetTest(s => s
            .SetProjectFile(MobileE2ETestProject)
            .SetConfiguration("Debug")
            .SetProperty("RestoreLockedMode", "true")
            .SetFilter("Category=Unit")));
}
