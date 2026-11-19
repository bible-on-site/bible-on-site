using System.IO;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tooling;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

// In-process Android device-test layer (#3349): XHarness drives the
// BibleOnSite.DeviceTests instrumentation inside the emulator — real handlers,
// XAML inflation, RTL layout, platform services and the UI thread at
// ~0.5 s/test. Additive to the Appium suite, which keeps every genuine
// packaged-app journey (see docs/tests/app/device-tests-research.md).
// S2333 fires per-file on Codacy: it cannot see the other Build.*.cs partials.
#pragma warning disable S2333 // 'partial' is required — the Nuke Build class spans Build.*.cs.
partial class Build
#pragma warning restore S2333
{
    const string DeviceTestsPackageId = "com.bibleonsite.devicetests";

    // Same MOBILE_E2E_ARTIFACTS contract as the Appium legs: the CI job exports
    // its per-leg directory; a local run keeps this layer's outputs separate.
    AbsolutePath DeviceTestsArtifactsDirectory => AbsolutePath.Create(
        Environment.GetEnvironmentVariable("MOBILE_E2E_ARTIFACTS")
        ?? (RootDirectory / ".artifacts" / "device-tests").ToString());

    /// <summary>
    /// Builds the Release APK of the in-process device tests app. Release is
    /// required: Debug APKs ship no embedded assemblies and abort on launch
    /// ("No assemblies found"). AOT stays off like the Appium Debug build — the
    /// layer asserts handler/XAML/layout behavior, not trim compatibility.
    /// .NET 11 Android runs on CoreCLR: 'PublishReadyToRun=false' disables the
    /// R2R AOT step (the legacy 'RunAOTCompilation' property errors there).
    /// </summary>
    Target CompileDeviceTests => _ => _
        .Description("Build the Release Android APK of the in-process device tests app (#3349)")
        .Executes(() =>
        {
            // Restore from the project directory so its scoped NuGet.config
            // (the dotnet-eng feed the prerelease XHarness packages ship from)
            // applies without leaking into the rest of the app module.
            DotNetRestore(s => s
                .SetProjectFile(DeviceTestsProject)
                .SetProcessWorkingDirectory(DeviceTestsDirectory));
            DotNetBuild(s => s
                .SetProjectFile(DeviceTestsProject)
                .SetConfiguration("Release")
                .SetProcessWorkingDirectory(DeviceTestsDirectory)
                .SetProperties(new Dictionary<string, object>
                {
                    ["AndroidPackageFormat"] = "apk",
                    ["PublishReadyToRun"] = "false",
                })
                .EnableNoRestore());
        });

    /// <summary>
    /// Runs the device tests on a connected Android emulator/device through
    /// `xharness android test`. MOBILE_UDID selects the device (omitted:
    /// XHarness picks the single connected one); MOBILE_E2E_ARTIFACTS overrides
    /// the results directory. XHarness exit codes map cleanly: 0 pass,
    /// non-zero test failures or infra errors — a crashed app kills the run's
    /// results rather than silently passing (#3349 stage-0 convention).
    /// </summary>
    Target TestDeviceAndroid => _ => _
        .Description("Run the in-process XHarness device tests on a connected Android device/emulator")
        .Executes(() =>
        {
            // The manifest pins microsoft.dotnet.xharness.cli to the dotnet-eng
            // prerelease feed (project-scoped NuGet.config supplies it).
            ProcessTasks.StartProcess(DotNetPath, "tool restore", DeviceTestsDirectory)
                .AssertZeroExitCode();

            var apk = (DeviceTestsDirectory / "bin" / "Release" / "net11.0-android")
                .GlobFiles("**/*-Signed.apk")
                .OrderByDescending(f => File.GetLastWriteTimeUtc(f))
                .FirstOrDefault()
                ?? throw new InvalidOperationException(
                    "Build the device tests APK first: dotnet run --project devops -- CompileDeviceTests");

            var output = DeviceTestsArtifactsDirectory / "xharness";
            output.CreateOrCleanDirectory();

            var udid = Environment.GetEnvironmentVariable("MOBILE_UDID");
            ProcessTasks.StartProcess(DotNetPath,
                XHarnessAndroidTestArguments(apk, output, udid),
                DeviceTestsDirectory).AssertZeroExitCode();
        });

    // A device run must name the packaged instrumentation explicitly — a
    // missing --instrumentation makes XHarness fall back to a discovered name
    // that can point at the app's launcher instead of the test runner. The
    // timeout bounds a hung instrumentation, not the test budget; a real
    // suite finishes in seconds.
    internal static string XHarnessAndroidTestArguments(AbsolutePath apk, AbsolutePath output, string? udid) =>
        $"tool run xharness android test --app \"{apk}\" --package-name {DeviceTestsPackageId}" +
        $" --instrumentation {DeviceTestsPackageId}.TestInstrumentation" +
        $" --output-directory \"{output}\" --timeout 00:10:00" +
        (string.IsNullOrEmpty(udid) ? "" : $" --device-id {udid}");
}
