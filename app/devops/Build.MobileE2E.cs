using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.ProjectModel;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    [Parameter("Mobile E2E platform: Android or iOS")]
    readonly string MobilePlatform = Environment.GetEnvironmentVariable("MOBILE_PLATFORM") ?? "";

    AbsolutePath MobileE2ETestProject => Solution.GetProject("BibleOnSite.Tests.MobileE2E").Path;
    bool MobileIsAndroid => MobilePlatform.Equals("Android", StringComparison.OrdinalIgnoreCase);

    Target CompileMobileE2E => _ => _
        .Description("Build a complete Debug app for the mobile E2E emulator/simulator")
        .Executes(() =>
        {
            if (!MobileIsAndroid && !MobilePlatform.Equals("iOS", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Set MOBILE_PLATFORM or --mobile-platform to Android or iOS.");

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
                    ["RuntimeIdentifiers"] = MobileIsAndroid ? "android-x64" : "iossimulator-arm64"
                };
                if (MobileIsAndroid)
                {
                    properties["EmbedAssembliesIntoApk"] = "true";
                    properties["AndroidPackageFormats"] = "apk";
                }
                DotNetBuild(s => s
                    .SetProjectFile(MainProject)
                    .SetConfiguration("Debug")
                    .SetProperties(properties));
            }
            finally
            {
                if (originalConfig == null) File.Delete(configPath);
                else File.WriteAllBytes(configPath, originalConfig);
            }
        });

    Target TestMobileE2E => _ => _
        .Description("Run Appium mobile E2E tests against the explicit device and app")
        .Executes(() =>
        {
            var artifacts = Environment.GetEnvironmentVariable("MOBILE_E2E_ARTIFACTS")
                ?? throw new ArgumentException("Set MOBILE_E2E_ARTIFACTS (npm test prepares it).");
            DotNetTest(s => s
                .SetProjectFile(MobileE2ETestProject)
                .SetConfiguration("Debug")
                .SetProperty("RestoreLockedMode", "true")
                .SetFilter($"Category=MobileE2E&(Platform=Shared|Platform={(MobileIsAndroid ? "Android" : "iOS")})")
                .SetResultsDirectory(Path.Combine(artifacts, "results"))
                .SetLoggers("trx;LogFileName=mobile-e2e.trx", "junit;LogFilePath=" + Path.Combine(artifacts, "results", "mobile-e2e.xml")));
        });

    Target TestMobileE2EUnit => _ => _
        .Description("Validate mobile E2E configuration without a device or MAUI workload")
        .Executes(() => DotNetTest(s => s
            .SetProjectFile(MobileE2ETestProject)
            .SetConfiguration("Debug")
            .SetProperty("RestoreLockedMode", "true")
            .SetFilter("Category=Unit")));
}
