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

    [Solution("bible-on-site.slnx")] readonly Solution Solution = null!;

    // ============ Project Paths (derived from solution) ============
    AbsolutePath MainProject => Solution.GetProject("BibleOnSite").Path;
    AbsolutePath TestProject => Solution.GetProject("BibleOnSite.Tests").Path;
    AbsolutePath E2ETestProject => Solution.GetProject("BibleOnSite.Tests.E2E").Path;
    AbsolutePath CoreProject => Solution.GetProject("BibleOnSite.Core").Path;

    AbsolutePath SourceDirectory => MainProject.Parent;
    AbsolutePath TestsDirectory => TestProject.Parent;
    AbsolutePath E2ETestsDirectory => E2ETestProject.Parent;
    AbsolutePath CoreDirectory => CoreProject.Parent;
    AbsolutePath ApiDirectory => RootDirectory.Parent / "web" / "api";
}
