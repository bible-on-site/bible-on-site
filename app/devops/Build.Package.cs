using System.Text.RegularExpressions;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tooling;
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

    [Parameter("iOS Team ID")]
    readonly string? IosTeamId;

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
                    PackageWindows();
                }
                else
                {
                    Serilog.Log.Warning("Skipping Windows packaging - not running on Windows");
                }
            }

            if (Platform.Equals("Android", StringComparison.OrdinalIgnoreCase) || Platform.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                PackageAndroid();
            }

            if (Platform.Equals("iOS", StringComparison.OrdinalIgnoreCase) || Platform.Equals("All", StringComparison.OrdinalIgnoreCase))
            {
                if (OperatingSystem.IsMacOS())
                {
                    PackageIos();
                }
                else
                {
                    Serilog.Log.Warning("Skipping iOS packaging - not running on macOS");
                }
            }
        });

    Target PackagePrepare => _ => _
        .Description("Prepare for packaging by restoring the appropriate platform")
        .Unlisted()
        .Executes(() =>
        {
            var platforms = Platform.Equals("All", StringComparison.OrdinalIgnoreCase)
                ? new[] { "Android", OperatingSystem.IsMacOS() ? "iOS" : "Windows" }
                : new[] { Platform };
            foreach (var platform in platforms)
            {
                ProcessTasks.StartProcess(OperatingSystem.IsWindows() ? "python" : "python3",
                    $"\"{RootDirectory / "devops/prepare_recitation_assets.py"}\" --platform {platform}", RootDirectory)
                    .AssertZeroExitCode();
            }

            // Generate extension assets before project evaluation, then restore the target platform.
            if (Platform.Equals("Windows", StringComparison.OrdinalIgnoreCase))
            {
                if (OperatingSystem.IsWindows())
                {
                    // Restore with RuntimeIdentifier to get RID-specific packages for PublishReadyToRun
                    DotNetRestore(s => s
                        .SetProjectFile(MainProject)
                        .SetProperty("TargetFramework", "net10.0-windows10.0.19041.0")
                        .SetProperty("RuntimeIdentifier", "win-x64")
                        .SetProperty("PublishReadyToRun", "true"));
                }
            }
            else if (Platform.Equals("Android", StringComparison.OrdinalIgnoreCase))
            {
                DotNetRestore(s => s
                    .SetProjectFile(MainProject)
                    .SetProperty("TargetFramework", "net10.0-android")
                    .SetProperty("RuntimeIdentifiers", "android-arm64")
                    .SetRuntime("android-arm64"));
            }
            else if (Platform.Equals("iOS", StringComparison.OrdinalIgnoreCase))
            {
                DotNetRestore(s => s
                    .SetProjectFile(MainProject)
                    .SetProperty("TargetFramework", "net10.0-ios")
                    .SetProperty("RuntimeIdentifier", "ios-arm64"));
            }
            else
            {
                // For "All", restore and build everything (requires all workloads)
                DotNetRestore(s => s.SetProjectFile(MainProject));
            }
        });

    void PackageWindows()
    {
        Serilog.Log.Information("Packaging for Windows (MSIX)...");

        var msbuildProperties = new Dictionary<string, object>
        {
            ["WindowsPackageType"] = "MSIX",
            ["GenerateAppxPackageOnBuild"] = "true",
            ["AppxPackageDir"] = $"{ArtifactsDirectory}/",
            ["AppxPackageSigningEnabled"] = "true",
            ["TargetFramework"] = "net10.0-windows10.0.19041.0",
            ["RequireRecitationAssets"] = "true",
            // Microsoft Store requires revision (4th component) to be 0
            // Override ApplicationVersion to 0 to produce X.Y.Z.0 version format
            ["ApplicationVersion"] = "0"
        };

        if (!string.IsNullOrEmpty(CertificateThumbprint))
        {
            msbuildProperties["PackageCertificateThumbprint"] = CertificateThumbprint;
            Serilog.Log.Information($"Using certificate thumbprint: {CertificateThumbprint}");
        }

        DotNetPublish(s => s
            .SetProject(MainProject)
            .SetConfiguration(Configuration)
            .SetFramework("net10.0-windows10.0.19041.0")
            .SetRuntime("win-x64")
            .SetProperties(msbuildProperties)
            .EnableNoRestore());

        Serilog.Log.Information($"Windows MSIX package created in {ArtifactsDirectory}");
    }

    void PackageAndroid()
    {
        Serilog.Log.Information("Packaging for Android (AAB)...");

        var msbuildProperties = new Dictionary<string, object>
        {
            ["AndroidPackageFormat"] = "aab",
            ["RequireRecitationAssets"] = "true",
            ["RuntimeIdentifiers"] = "android-arm64"
        };

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
            .SetFramework("net10.0-android")
            .SetRuntime("android-arm64")
            .SetProperties(msbuildProperties)
            .EnableNoRestore());

        // Find and copy AAB to artifacts directory (MAUI doesn't respect --output for AAB)
        var binDir = MainProject.Parent / "bin" / Configuration / "net10.0-android";
        var aabFiles = binDir.GlobFiles("**/*-Signed.aab");

        if (aabFiles.Count > 0)
        {
            foreach (var aab in aabFiles)
            {
                aab.CopyToDirectory(ArtifactsDirectory, ExistsPolicy.FileOverwrite);
                Serilog.Log.Information($"Copied {aab.Name} to {ArtifactsDirectory}");
            }
        }
        else
        {
            Serilog.Log.Warning($"No signed AAB files found in {binDir}");
        }

        Serilog.Log.Information($"Android AAB package created in {ArtifactsDirectory}");
    }

    void PackageIos()
    {
        Serilog.Log.Information("Packaging for iOS (IPA)...");

        var msbuildProperties = new Dictionary<string, object>
        {
            ["TargetFramework"] = "net10.0-ios",
            ["ArchiveOnBuild"] = "true",
            ["BuildIpa"] = "true",
            ["RequireAssetPackDownloader"] = "true",
            ["RequireRecitationAssets"] = "true",
            ["IpaPackageDir"] = $"{ArtifactsDirectory}/",
            ["SupportedOSPlatformVersion"] = "17.0",
            ["_ExcludeSimulatorArchitectures"] = "true"
        };

        // Add code signing configuration
        if (!string.IsNullOrEmpty(IosTeamId))
        {
            msbuildProperties["CodesignKey"] = "Apple Distribution";
            msbuildProperties["CodesignProvision"] = "";
            msbuildProperties["RuntimeIdentifier"] = "ios-arm64";
            Serilog.Log.Information($"iOS code signing enabled with Team ID: {IosTeamId}");
        }
        else
        {
            Serilog.Log.Warning("No iOS Team ID provided - building without specific signing");
        }

        // Managed asset packs need the ExtensionKit downloader extension embedded
        // (built by CI via xcodebuild — .NET cannot produce .appex binaries). The
        // csproj _EmbedAssetPackDownloader target copies and re-signs it.
        var appex = RootDirectory / "extensions" / "AssetPackDownloader" /
            "build" / "Build" / "Products" / "Release-iphoneos" / "AssetPackDownloader.appex";
        if (Directory.Exists(appex) && File.Exists(appex / "Info.plist"))
        {
            msbuildProperties["AssetPackDownloaderAppex"] = $"{appex}/";
            Serilog.Log.Information($"Embedding asset-pack downloader extension: {appex}");
            var extensionProfile = Environment.GetEnvironmentVariable("ASSET_PACK_DOWNLOADER_PROFILE");
            if (!string.IsNullOrEmpty(extensionProfile) && File.Exists(extensionProfile))
            {
                msbuildProperties["AssetPackDownloaderProfile"] = extensionProfile;
            }
            else
            {
                throw new InvalidOperationException(
                    "Signed iOS packaging requires ASSET_PACK_DOWNLOADER_PROFILE to name the extension's App Groups provisioning profile.");
            }
        }
        else
        {
            throw new InvalidOperationException(
                $"Signed iOS packaging requires the device downloader extension at {appex}; build it with xcodebuild first.");
        }

        DotNetPublish(s => s
            .SetProject(MainProject)
            .SetConfiguration(Configuration)
            .SetFramework("net10.0-ios")
            .SetRuntime("ios-arm64")
            .SetProperties(msbuildProperties)
            .EnableNoRestore());

        PackageIosAssetPacks();

        // Find and copy IPA to artifacts directory
        var binDir = MainProject.Parent / "bin" / Configuration / "net10.0-ios" / "ios-arm64";
        var ipaFiles = binDir.GlobFiles("**/*.ipa");

        if (ipaFiles.Count > 0)
        {
            foreach (var ipa in ipaFiles)
            {
                ipa.CopyToDirectory(ArtifactsDirectory, ExistsPolicy.FileOverwrite);
                Serilog.Log.Information($"Copied {ipa.Name} to {ArtifactsDirectory}");
            }
        }
        else
        {
            // IPA might be directly in artifacts directory
            var artifactIpas = ArtifactsDirectory.GlobFiles("*.ipa");
            if (artifactIpas.Count == 0)
            {
                throw new InvalidOperationException($"No IPA files found in {binDir} or {ArtifactsDirectory}");
            }
        }

        Serilog.Log.Information($"iOS IPA package created in {ArtifactsDirectory}");
    }

    /// <summary>
    /// Archives every iOS asset pack (perushim_notes + recitation_*) into an Apple
    /// Archive (.aar) via `xcrun ba-package`. The archives upload to App Store
    /// Connect separately from the IPA (Transporter); on device they resolve
    /// through BAAssetPackManager managed asset packs.
    /// The raw payloads are also staged flat under .artifacts/payloads: releases
    /// publish them as plain assets so runtimes without managed delivery
    /// (iOS/MacCatalyst below 26, unsigned builds) can download the same bytes
    /// over HTTPS into their extraction cache.
    /// </summary>
    void PackageIosAssetPacks()
    {
        var assetPacksDirectory = MainProject.Parent / "Platforms" / "iOS" / "AssetPacks";
        var archivesDirectory = ArtifactsDirectory / "assetpacks";
        archivesDirectory.CreateDirectory();
        foreach (var manifest in assetPacksDirectory.GlobFiles("*/Manifest.json").OrderBy(p => (string)p.Parent.Name, StringComparer.Ordinal))
        {
            var archivePath = archivesDirectory / $"{manifest.Parent.Name}.aar";
            Serilog.Log.Information($"ba-package {manifest.Parent.Name} -> {archivePath}");
            ProcessTasks.StartProcess("xcrun", $"ba-package \"{manifest}\" -o \"{archivePath}\"", manifest.Parent)
                .AssertZeroExitCode();
        }

        var payloadsDirectory = ArtifactsDirectory / "payloads";
        payloadsDirectory.CreateDirectory();
        foreach (var packDirectory in assetPacksDirectory.GlobDirectories("*").OrderBy(p => (string)p.Name, StringComparer.Ordinal))
        {
            foreach (var payload in packDirectory.GlobFiles("*").Where(f => f.Name != "Manifest.json"))
            {
                Serilog.Log.Information($"payload {packDirectory.Name}/{payload.Name} -> {payloadsDirectory}");
                payload.CopyToDirectory(payloadsDirectory, ExistsPolicy.FileOverwrite);
            }
        }
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

            // Bump ApplicationVersion (integer build number) - handles conditional versions
            // Matches: <ApplicationVersion>123</ApplicationVersion> or <ApplicationVersion Condition="...">123</ApplicationVersion>
            var buildVersionRegex = new Regex(@"(<ApplicationVersion[^>]*>)(\d+)(</ApplicationVersion>)");
            var matches = buildVersionRegex.Matches(content);
            foreach (Match match in matches)
            {
                var buildNumber = int.Parse(match.Groups[2].Value);
                var newBuildNumber = buildNumber + 1;
                var replacement = $"{match.Groups[1].Value}{newBuildNumber}{match.Groups[3].Value}";
                content = content.Replace(match.Value, replacement);
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
