using System;
using System.Linq;
using Nuke.Common;
using Nuke.Common.CI;
using Nuke.Common.Execution;
using Nuke.Common.IO;
using Nuke.Common.Tools.DotNet;
using Nuke.Common.Utilities.Collections;
using static Nuke.Common.IO.FileSystemTasks;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

/// <summary>
/// NUKE build automation for BibleOnSite MAUI app.
///
/// Usage:
///   dotnet nuke [target] [options]
///
/// Examples:
///   dotnet nuke Compile
///   dotnet nuke RunWindows
///   dotnet nuke Test
///   dotnet nuke --help
/// </summary>
class Build : NukeBuild
{
    public static int Main() => Execute<Build>(x => x.Compile);

    [Parameter("Configuration to build - Default is 'Debug' (local) or 'Release' (server)")]
    readonly Configuration Configuration = IsLocalBuild ? Configuration.Debug : Configuration.Release;

    AbsolutePath SourceDirectory => RootDirectory / "BibleOnSite";
    AbsolutePath TestsDirectory => RootDirectory / "BibleOnSite.Tests";
    AbsolutePath CoreDirectory => RootDirectory / "BibleOnSite.Core";
    AbsolutePath ApiDirectory => RootDirectory.Parent / "web" / "api";

    AbsolutePath MainProject => SourceDirectory / "BibleOnSite.csproj";
    AbsolutePath TestProject => TestsDirectory / "BibleOnSite.Tests.csproj";
    AbsolutePath CoreProject => CoreDirectory / "BibleOnSite.Core.csproj";

    // ============ Clean ============
    Target Clean => _ => _
        .Description("Clean build outputs")
        .Executes(() =>
        {
            SourceDirectory.GlobDirectories("**/bin", "**/obj").ForEach(x => x.DeleteDirectory());
            TestsDirectory.GlobDirectories("**/bin", "**/obj").ForEach(x => x.DeleteDirectory());
        });

    // ============ Restore ============
    Target Restore => _ => _
        .Description("Restore NuGet packages")
        .Executes(() =>
        {
            DotNetRestore(s => s.SetProjectFile(MainProject));
            DotNetRestore(s => s.SetProjectFile(TestProject));
        });

    // ============ Compile ============
    Target Compile => _ => _
        .Description("Build all projects")
        .DependsOn(Restore)
        .Executes(() =>
        {
            DotNetBuild(s => s
                .SetProjectFile(MainProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore());
            DotNetBuild(s => s
                .SetProjectFile(TestProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore());
        });

    // ============ Lint ============
    Target Lint => _ => _
        .Description("Run code analysis / linting")
        .DependsOn(Restore)
        .Executes(() =>
        {
            // TODO: Add dotnet format or other linting tools
            // DotNetFormat(s => s.SetProject(Solution));
            Serilog.Log.Information("Lint target not yet implemented - add dotnet format or analyzers");
        });

    // ============ Test Targets ============
    Target Test => _ => _
        .Description("Run all tests (unit + integration)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            DotNetTest(s => s
                .SetProjectFile(TestsDirectory / "BibleOnSite.Tests.csproj")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target TestUnit => _ => _
        .Description("Run unit tests only (no API required)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            DotNetTest(s => s
                .SetProjectFile(TestsDirectory / "BibleOnSite.Tests.csproj")
                .SetConfiguration(Configuration)
                .SetFilter("Category!=Integration")
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target TestIntegration => _ => _
        .Description("Run integration tests (requires API server)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Start API server if not running
            // See StartApi target for implementation hints

            DotNetTest(s => s
                .SetProjectFile(TestsDirectory / "BibleOnSite.Tests.csproj")
                .SetConfiguration(Configuration)
                .SetFilter("Category=Integration")
                .EnableNoRestore()
                .EnableNoBuild());
        });

    // ============ Coverage Targets ============
    Target CoverageUnit => _ => _
        .Description("Run unit tests with coverage")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Add coverlet or other coverage tool
            // DotNetTest with --collect:"XPlat Code Coverage"
            Serilog.Log.Information("Coverage target not yet implemented - add coverlet integration");

            DotNetTest(s => s
                .SetProjectFile(TestsDirectory / "BibleOnSite.Tests.csproj")
                .SetConfiguration(Configuration)
                .SetFilter("Category!=Integration")
                .EnableNoRestore()
                .EnableNoBuild()
                .SetDataCollector("XPlat Code Coverage"));
        });

    Target CoverageIntegration => _ => _
        .Description("Run integration tests with coverage")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Start API server if not running

            DotNetTest(s => s
                .SetProjectFile(TestsDirectory / "BibleOnSite.Tests.csproj")
                .SetConfiguration(Configuration)
                .SetFilter("Category=Integration")
                .EnableNoRestore()
                .EnableNoBuild()
                .SetDataCollector("XPlat Code Coverage"));
        });

    Target CoverageAll => _ => _
        .Description("Run all tests with coverage and merge reports")
        .DependsOn(CoverageUnit, CoverageIntegration)
        .Executes(() =>
        {
            // TODO: Merge coverage reports
            Serilog.Log.Information("Coverage merge not yet implemented");
        });

    // ============ Run / Launch Targets ============
    Target StartApi => _ => _
        .Description("Start the API server (background)")
        .Executes(() =>
        {
            // TODO: Implement API server start
            // Check if already running on port 3003
            // If not, start cargo make run-api in background
            Serilog.Log.Information("StartApi target not yet implemented");
            Serilog.Log.Information("Manually run: cd web/api && cargo make run-api");
        });

    Target RunWindows => _ => _
        .Description("Run app on Windows (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Add StartApi dependency when implemented

            DotNetRun(s => s
                .SetProjectFile(SourceDirectory / "BibleOnSite.csproj")
                .SetFramework("net9.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunAndroid => _ => _
        .Description("Run app on Android emulator (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Add StartApi dependency when implemented

            DotNetRun(s => s
                .SetProjectFile(SourceDirectory / "BibleOnSite.csproj")
                .SetFramework("net9.0-android")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunIos => _ => _
        .Description("Run app on iOS simulator (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Add StartApi dependency when implemented

            DotNetRun(s => s
                .SetProjectFile(SourceDirectory / "BibleOnSite.csproj")
                .SetFramework("net9.0-ios")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunMac => _ => _
        .Description("Run app on Mac Catalyst (starts API if needed)")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Add StartApi dependency when implemented

            DotNetRun(s => s
                .SetProjectFile(SourceDirectory / "BibleOnSite.csproj")
                .SetFramework("net9.0-maccatalyst")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    // ============ Package / Publish Targets ============
    Target Package => _ => _
        .Description("Package app for distribution")
        .DependsOn(Compile)
        .Executes(() =>
        {
            // TODO: Implement publishing for each platform
            // DotNetPublish for each framework
            Serilog.Log.Information("Package target not yet implemented");
        });

    Target Version => _ => _
        .Description("Display current version")
        .Executes(() =>
        {
            // TODO: Read version from csproj or Directory.Build.props
            Serilog.Log.Information("Version target not yet implemented");
        });
}
