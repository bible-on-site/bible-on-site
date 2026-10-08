using Nuke.Common;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    Target Restore => _ => _
        .Description("Restore NuGet packages for all projects")
        .Executes(() =>
        {
            DotNetRestore(s => s.SetProjectFile(MainProject));
            DotNetRestore(s => s.SetProjectFile(TestProject));
        });

    Target RestoreTests => _ => _
        .Description("Restore NuGet packages for test project only (no MAUI workloads needed)")
        .Executes(() =>
        {
            DotNetRestore(s => s.SetProjectFile(TestProject));
        });

    Target RestoreAndroid => _ => _
        .Description("Restore NuGet packages for Android target only")
        .Executes(() =>
        {
            DotNetRestore(s => s
                .SetProjectFile(MainProject)
                .SetProperty("TargetFramework", "net10.0-android"));
        });

    Target RestoreWindows => _ => _
        .Description("Restore NuGet packages for Windows target only")
        .Executes(() =>
        {
            DotNetRestore(s => s
                .SetProjectFile(MainProject)
                .SetProperty("TargetFramework", "net10.0-windows10.0.19041.0"));
        });

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

    Target CompileAndroid => _ => _
        .Description("Build Android target only")
        .DependsOn(RestoreAndroid)
        .Executes(() =>
        {
            DotNetBuild(s => s
                .SetProjectFile(MainProject)
                .SetConfiguration(Configuration)
                .SetFramework("net10.0-android")
                .EnableNoRestore());
        });

    Target CompileWindows => _ => _
        .Description("Build Windows target only (fast development build)")
        .DependsOn(RestoreWindows)
        .Executes(() =>
        {
            DotNetBuild(s => s
                .SetProjectFile(MainProject)
                .SetConfiguration(Configuration)
                .SetFramework("net10.0-windows10.0.19041.0")
                .SetProperty("WindowsPackageType", "None")
                .SetProperty("WindowsAppSDKSelfContained", "true")
                .EnableNoRestore());
            DotNetBuild(s => s
                .SetProjectFile(TestProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore());
        });

    /// <summary>
    /// Compile only the test project (fastest for local development, no MAUI workloads needed).
    /// </summary>
    Target CompileTests => _ => _
        .Description("Build test project only (fastest, no MAUI workloads needed)")
        .DependsOn(RestoreTests)
        .Executes(() =>
        {
            DotNetBuild(s => s
                .SetProjectFile(TestProject)
                .SetConfiguration(Configuration)
                .EnableNoRestore());
        });

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

    Target Lint => _ => _
        .Description("Run code analysis / linting")
        .DependsOn(Restore)
        .Executes(() =>
        {
            // TODO: Add dotnet format or other linting tools
            Serilog.Log.Information("Lint target not yet implemented - add dotnet format or analyzers");
        });

    Target CompileMobileE2E => _ => _
        .Description("Build a complete Debug app for the mobile E2E emulator/simulator")
        .Executes(() =>
        {
            if (!MobileIsAndroid && !MobilePlatform.Equals("iOS", StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException("Set MOBILE_PLATFORM or --mobile-platform to Android or iOS.");
            }

            // Exercise offline startup using packaged SQLite, even if a developer
            // has a local API running. Never direct this UI pilot at production.
            var configPath = SourceDirectory / "Resources" / "Raw" / "api-config.txt";
            var originalConfig = File.Exists(configPath) ? File.ReadAllBytes(configPath) : null;
            try
            {
                File.WriteAllText(configPath, "http://127.0.0.1:1");
                var properties = new Dictionary<string, object>
                {
                    ["TargetFrameworks"] = MobileIsAndroid ? "net10.0-android" : "net10.0-ios",
                    ["RuntimeIdentifier"] = MobileIsAndroid ? "android-x64" : "iossimulator-arm64"
                };
                if (MobileIsAndroid)
                {
                    properties["RuntimeIdentifiers"] = "android-x64";
                    properties["EmbedAssembliesIntoApk"] = "true";
                    properties["AndroidPackageFormats"] = "apk";
                }
                else
                {
                    // ARM64 Debug otherwise interprets the full commentary import.
                    // Compile the indexing/HTML/SQLite hot path as in Release while
                    // retaining interpretation for the rest of the simulator app.
                    // Escape commas: MSBuild treats literal command-line commas
                    // as separate properties, even inside a single argument.
                    // Normalization, reflection-based SQLite mapping and LINQ
                    // also execute in framework assemblies during the import.
                    properties["MtouchInterpreter"] = "all%2C-BibleOnSite%2C-HtmlAgilityPack%2C-SQLite-net%2C-System.Private.CoreLib%2C-System.Runtime%2C-System.Collections%2C-System.Linq%2C-System.Net.Primitives";
                }
                DotNetBuild(s => s
                    .SetProjectFile(MainProject)
                    .SetConfiguration("Debug")
                    .SetProperties(properties));
            }
            finally
            {
                if (originalConfig == null)
                {
                    File.Delete(configPath);
                }
                else
                {
                    File.WriteAllBytes(configPath, originalConfig);
                }
            }
        });
}
