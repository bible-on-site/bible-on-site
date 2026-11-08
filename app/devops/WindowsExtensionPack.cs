using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Nuke.Common.IO;

/// <summary>
/// Windows MSIX optional-package plan (#2923): each ExtensionPacks
/// subdirectory is one store-deliverable pack — recitation_&lt;seferId&gt; book
/// archives and the perushim_notes commentary pack. The packaging target
/// stages every pack with an AppxManifest declaring
/// uap3:MainPackageDependency and packs it as a signed .msix; the app
/// enumerates them through Package.Current.Dependencies and installs them
/// from the Microsoft Store as durable DLC add-ons.
/// </summary>
static class WindowsExtensionPack
{
    public const string StoreMapFileName = "extension-packs.json5";
    public const string MainManifestFileName = "Package.appxmanifest";

    /// <summary>One ExtensionPacks subdirectory = one deliverable optional package.</summary>
    public sealed record Pack(string Name, AbsolutePath Directory)
    {
        /// <summary>Payload files ship at the optional package's root.</summary>
        public IReadOnlyList<AbsolutePath> PayloadFiles =>
            Directory.GlobFiles("*").OrderBy(f => (string)f.Name, StringComparer.Ordinal).ToList();
    }

    /// <summary>
    /// Every ExtensionPacks child directory holding at least one payload file
    /// becomes an optional package, ordered for reproducible output.
    /// </summary>
    public static IReadOnlyList<Pack> Discover(AbsolutePath extensionPacksDirectory)
    {
        if (!Directory.Exists(extensionPacksDirectory))
        {
            return [];
        }

        var packs = extensionPacksDirectory.GlobDirectories("*")
            .Select(dir => new Pack(dir.Name, dir))
            .Where(pack => pack.PayloadFiles.Count > 0)
            .OrderBy(pack => pack.Name, StringComparer.Ordinal)
            .ToList();
        return packs;
    }

    /// <summary>
    /// Related-set identity for a pack. Appx identity names accept only
    /// letters, digits, '.' and '-' — pack names with underscores are
    /// hyphenated the same way the iOS asset-pack IDs are.
    /// </summary>
    public static string OptionalPackageName(string mainPackageName, string packName) =>
        $"{mainPackageName}.{packName.Replace('_', '-')}";

    /// <summary>The makeappx-enforced identity pattern.</summary>
    public static bool IsValidPackageName(string name) =>
        Regex.IsMatch(name, @"^[-.A-Za-z0-9]{3,50}$");

