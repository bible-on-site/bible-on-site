namespace BibleOnSite.Tests.Resources;

/// <summary>
/// #2373: the only runtime coverage of the production Android startup path is
/// the Release startup smoke leg — Debug/e2e builds compile the crashing
/// analytics branch out under DISABLE_ANALYTICS, so a green Debug suite sat
/// next to a store build that died in OnCreate (#2247). These guards pin the
/// wiring that makes the runtime guard real: the Release build target keeps
/// the affected code path compiled in, the smoke script asserts a usable
/// reader plus analytics isolation, the CI leg runs it, and differential
/// selection cannot quietly skip it.
/// </summary>
public class ReleaseStartupSmokeGuardTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly string RepoRoot = Path.GetFullPath(Path.Join(AppRoot, "..", ".."));

    private static string BuildScript =>
        File.ReadAllText(Path.Join(AppRoot, "..", "devops", "Build.Compile.cs"));

    private static string SmokeScript =>
        File.ReadAllText(Path.Join(AppRoot, "..", "mobile-e2e", "release-smoke.mjs"));

    private static string ParentWorkflow =>
        File.ReadAllText(Path.Join(RepoRoot, ".github", "workflows", "app-mobile-e2e.yml"));

    private static string RunnerWorkflow =>
        File.ReadAllText(Path.Join(RepoRoot, ".github", "workflows", "app-mobile-e2e-runner.yml"));

    [Fact]
    public void ReleaseSmokeBuild_KeepsTheCrashingStartupPathCompiledIn()
    {
        var script = BuildScript;
        var target = script.IndexOf("Target CompileAndroidReleaseSmoke", StringComparison.Ordinal);
        Assert.True(target >= 0, "devops must keep the CompileAndroidReleaseSmoke target");
        var body = script[target..];
        var nextTarget = body.IndexOf("Target ", "Target ".Length, StringComparison.Ordinal);
        if (nextTarget > 0)
        {
            body = body[..nextTarget];
        }

        // The guard must build the real Release pipeline — the configuration
        // carries profiled AOT, R8 and the analytics startup branch.
        Assert.Contains("SetConfiguration(\"Release\")", body);
        Assert.Contains("\"net10.0-android\"", body);
        // DisableAnalytics is the switch that compiled the crash site out of
        // every green build while the store build died. Setting it here would
        // re-create the blind spot the leg exists to close (#2120 isolation is
        // the launch-time BIBLE_E2E marker instead).
        Assert.DoesNotContain("DisableAnalytics", body);
    }

    [Fact]
    public void ReleaseSmokeBuild_TargetsTheEmulatorAbi()
    {
        // The store ships arm64; the CI emulator image is x86_64, so the guard
        // builds the same Release pipeline for the ABI it can actually launch.
        var body = BuildScript;
        var target = body.IndexOf("Target CompileAndroidReleaseSmoke", StringComparison.Ordinal);
        Assert.True(target >= 0);
        var nextTarget = body.IndexOf("Target ", target + 1, StringComparison.Ordinal);
        var section = nextTarget > 0 ? body[target..nextTarget] : body[target..];
        Assert.Contains("\"android-x64\"", section);
    }

    [Fact]
    public void ReleaseSmokeScript_RequiresUsableReaderAndIsolatedAnalytics()
    {
        var script = SmokeScript;
        // Same readiness signal the Appium suite uses for a usable reader.
        Assert.Contains("PerekSource", script);
        Assert.Contains("com.tanah.daily929", script);
        // #2120: the launch must prove the Release branch ran with collection
        // disabled — no signal at all, an enabled=true report, or the
        // DISABLE_ANALYTICS build line each fail the leg.
        Assert.Contains("collection enabled=", script);
        Assert.Contains("BIBLE_E2E", script);
        // Crashes, ANRs and process death fail the launch, not just timeouts.
        Assert.Contains("FATAL EXCEPTION", script);
        Assert.Contains("ANR in", script);
    }

    [Fact]
    public void CiWiresTheReleaseSmokeLeg()
    {
        var parent = ParentWorkflow;
        Assert.Contains("android_release_smoke", parent);
        Assert.Contains("mode: release-smoke", parent);

        var runner = RunnerWorkflow;
        Assert.Contains("build:release-smoke", runner);
        Assert.Contains("release-smoke", runner);
    }

    [Fact]
    public void DifferentialSelectionCannotSkipTheRunnerWorkflow()
    {
        // #2373 requires CI/install-logic changes to select this check: the
        // runner workflow defines the leg itself, so editing it must trigger
        // the app checks that execute it.
        var determine = File.ReadAllText(
            Path.Join(RepoRoot, "devops", "github", "ci", "determine-changes.ts"));
        Assert.Contains(".github/workflows/app-mobile-e2e-runner.yml", determine);
    }

    private static string FindAppRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Join(dir, "BibleOnSite");
            if (Directory.Exists(candidate) && File.Exists(Path.Join(candidate, "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var siblingCandidate = Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite");
            if (Directory.Exists(siblingCandidate) && File.Exists(Path.Join(siblingCandidate, "BibleOnSite.csproj")))
            {
                return siblingCandidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException(
            "Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
    }
}
