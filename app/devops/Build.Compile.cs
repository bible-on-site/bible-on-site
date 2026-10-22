using Nuke.Common;
using Nuke.Common.IO;
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
            if (WindowsE2ECoverage)
            {
                BuildE2ECoverageRecorder(Configuration);
            }
            DotNetBuild(s =>
            {
                var settings = s
                    .SetProjectFile(MainProject)
                    .SetConfiguration(Configuration)
                    .SetProperty("WindowsPackageType", "None")
                    .SetProperty("WindowsAppSDKSelfContained", "true");
                if (WindowsE2ECoverage)
                {
                    // E2E coverage instrumentation is woven into the FlaUI
                    // build here (#1232). The conditional altcover tool package
                    // needs an in-build restore so the flag is set when
                    // packages resolve; the plural target-frameworks property
                    // narrows that restore to the Windows target only, where
                    // the single-framework switch would still demand the
                    // Mac Catalyst workload on machines without it.
                    settings = settings
                        .SetProperty("TargetFrameworks", "net10.0-windows10.0.19041.0")
                        .SetProperty("E2ECoverage", "true");
                    return settings;
                }
                return settings
                    .SetFramework("net10.0-windows10.0.19041.0")
                    .EnableNoRestore();
            });
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
                    ["RuntimeIdentifier"] = MobileIsAndroid ? "android-x64" : "iossimulator-arm64",
                    // #2120: e2e app builds never emit analytics. Debug already
                    // defaults DisableAnalytics on, but the explicit property
                    // keeps the protection build-flag driven rather than
                    // configuration-derived, so a future non-Debug e2e build
                    // stays dark too.
                    ["DisableAnalytics"] = "true"
                };
                if (MobileIsAndroid)
                {
                    properties["RuntimeIdentifiers"] = "android-x64";
                    properties["EmbedAssembliesIntoApk"] = "true";
                    properties["AndroidPackageFormats"] = "apk";
                    // Android Debug defaults to the Mono interpreter; an
                    // interpreted recorder pays a slow dispatch per woven
                    // Visit and starves the commentary-index build past the
                    // 45s search wait, same as on iOS. JIT is available on
                    // Android, so coverage builds skip interpretation (#1232).
                    if (MobileE2ECoverage)
                    {
                        properties["UseInterpreter"] = "false";
                    }
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
                    // Reader layout, binding and UIKit callbacks are also hot
                    // paths during native snapshots and scrolling. Compile the
                    // UI framework/bindings as in Release instead of crossing
                    // into the interpreter for every control update.
                    properties["MtouchInterpreter"] = "all%2C-BibleOnSite%2C-HtmlAgilityPack%2C-SQLite-net%2C-System.Private.CoreLib%2C-System.Runtime%2C-System.Collections%2C-System.Linq%2C-System.Net.Primitives%2C-Microsoft.Maui%2C-Microsoft.Maui.Controls%2C-Microsoft.Maui.Graphics%2C-Microsoft.iOS";
                    // The E2E coverage recorder answers every sequence point in
                    // the app — a single commentary-index import records tens of
                    // millions of visits. Interpreted, each Visit costs
                    // microseconds (plus the AOT→interpreter transition), which
                    // starved the UI thread past the 45s search-result wait in
                    // CI. AOT the recorder like the rest of the hot path (#1232).
                    if (MobileE2ECoverage)
                    {
                        properties["MtouchInterpreter"] += "%2C-AltCover.Recorder.g";
                    }
                }
                // #1232: weave app-process coverage into the test build only.
                if (MobileE2ECoverage)
                {
                    BuildE2ECoverageRecorder("Debug");
                    properties["E2ECoverage"] = "true";
                }
                DotNetBuild(s => s
                    .SetProjectFile(MainProject)
                    .SetConfiguration("Debug")
                    .SetProperties(properties));

                if (MobileE2ECoverage)
                {
                    PublishE2ECoverageBuildArtifacts();
                }
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

    /// <summary>
    /// Builds the Release-configuration APK the startup smoke installs and
    /// launches (#2373). Debug/e2e builds define DISABLE_ANALYTICS, so this
    /// target deliberately does not: only the Release pipeline compiles the
    /// MainActivity analytics initialization that crashed #2247 store builds.
    /// The store ships an arm64 AAB; the emulator image is x86_64, so the
    /// guard builds the same Release pipeline (profiled AOT, R8, embedded
    /// assemblies, merged manifest) for the ABI the device can run — the APK
    /// format and ABI are the documented differences, not the compiled code.
    /// </summary>
    Target CompileAndroidReleaseSmoke => _ => _
        .Description("Build the Release Android APK exercised by the startup smoke guard (#2373)")
        .Executes(() =>
        {
            // Same offline-startup stub as CompileMobileE2E: the smoke must
            // never reach the production API, and the packaged SQLite keeps
            // the reader usable without it.
            var configPath = SourceDirectory / "Resources" / "Raw" / "api-config.txt";
            var originalConfig = File.Exists(configPath) ? File.ReadAllBytes(configPath) : null;
            try
            {
                File.WriteAllText(configPath, "http://127.0.0.1:1");
                DotNetBuild(s => s
                    .SetProjectFile(MainProject)
                    .SetConfiguration("Release")
                    .SetProperties(new Dictionary<string, object>
                    {
                        ["TargetFrameworks"] = "net10.0-android",
                        ["RuntimeIdentifier"] = "android-x64",
                        ["RuntimeIdentifiers"] = "android-x64",
                        ["AndroidPackageFormat"] = "apk",
                        ["EmbedAssembliesIntoApk"] = "true",
                    }));

                // Stage the checked artifact beside its provenance so a later
                // clean/bin sweep cannot detach what was validated from what
                // was built. release-smoke.mjs installs this exact file.
                var apk = (SourceDirectory / "bin" / "Release" / "net10.0-android")
                    .GlobFiles("**/*-Signed.apk")
                    .OrderByDescending(f => File.GetLastWriteTimeUtc(f))
                    .FirstOrDefault()
                    ?? throw new InvalidOperationException(
                        "The Release smoke build produced no signed APK under bin/Release/net10.0-android.");
                var smokeDirectory = MobileE2EArtifactsDirectory / "release-smoke";
                smokeDirectory.CreateOrCleanDirectory();
                var staged = smokeDirectory / "app-release-smoke.apk";
                apk.Copy(staged, ExistsPolicy.FileOverwrite);

                var manifest = new Dictionary<string, object?>
                {
                    ["kind"] = "android-release-smoke-build/1",
                    ["sourceSha"] = Nuke.Common.Tools.Git.GitTasks.GitCurrentCommit(),
                    ["configuration"] = "Release",
                    ["runtimeIdentifier"] = "android-x64",
                    ["packageFormat"] = "apk",
                    ["analyticsCompiledIn"] = true,
                    ["apkSha256"] = Convert.ToHexString(
                        System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(staged))).ToLowerInvariant(),
                    ["builtUtc"] = DateTime.UtcNow.ToString("o"),
                    // Remaining deltas vs the store-delivered arm64 AAB (#2371):
                    // package format, ABI and the debug-key signature.
                    ["knownDifferences"] = new[]
                    {
                        "apk-x86_64 emulator build; store ships an arm64 AAB",
                        "debug-keystore signature; Play re-signs the store artifact",
                    },
                };
                File.WriteAllText(smokeDirectory / "build-manifest.json",
                    System.Text.Json.JsonSerializer.Serialize(manifest, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                Serilog.Log.Information($"Release smoke APK staged at {staged}");
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

    /// <summary>
    /// Builds the AltCover.Recorder.g substitute the instrumented app
    /// references by path (#1232). Kept out of the app's restore graph so the
    /// app build's global TargetFrameworks cannot retarget it.
    /// </summary>
    void BuildE2ECoverageRecorder(string configuration)
    {
        var recorderProject = RootDirectory / "BibleOnSite.E2eCoverage" / "BibleOnSite.E2eCoverage.csproj";
        DotNetBuild(s => s
            .SetProjectFile(recorderProject)
            .SetConfiguration(configuration));
    }

    /// <summary>
    /// Copies the AltCover OpenCover template produced by the instrumented
    /// build into the E2E artifacts directory and records build provenance
    /// (#1232). The template is required to map per-test hit dumps back to
    /// source lines; its module hash only matches the assembly built in this
    /// exact pass, so it always travels with the build.
    /// </summary>
    void PublishE2ECoverageBuildArtifacts()
    {
        // The intermediate output path is empty in single-TFM global-property builds, so glob the project directory for either layout.
        var templates = SourceDirectory.GlobFiles("**/e2e-coverage/template.opencover.xml");
        if (templates.Count == 0)
        {
            throw new InvalidOperationException(
                "E2E coverage instrumentation did not produce a template; " +
                "the app was not built with -p:E2ECoverage=true.");
        }
        var coverageApp = MobileE2EArtifactsDirectory / "coverage-app";
        coverageApp.CreateOrCleanDirectory();
        templates.OrderByDescending(t => File.GetLastWriteTimeUtc(t)).First()
            .Copy(coverageApp / "template.opencover.xml", ExistsPolicy.FileOverwrite);

        var manifest = new Dictionary<string, object?>
        {
            ["kind"] = "app-e2e-coverage-build/1",
            ["sourceSha"] = Nuke.Common.Tools.Git.GitTasks.GitCurrentCommit(),
            ["platform"] = MobilePlatform,
            ["configuration"] = "Debug",
            ["collector"] = $"altcover-instrumented-app",
            ["collectorVersion"] = GetAppProperty("AltCoverVersion"),
            ["builtUtc"] = DateTime.UtcNow.ToString("o")
        };
        File.WriteAllText(coverageApp / "coverage-manifest.json",
            System.Text.Json.JsonSerializer.Serialize(manifest, new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        Serilog.Log.Information($"E2E coverage build artifacts published to {coverageApp}");
    }

    /// <summary>Reads a property value from the app project file.</summary>
    string GetAppProperty(string name)
    {
        var doc = System.Xml.Linq.XDocument.Load(MainProject);
        return doc.Descendants().FirstOrDefault(e => e.Name.LocalName == name)?.Value ?? "";
    }
}
