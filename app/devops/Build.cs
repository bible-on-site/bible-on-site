using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using Nuke.Common;
using Nuke.Common.CI;
using Nuke.Common.Execution;
using Nuke.Common.IO;
using Nuke.Common.ProjectModel;
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
partial class Build : NukeBuild
{
    public static int Main() => Execute<Build>(x => x.Compile);

    [Parameter("Configuration to build - Default is 'Debug' (local) or 'Release' (server)")]
    readonly string Configuration = IsLocalBuild ? "Debug" : "Release";

    [Parameter("Mobile E2E platform: Android or iOS")]
    readonly string MobilePlatform = Environment.GetEnvironmentVariable("MOBILE_PLATFORM") ?? "";

    bool MobileIsAndroid => MobilePlatform.Equals("Android", StringComparison.OrdinalIgnoreCase);

    // #1232: instrument the app build and collect real app-process coverage.
    bool MobileE2ECoverage =>
        Environment.GetEnvironmentVariable("MOBILE_E2E_COVERAGE") is { } flag &&
        (flag.Equals("1", StringComparison.OrdinalIgnoreCase) ||
         flag.Equals("true", StringComparison.OrdinalIgnoreCase));

    // Same instrumentation for the Windows/FlaUI suite (E2E_COVERAGE).
    bool WindowsE2ECoverage =>
        Environment.GetEnvironmentVariable("E2E_COVERAGE") is { } flag &&
        (flag.Equals("1", StringComparison.OrdinalIgnoreCase) ||
         flag.Equals("true", StringComparison.OrdinalIgnoreCase));

    // The harness drops per-test coverage dumps under <artifacts>/app-coverage;
    // build coverage artifacts (OpenCover template, manifest, merged reports)
    // live in <artifacts>/coverage-app so diagnostics stay per-platform.
    AbsolutePath MobileE2EArtifactsDirectory => AbsolutePath.Create(
        Environment.GetEnvironmentVariable("MOBILE_E2E_ARTIFACTS")
        ?? (RootDirectory / ".artifacts" / "mobile-e2e" / (MobileIsAndroid ? "android" : "ios")).ToString());

    [Solution("bible-on-site.slnx")] readonly Solution Solution = null!;

    // ============ Project Paths (derived from solution) ============
    AbsolutePath MainProject => Solution.GetProject("BibleOnSite").Path;
    AbsolutePath TestProject => Solution.GetProject("BibleOnSite.Tests").Path;
    AbsolutePath E2ETestProject => Solution.GetProject("BibleOnSite.Tests.E2E").Path;
    AbsolutePath MobileE2ETestProject => Solution.GetProject("BibleOnSite.Tests.MobileE2E").Path;
    AbsolutePath CoreProject => Solution.GetProject("BibleOnSite.Core").Path;

    AbsolutePath SourceDirectory => MainProject.Parent;
    AbsolutePath TestsDirectory => TestProject.Parent;
    AbsolutePath E2ETestsDirectory => E2ETestProject.Parent;
    AbsolutePath CoreDirectory => CoreProject.Parent;
    AbsolutePath ApiDirectory => RootDirectory.Parent / "web" / "api";
}
