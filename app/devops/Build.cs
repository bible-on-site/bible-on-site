using System;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using Nuke.Common;
using Nuke.Common.CI;
using Nuke.Common.Execution;
using Nuke.Common.IO;
using Nuke.Common.Tools.DotNet;
using Nuke.Common.Utilities.Collections;
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
    readonly string Configuration = IsLocalBuild ? "Debug" : "Release";

    AbsolutePath SourceDirectory => RootDirectory / "BibleOnSite";
    AbsolutePath TestsDirectory => RootDirectory / "BibleOnSite.Tests";
    AbsolutePath E2ETestsDirectory => RootDirectory / "BibleOnSite.Tests.E2E";
    AbsolutePath CoreDirectory => RootDirectory / "BibleOnSite.Core";
    AbsolutePath ApiDirectory => RootDirectory.Parent / "web" / "api";

    AbsolutePath MainProject => SourceDirectory / "BibleOnSite.csproj";
    AbsolutePath TestProject => TestsDirectory / "BibleOnSite.Tests.csproj";
    AbsolutePath E2ETestProject => E2ETestsDirectory / "BibleOnSite.Tests.E2E.csproj";
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

    // ============ CompileWindows (Fast) ============
    Target CompileWindows => _ => _
        .Description("Build Windows target only (fast development build)")
        .DependsOn(Restore)
        .Executes(() =>
        {
            DotNetBuild(s => s
                .SetProjectFile(MainProject)
                .SetConfiguration(Configuration)
                .SetFramework("net9.0-windows10.0.19041.0")
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
    // Note: Test project includes source files directly (not a project reference),
    // so it compiles independently and doesn't need the main MAUI project to be built.

    /// <summary>
    /// Compile only the test project (fastest for local development).
    /// </summary>
    Target CompileTests => _ => _
        .Description("Build test project only (fastest)")
        .DependsOn(Restore)
        .Executes(() =>
        {
            DotNetBuild(s => s
                .SetProjectFile(TestProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore());
        });

    Target Test => _ => _
        .Description("Run all tests (unit + integration) - for CI, compiles all platforms first")
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
        .Description("Run unit tests only (fast - only compiles test project)")
        .DependsOn(CompileTests)
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
        .DependsOn(CompileTests)
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

    // ============ E2E Test Targets ============
    Target CompileE2E => _ => _
        .Description("Build E2E tests and Windows app")
        .DependsOn(CompileWindows)
        .Executes(() =>
        {
            DotNetRestore(s => s.SetProjectFile(E2ETestProject));
            DotNetBuild(s => s
                .SetProjectFile(E2ETestProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore());
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

    /// <summary>
    /// Checks if API server is running on port 3003.
    /// </summary>
    bool IsApiRunning()
    {
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var response = client.GetAsync("http://localhost:3003/api/graphql").Result;
            return response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.BadRequest;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Starts the API server in background if not already running.
    /// </summary>
    void EnsureApiRunning()
    {
        if (IsApiRunning())
        {
            Serilog.Log.Information("API server already running on port 3003");
            return;
        }

        Serilog.Log.Information("Starting API server...");

        var apiPath = ApiDirectory;
        var startInfo = new ProcessStartInfo
        {
            FileName = "cargo",
            Arguments = "make run-api",
            WorkingDirectory = apiPath,
            UseShellExecute = true,
            CreateNoWindow = false,
        };

        var process = Process.Start(startInfo);
        if (process == null)
        {
            Serilog.Log.Warning("Failed to start API server process");
            return;
        }

        // Wait for API to be ready (max 120 seconds - Rust compilation can take a while)
        var timeout = DateTime.Now.AddSeconds(120);
        var attempts = 0;
        while (DateTime.Now < timeout)
        {
            attempts++;
            System.Threading.Thread.Sleep(2000);
            if (IsApiRunning())
            {
                Serilog.Log.Information($"API server started successfully (after ~{attempts * 2} seconds)");
                return;
            }
            if (attempts % 10 == 0)
            {
                Serilog.Log.Information($"Still waiting for API... ({attempts * 2}s elapsed)");
            }
        }

        Serilog.Log.Warning("API server did not respond within 120 seconds - check the API terminal");
    }

    Target StartApi => _ => _
        .Description("Start the API server (background)")
        .Executes(() =>
        {
            EnsureApiRunning();
        });

    /// <summary>
    /// Dev target - one command to start everything for local development.
    /// Similar to "npm run dev" or "next dev".
    /// </summary>
    Target Dev => _ => _
        .Description("Start local development environment (API + Windows app)")
        .DependsOn(CompileWindows)
        .Executes(() =>
        {
            // Ensure API is running
            EnsureApiRunning();

            // Run the Windows app
            DotNetRun(s => s
                .SetProjectFile(SourceDirectory / "BibleOnSite.csproj")
                .SetFramework("net9.0-windows10.0.19041.0")
                .SetConfiguration(Configuration)
                .EnableNoRestore()
                .EnableNoBuild());
        });

    Target RunWindows => _ => _
        .Description("Run app on Windows (use 'Dev' target for full environment)")
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
