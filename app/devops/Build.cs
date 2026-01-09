using System;
using System.Collections.Generic;
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
partial class Build : NukeBuild
{
    public static int Main() => Execute<Build>(x => x.Compile);

    [Parameter("Configuration to build - Default is 'Debug' (local) or 'Release' (server)")]
    readonly string Configuration = IsLocalBuild ? "Debug" : "Release";

    // ============ Project Paths ============
    AbsolutePath SourceDirectory => RootDirectory / "BibleOnSite";
    AbsolutePath TestsDirectory => RootDirectory / "BibleOnSite.Tests";
    AbsolutePath E2ETestsDirectory => RootDirectory / "BibleOnSite.Tests.E2E";
    AbsolutePath CoreDirectory => RootDirectory / "BibleOnSite.Core";
    AbsolutePath ApiDirectory => RootDirectory.Parent / "web" / "api";

    AbsolutePath MainProject => SourceDirectory / "BibleOnSite.csproj";
    AbsolutePath TestProject => TestsDirectory / "BibleOnSite.Tests.csproj";
    AbsolutePath E2ETestProject => E2ETestsDirectory / "BibleOnSite.Tests.E2E.csproj";
    AbsolutePath CoreProject => CoreDirectory / "BibleOnSite.Core.csproj";
}
