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
            var platform = MobileIsAndroid ? "Android" : "iOS";
            DotNetTestApp($"--project \"{MobileE2ETestProject}\" --configuration Debug -p:RestoreLockedMode=true" +
                          $" --results-directory \"{resultsDirectory}\"",
                $"--filter-query \"/[(Category=MobileE2E)&((Platform=Shared)|(Platform={platform}))]\"" +
                // Per test: up to 5 min Appium session setup (IOSDriver budget) plus scenario and diagnostics.
                " --hangdump --hangdump-timeout 10m --hangdump-type Mini" +
                " --report-xunit-trx --report-xunit-trx-filename mobile-e2e.trx" +
                " --report-xunit-junit --report-xunit-junit-filename mobile-e2e.xml");
        });

    Target TestMobileE2EUnit => _ => _
        .Description("Validate mobile E2E configuration without a device or MAUI workload")
        .Executes(() => DotNetTestApp(
            $"--project \"{MobileE2ETestProject}\" --configuration Debug -p:RestoreLockedMode=true",
            "--filter-trait \"Category=Unit\""));
}
