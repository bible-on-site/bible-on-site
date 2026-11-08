using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
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

    /// <summary>
    /// Packages the Mapbox public token (MAPBOX_PUBLIC_TOKEN env) as a raw
    /// asset - the same public key the website bakes into client bundles.
    /// An empty file keeps the app's no-key map fallback.
    /// </summary>
    void WriteMapboxTokenFile()
    {
        var tokenPath = SourceDirectory / "Resources" / "Raw" / "mapbox-token.txt";
        tokenPath.WriteAllText(Environment.GetEnvironmentVariable("MAPBOX_PUBLIC_TOKEN") ?? "");
    }

    Target PackagePrepare => _ => _
        .Description("Prepare for packaging by restoring the appropriate platform")
        .Unlisted()
        .Executes(() =>
        {
            WriteMapboxTokenFile();

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

        GenerateWindowsExtensionPacks();

        Serilog.Log.Information($"Windows MSIX package created in {ArtifactsDirectory}");
    }

    /// <summary>
    /// Standalone entry point for the extension-pack pass — the Package target
    /// runs it after publish; invoking it directly enables local validation
    /// against a staged ExtensionPacks dir and an existing base MSIX without a
    /// full rebuild.
    /// </summary>
    Target PackageWindowsExtensionPacks => _ => _
        .Description("Pack staged Windows extension packs as MSIX optional packages (.artifacts/extension-packs)")
        .Executes(GenerateWindowsExtensionPacks);

    /// <summary>
    /// Packs every staged Windows extension pack (Platforms/Windows/ExtensionPacks/*)
    /// as an MSIX optional package bound to the main package via
    /// uap3:MainPackageDependency — the Microsoft Store durable-DLC model the
    /// app enumerates through Package.Current.Dependencies (#2923). The raw
    /// payloads are also staged under .artifacts/payloads so the GitHub
    /// release keeps the HTTPS fallback bytes for sideloaded/Store-unavailable
    /// installs. Output: .artifacts/extension-packs/{pack}.msix, signed with
    /// the same thumbprint as the base package when provided.
    /// </summary>
    void GenerateWindowsExtensionPacks()
    {
        var extensionPacksDirectory = SourceDirectory / "Platforms" / "Windows" / "ExtensionPacks";
        var packs = WindowsExtensionPack.Discover(extensionPacksDirectory);
        Assert.True(packs.Count > 0,
            $"No Windows extension packs staged under {extensionPacksDirectory} — " +
            "prepare_recitation_assets.py --platform Windows and prepare_perushim_assets.py --platform Windows must run before packaging");

        var (mainName, publisher, publisherDisplayName) =
            WindowsExtensionPack.MainPackageIdentity(SourceDirectory / "Platforms" / "Windows" / "Package.appxmanifest");
        var packageOverrides = WindowsExtensionPack.LoadPackageNameOverrides(
            SourceDirectory / "Platforms" / "Windows" / "extension-packs.json5");
        var version = $"{GetCurrentVersion()}.0";
        // A signed sideload publish nests the MSIX one directory deep under a
        // name_version_Test folder; unsigned pipelines may drop it flat. The
        // extension-packs output directory is never searched.
        var baseMsix = ArtifactsDirectory.GlobFiles("*.msix", "*_Test/*.msix")
            .OrderByDescending(f => File.GetLastWriteTimeUtc(f))
            .FirstOrDefault()
            ?? throw new InvalidOperationException($"No base MSIX found in {ArtifactsDirectory}");
        var storeLogo = ExtractWindowsStoreLogo(baseMsix);

        var makeappx = WindowsExtensionPack.FindSdkTool("makeappx.exe")
            ?? throw new InvalidOperationException("makeappx.exe not found — install the Windows SDK packaging tools");
        var signtool = string.IsNullOrEmpty(CertificateThumbprint) ? null
            : WindowsExtensionPack.FindSdkTool("signtool.exe")
            ?? throw new InvalidOperationException("signtool.exe not found — required when --certificate-thumbprint is set");

        var outputDirectory = ArtifactsDirectory / "extension-packs";
        outputDirectory.CreateDirectory();
        var payloadsDirectory = ArtifactsDirectory / "payloads";
        payloadsDirectory.CreateDirectory();

        var stagedDirectory = ArtifactsDirectory / "extension-packs-staging";
        foreach (var pack in packs)
        {
            var packageName = packageOverrides.TryGetValue(pack.Name, out var configured)
                ? configured
                : WindowsExtensionPack.OptionalPackageName(mainName, pack.Name);
            var stage = stagedDirectory / pack.Name;
            stage.CreateOrCleanDirectory();
            (stage / "AppxManifest.xml").WriteAllText(WindowsExtensionPack.ManifestXml(
                packageName, publisher, publisherDisplayName, version,
                $"929 {pack.Name.Replace('_', ' ')}", mainName));
            (stage / "Assets").CreateDirectory();
            storeLogo.Copy(stage / "Assets" / "StoreLogo.png", ExistsPolicy.FileOverwrite);
            foreach (var payload in pack.PayloadFiles)
            {
                payload.CopyToDirectory(stage, ExistsPolicy.FileOverwrite);
                // Release-payload fallback: every payload stages for HTTPS
                // delivery — a Windows-only release has no iOS leg to publish
                // the perushim .sqlite pair under. When both legs run they
                // carry identical bytes under identical app-v* asset names.
                payload.CopyToDirectory(payloadsDirectory, ExistsPolicy.FileOverwrite);
            }

            var msix = outputDirectory / $"{pack.Name}.msix";
            // AbsolutePath interpolations render shell-quoted already.
            ProcessTasks.StartProcess(makeappx, $"pack /d {stage} /p {msix} /o")
                .AssertZeroExitCode();
            if (signtool is not null)
            {
                ProcessTasks.StartProcess(signtool,
                    $"sign /fd SHA256 /td SHA256 /sha1 {CertificateThumbprint} {msix}")
                    .AssertZeroExitCode();
            }
            Serilog.Log.Information($"extension pack {pack.Name} -> {msix} ({packageName})");
        }
        stagedDirectory.DeleteDirectory();
    }

    /// <summary>
    /// Pulls a StoreLogo PNG out of the just-built base MSIX so optional
    /// packages satisfy the manifest Logo requirement without a second copy of
    /// the asset in the repo.
    /// </summary>
    internal static AbsolutePath ExtractWindowsStoreLogo(AbsolutePath baseMsix)
    {
        using var archive = ZipFile.OpenRead(baseMsix);
        var entry = archive.Entries
            .Where(e => e.Name.EndsWith(".png", StringComparison.OrdinalIgnoreCase) &&
                        e.Name.Contains("Logo", StringComparison.OrdinalIgnoreCase))
            .OrderBy(e => e.Name.StartsWith("StoreLogo", StringComparison.OrdinalIgnoreCase) ? 0
                        : e.Name.StartsWith("Square44x44Logo", StringComparison.OrdinalIgnoreCase) ? 1 : 2)
            .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault()
            ?? throw new InvalidDataException($"{baseMsix} contains no *Logo*.png asset to reuse for optional packages");
        var extracted = (AbsolutePath)Path.Join(Path.GetTempPath(), $"bos-extpack-{Guid.NewGuid():N}", entry.Name);
        extracted.Parent.CreateDirectory();
        entry.ExtractToFile(extracted);
        return extracted;
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

            // Select the published framework/RID, never a stale sibling build.
            var sharedLibsDir = MainProject.Parent / "obj" / Configuration /
                "net10.0-android" / "android-arm64" / "app_shared_libraries";
            var symbolsZip = ArtifactsDirectory /
                $"{aabFiles.First().Name.Replace("-Signed.aab", "")}-native-symbols.zip";
            CreateAndValidateAndroidSymbols(sharedLibsDir, ArtifactsDirectory / aabFiles.First().Name, symbolsZip);
            Serilog.Log.Information($"Created native symbols zip {symbolsZip.Name}");
        }
        else
        {
            Serilog.Log.Warning($"No signed AAB files found in {binDir}");
        }

        Serilog.Log.Information($"Android AAB package created in {ArtifactsDirectory}");
    }

    /// <summary>
    /// Packages the native debug symbols for an already-built AAB and validates
    /// the archive. The full Package job is master-only; the app_ci Release
    /// build runs this target on the pull request so a symbols regression fails
    /// before merge instead of first at release time (#2970).
    /// </summary>
    Target PackageAndroidSymbols => _ => _
        .Description("Package Android native debug symbols for an already-built AAB and validate the archive")
        .Requires(() => AabPath)
        .Requires(() => AndroidSymbolsPath)
        .Executes(() =>
        {
            var aabFile = (AbsolutePath)AabPath!;
            var symbolsFile = (AbsolutePath)AndroidSymbolsPath!;
            Assert.FileExists(aabFile, $"AAB file not found: {aabFile}");
            // Select the published framework/RID, never a stale sibling build.
            var sharedLibsDir = MainProject.Parent / "obj" / Configuration /
                "net10.0-android" / "android-arm64" / "app_shared_libraries";
            Assert.True(sharedLibsDir.DirectoryExists(),
                $"Android shared libraries not found at {sharedLibsDir} — build the Android release first");
            CreateAndValidateAndroidSymbols(sharedLibsDir, aabFile, symbolsFile);
            Serilog.Log.Information($"Native symbols archive {symbolsFile.Name} is valid for {aabFile.Name}");
        });

    Target VerifyAndroidSymbols => _ => _
        .Description("Validate a packaged native-symbols archive against the AAB it ships beside")
        .Requires(() => AabPath)
        .Requires(() => AndroidSymbolsPath)
        .Executes(() =>
        {
            var aabFile = (AbsolutePath)AabPath!;
            var symbolsFile = (AbsolutePath)AndroidSymbolsPath!;
            Assert.FileExists(aabFile, $"AAB file not found: {aabFile}");
            Assert.FileExists(symbolsFile, $"Native symbols file not found: {symbolsFile}");
            LogSymbolCoverage(AndroidNativeSymbols.Validate(symbolsFile, aabFile));
            Serilog.Log.Information($"Native symbols archive {symbolsFile.Name} is valid for {aabFile.Name}");
        });

    /// <summary>
    /// Produces the Play symbols archive beside a built AAB, then proves the
    /// file on disk — not just the intermediates — meets the contract the
    /// deploy target re-checks before any store write (#2970).
    /// </summary>
    static void CreateAndValidateAndroidSymbols(AbsolutePath sharedLibsDir, AbsolutePath aab, AbsolutePath symbolsZip)
    {
        AndroidNativeSymbols.Create(sharedLibsDir, aab, symbolsZip);
        LogSymbolCoverage(AndroidNativeSymbols.Validate(symbolsZip, aab));
    }

    /// <summary>
    /// Documents which bundled arm64 libraries ship without debug symbols —
    /// .NET/Android runtime libraries are stripped-only upstream, and Play
    /// accepts partial coverage. Reported honestly instead of claiming
    /// complete symbol coverage (#2970).
    /// </summary>
    static void LogSymbolCoverage(IReadOnlyList<string> uncovered)
    {
        if (uncovered.Count > 0)
        {
            Serilog.Log.Warning(
                $"No debug symbols for {uncovered.Count} bundled arm64 libraries shipped stripped-only " +
                $"by the .NET/Android runtime: {string.Join(", ", uncovered)}");
        }
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
        // (built by CI via xcodebuild - .NET cannot produce .appex binaries). The
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
    /// Archives every iOS asset pack (perushim-notes + recitation-*) into an Apple
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
