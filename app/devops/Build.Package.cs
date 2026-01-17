using System.Text.RegularExpressions;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tools.DotNet;
using static Nuke.Common.Tools.DotNet.DotNetTasks;

partial class Build
{
    // ============ Package Output ============
    AbsolutePath ArtifactsDirectory => RootDirectory / ".artifacts";

    // ============ Package Parameters ============
    [Parameter("Target platform for packaging: Windows, Android, or All")]
    readonly string Platform = "All";

    [Parameter("Windows signing certificate thumbprint (for MSIX signing)")]
    readonly string? CertificateThumbprint;

    [Parameter("Android keystore path")]
    readonly string? AndroidKeystore;

    [Parameter("Android keystore password")]
    readonly string? AndroidKeystorePassword;

    [Parameter("Android key alias")]
    readonly string? AndroidKeyAlias;

    [Parameter("Android key password")]
    readonly string? AndroidKeyPassword;

    Target Package => _ => _
        .Description("Package app for distribution (Windows MSIX and/or Android AAB)")
        .DependsOn(PackagePrepare)
        .Executes(() =>
        {
            ArtifactsDirectory.CreateOrCleanDirectory();

            var version = GetCurrentVersion();
            Serilog.Log.Information($"Packaging version: {version}");

            if (Platform.Equals("Windows", StringComparison.OrdinalIgnoreCase) || Platform.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                if (OperatingSystem.IsWindows())
                {
                    PackageWindows(version);
                }
                else
                {
                    Serilog.Log.Warning("Skipping Windows packaging - not running on Windows");
                }
            }

            if (Platform.Equals("Android", StringComparison.OrdinalIgnoreCase) || Platform.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                PackageAndroid(version);
            }
        });

    Target PackagePrepare => _ => _
        .Description("Prepare for packaging by restoring and compiling the appropriate platform")
        .Unlisted()
        .Executes(() =>
        {
            // This target dynamically decides what to compile based on Platform parameter
            if (Platform.Equals("Windows", StringComparison.OrdinalIgnoreCase))
            {
                if (OperatingSystem.IsWindows())
                {
                    DotNetRestore(s => s
                        .SetProjectFile(MainProject)
                        .SetProperty("TargetFramework", "net9.0-windows10.0.19041.0")
                        .SetRuntime("win-x64"));
                    DotNetBuild(s => s
                        .SetProjectFile(MainProject)
                        .SetConfiguration(Configuration)
                        .SetFramework("net9.0-windows10.0.19041.0")
                        .SetRuntime("win-x64")
                        .EnableNoRestore());
                }
            }
            else if (Platform.Equals("Android", StringComparison.OrdinalIgnoreCase))
            {
                DotNetRestore(s => s
                    .SetProjectFile(MainProject)
                    .SetProperty("TargetFramework", "net9.0-android"));
                DotNetBuild(s => s
                    .SetProjectFile(MainProject)
                    .SetConfiguration(Configuration)
                    .SetFramework("net9.0-android")
                    .EnableNoRestore());
            }
            else
            {
                // For "All", restore and build everything (requires all workloads)
                DotNetRestore(s => s.SetProjectFile(MainProject));
                DotNetBuild(s => s
                    .SetProjectFile(MainProject)
                    .SetConfiguration(Configuration)
                    .EnableNoRestore());
            }
        });

    void PackageWindows(string version)
    {
        Serilog.Log.Information("Packaging for Windows (MSIX)...");

        var msbuildProperties = new Dictionary<string, object>
        {
            ["WindowsPackageType"] = "MSIX",
            ["GenerateAppxPackageOnBuild"] = "true",
            ["AppxPackageDir"] = $"{ArtifactsDirectory}/",
            ["AppxPackageSigningEnabled"] = "true",
            ["TargetFramework"] = "net9.0-windows10.0.19041.0"
        };

        if (!string.IsNullOrEmpty(CertificateThumbprint))
        {
            msbuildProperties["PackageCertificateThumbprint"] = CertificateThumbprint;
            Serilog.Log.Information($"Using certificate thumbprint: {CertificateThumbprint}");
        }

        DotNetPublish(s => s
            .SetProject(MainProject)
            .SetConfiguration(Configuration)
            .SetFramework("net9.0-windows10.0.19041.0")
            .SetRuntime("win-x64")
            .SetProperties(msbuildProperties)
            .EnableNoRestore());

        Serilog.Log.Information($"Windows MSIX package created in {ArtifactsDirectory}");
    }