    /// <summary>
    /// Per-pack packageName overrides from the bundled store map. Entries
    /// without a packageName fall back to <see cref="OptionalPackageName"/>;
    /// a missing or malformed file yields no overrides so packaging stays
    /// reproducible from convention.
    /// </summary>
    public static IReadOnlyDictionary<string, string> LoadPackageNameOverrides(AbsolutePath storeMapPath)
    {
        if (!File.Exists(storeMapPath))
        {
            return new Dictionary<string, string>();
        }

        using var document = JsonDocument.Parse(File.ReadAllText(storeMapPath),
            new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip });
        var overrides = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!document.RootElement.TryGetProperty("addOns", out var addOns) ||
            addOns.ValueKind != JsonValueKind.Object)
        {
            return overrides;
        }

        foreach (var candidate in addOns.EnumerateObject()
            .Select(addOn => (addOn.Name, PackageName: TryPackageName(addOn.Value)))
            .Where(candidate => candidate.PackageName != null))
        {
            overrides[candidate.Name] = candidate.PackageName!;
        }
        return overrides;

        static string? TryPackageName(JsonElement addOn) =>
            addOn.ValueKind == JsonValueKind.Object &&
            addOn.TryGetProperty("packageName", out var packageName) &&
            packageName.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(packageName.GetString())
                ? packageName.GetString()
                : null;
    }

    /// <summary>Main package identity fields the optional package manifest must mirror.</summary>
    public static (string Name, string Publisher, string PublisherDisplayName) MainPackageIdentity(AbsolutePath mainManifestPath)
    {
        var document = XDocument.Load(mainManifestPath);
        var root = document.Root ?? throw new InvalidDataException($"{mainManifestPath} is empty");
        var identity = root.Elements()
            .FirstOrDefault(e => e.Name.LocalName == "Identity")
            ?? throw new InvalidDataException($"{mainManifestPath} has no Identity element");
        var name = (string?)identity.Attribute("Name");
        var publisher = (string?)identity.Attribute("Publisher");
        var publisherDisplayName = root.Elements()
            .FirstOrDefault(e => e.Name.LocalName == "Properties")?
            .Elements().FirstOrDefault(e => e.Name.LocalName == "PublisherDisplayName")?.Value;
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(publisher) ||
            string.IsNullOrWhiteSpace(publisherDisplayName))
        {
            throw new InvalidDataException($"{mainManifestPath} lacks Identity Name/Publisher or PublisherDisplayName");
        }
        return (name, publisher, publisherDisplayName);
    }

    /// <summary>
    /// Content-only optional package manifest: no Applications element —
    /// makeappx validates the package as payload-only DLC. The uap3
    /// MainPackageDependency binds the pack to the main package so the Store
    /// serves it inside the app's related set.
    /// </summary>
    public static string ManifestXml(string packageName, string publisher, string publisherDisplayName,
        string version, string displayName, string mainPackageName)
    {
        if (!IsValidPackageName(packageName))
        {
            throw new InvalidDataException(
                $"Optional package identity '{packageName}' violates the appx pattern (3–50 chars, letters/digits/'.'/'-').");
        }
        if (!Version.TryParse(version, out var parsed) || parsed.Revision != 0)
        {
            throw new InvalidDataException($"Optional package version '{version}' must be a 4-part X.Y.Z.0 version.");
        }

        return $$"""
            <?xml version="1.0" encoding="utf-8"?>
            <Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
                     xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
                     xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
                     IgnorableNamespaces="uap uap3">
              <Identity Name="{{packageName}}" Publisher="{{Escape(publisher)}}" Version="{{version}}" ProcessorArchitecture="neutral" />
              <Properties>
                <DisplayName>{{Escape(displayName)}}</DisplayName>
                <PublisherDisplayName>{{Escape(publisherDisplayName)}}</PublisherDisplayName>
                <Logo>Assets\StoreLogo.png</Logo>
              </Properties>
              <Dependencies>
                <TargetDeviceFamily Name="Windows.Universal" MinVersion="10.0.17763.0" MaxVersionTested="10.0.19041.0" />
                <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.19041.0" />
                <uap3:MainPackageDependency Name="{{Escape(mainPackageName)}}" />
              </Dependencies>
              <Resources>
                <Resource Language="en-us" />
              </Resources>
            </Package>

            """;

        static string Escape(string value) => System.Security.SecurityElement.Escape(value) ?? "";
    }

    /// <summary>
    /// The newest installed Windows SDK tool (makeappx.exe, signtool.exe):
    /// %WindowsSdkDir%bin, else the standard kits root, choosing the highest
    /// versioned directory, else bare PATH lookup as a last resort.
    /// </summary>
    public static AbsolutePath? FindSdkTool(string fileName)
    {
        var roots = new[]
        {
            Environment.GetEnvironmentVariable("WindowsSdkDir"),
            Environment.GetEnvironmentVariable("ProgramFiles(x86)") is { } pf ? Path.Join(pf, @"Windows Kits\10\") : null,
            @"C:\Program Files (x86)\Windows Kits\10\",
        }.Where(root => !string.IsNullOrEmpty(root)).Distinct().ToList();

        var candidates = roots
            .Select(root => (AbsolutePath)Path.Join(root, "bin"))
            .Where(binDir => binDir.DirectoryExists())
            .SelectMany(binDir => binDir.GlobDirectories("10.0.*")
                .Select(dir => (Version: Version.TryParse(dir.Name, out var version) ? version : null,
                                Tool: dir / "x64" / fileName)))
            .Where(candidate => candidate.Version != null && File.Exists(candidate.Tool))
            .Select(candidate => (Version: candidate.Version!, candidate.Tool))
            .ToList();

        if (candidates.Count > 0)
        {
            return candidates.OrderByDescending(c => c.Version).First().Tool;
        }
        // Last resort: the tool may simply be on PATH (build agents with the
        // packaging tools installed outside the kits directory).
        var onPath = Environment.GetEnvironmentVariable("PATH")?
            .Split(Path.PathSeparator)
            .Select(dir => (AbsolutePath)Path.Join(dir, fileName))
            .FirstOrDefault(candidate => File.Exists(candidate));
        return onPath;
    }
}