    void PackageAndroid(string version)
    {
        Serilog.Log.Information("Packaging for Android (AAB)...");

        var msbuildProperties = new Dictionary<string, object>
        {
            ["AndroidPackageFormat"] = "aab",
            ["TargetFramework"] = "net9.0-android"
        };

        // Add signing configuration if provided
        if (!string.IsNullOrEmpty(AndroidKeystore))
        {
            msbuildProperties["AndroidKeyStore"] = "true";
            msbuildProperties["AndroidSigningKeyStore"] = AndroidKeystore;
            msbuildProperties["AndroidSigningStorePass"] = AndroidKeystorePassword ?? "";
            msbuildProperties["AndroidSigningKeyAlias"] = AndroidKeyAlias ?? "";
            msbuildProperties["AndroidSigningKeyPass"] = AndroidKeyPassword ?? "";
            Serilog.Log.Information("Android signing enabled with provided keystore");
        }
        else
        {
            Serilog.Log.Warning("No Android keystore provided - building unsigned AAB");
        }

        DotNetPublish(s => s
            .SetProject(MainProject)
            .SetConfiguration(Configuration)
            .SetFramework("net9.0-android")
            .SetOutput(ArtifactsDirectory)
            .SetProperties(msbuildProperties)
            .EnableNoRestore());

        Serilog.Log.Information($"Android AAB package created in {ArtifactsDirectory}");
    }

    Target Version => _ => _
        .Description("Display current version from csproj")
        .Executes(() =>
        {
            var version = GetCurrentVersion();
            var buildNumber = GetCurrentBuildNumber();
            Serilog.Log.Information($"ApplicationDisplayVersion: {version}");
            Serilog.Log.Information($"ApplicationVersion (build number): {buildNumber}");
        });

    Target BumpVersion => _ => _
        .Description("Bump version (patch) and increment build number")
        .Executes(() =>
        {
            var csprojPath = MainProject;
            var content = csprojPath.ReadAllText();

            // Bump ApplicationDisplayVersion (SemVer patch)
            var displayVersionRegex = new Regex(@"<ApplicationDisplayVersion>(\d+)\.(\d+)\.?(\d*)</ApplicationDisplayVersion>");
            var displayMatch = displayVersionRegex.Match(content);
            if (displayMatch.Success)
            {
                var major = int.Parse(displayMatch.Groups[1].Value);
                var minor = int.Parse(displayMatch.Groups[2].Value);
                var patch = string.IsNullOrEmpty(displayMatch.Groups[3].Value) ? 0 : int.Parse(displayMatch.Groups[3].Value);
                var newVersion = $"{major}.{minor}.{patch + 1}";
                content = displayVersionRegex.Replace(content, $"<ApplicationDisplayVersion>{newVersion}</ApplicationDisplayVersion>");
                Serilog.Log.Information($"Bumped ApplicationDisplayVersion: {major}.{minor}.{patch} → {newVersion}");
            }

            // Bump ApplicationVersion (integer build number)
            var buildVersionRegex = new Regex(@"<ApplicationVersion>(\d+)</ApplicationVersion>");
            var buildMatch = buildVersionRegex.Match(content);
            if (buildMatch.Success)
            {
                var buildNumber = int.Parse(buildMatch.Groups[1].Value);
                var newBuildNumber = buildNumber + 1;
                content = buildVersionRegex.Replace(content, $"<ApplicationVersion>{newBuildNumber}</ApplicationVersion>");
                Serilog.Log.Information($"Bumped ApplicationVersion: {buildNumber} → {newBuildNumber}");
            }

            csprojPath.WriteAllText(content);
            Serilog.Log.Information($"Updated {csprojPath}");
        });

    string GetCurrentVersion()
    {
        var content = MainProject.ReadAllText();
        var match = Regex.Match(content, @"<ApplicationDisplayVersion>([^<]+)</ApplicationDisplayVersion>");
        return match.Success ? match.Groups[1].Value : "0.0.0";
    }

    int GetCurrentBuildNumber()
    {
        var content = MainProject.ReadAllText();
        var match = Regex.Match(content, @"<ApplicationVersion>(\d+)</ApplicationVersion>");
        return match.Success ? int.Parse(match.Groups[1].Value) : 1;
    }
}
