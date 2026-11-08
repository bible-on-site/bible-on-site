using System.Xml.Linq;
using Nuke.Common.IO;
using Xunit;

/// <summary>
/// Windows MSIX optional-package plan (#2923): pack discovery, related-set
/// naming, manifest generation, and the store-map override contract that must
/// match the runtime WindowsExtensionPackMap.
/// </summary>
public sealed class WindowsExtensionPackTests : IDisposable
{
    private readonly AbsolutePath _root = AbsolutePath.Create(
        Path.Join(Path.GetTempPath(), $"wep-tests-{Guid.NewGuid():N}"));

    public void Dispose() => _root.DeleteDirectory();

    private AbsolutePath Dir(string relative) { var dir = _root / relative; dir.CreateDirectory(); return dir; }
    private void File(AbsolutePath dir, string name, string content = "x") => (dir / name).WriteAllText(content);

    [Theory]
    [InlineData("recitation_1", "Main.App-.recitation-1")]
    [InlineData("recitation_39", "Main.App-.recitation-39")]
    [InlineData("perushim_notes", "Main.App-.perushim-notes")]
    public void OptionalPackageName_HyphenatesLikeTheRuntimeMap(string pack, string expected)
    {
        Assert.Equal(expected, WindowsExtensionPack.OptionalPackageName("Main.App-", pack));
    }

    [Theory]
    [InlineData("54181DoradSoft.929-.recitation-1", true)]
    [InlineData("A.B", true)]
    [InlineData("bad_name", false)]
    [InlineData("ab", false)]
    [InlineData("A" + "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", false)]
    public void IsValidPackageName_EnforcesTheAppxPattern(string name, bool expected)
    {
        Assert.Equal(expected, WindowsExtensionPack.IsValidPackageName(name));
    }

    [Fact]
    public void Discover_ReturnsOnlyNonEmptyPacks_InStableOrder()
    {
        var packs = Dir("ExtensionPacks");
        File(packs, "loose.txt"); // files at the root are not packs
        File(Dir("ExtensionPacks/recitation_2"), "recitation_2.zip");
        File(Dir("ExtensionPacks/recitation_1"), "recitation_1.zip");
        Dir("ExtensionPacks/empty_pack");

        var discovered = WindowsExtensionPack.Discover(packs);

        Assert.Equal(new[] { "recitation_1", "recitation_2" }, discovered.Select(p => p.Name).ToArray());
        Assert.Equal(new[] { "recitation_1.zip" }, discovered[0].PayloadFiles.Select(f => (string)f.Name).ToArray());
    }

    [Fact]
    public void Discover_MissingDirectory_YieldsNoPacks()
    {
        Assert.Empty(WindowsExtensionPack.Discover(_root / "absent"));
    }

    [Fact]
    public void ManifestXml_ProducesARelatedSetOptionalPackage_WithoutAnApplication()
    {
        var version = new Version(5, 1, 8, 0).ToString();
        var xml = WindowsExtensionPack.ManifestXml(
            "54181DoradSoft.929-.recitation-1", "CN=ABC-123", "DoradSoft",
            version, "929 recitation 1", "54181DoradSoft.929-");

        var root = XDocument.Parse(xml).Root!;
        Assert.Contains("uap3", root.Attribute("IgnorableNamespaces")!.Value);
        var identity = root.Elements().Single(e => e.Name.LocalName == "Identity");
        Assert.Equal("54181DoradSoft.929-.recitation-1", identity.Attribute("Name")!.Value);
        Assert.Equal("CN=ABC-123", identity.Attribute("Publisher")!.Value);
        Assert.Equal(version, identity.Attribute("Version")!.Value);
        // A content-only optional package declares no executable.
        Assert.Empty(root.Elements().Where(e => e.Name.LocalName == "Applications"));
        var mainDependency = root.Descendants().Single(e => e.Name.LocalName == "MainPackageDependency");
        // The optional package must bind to the main package's related set.
        Assert.Equal("54181DoradSoft.929-", mainDependency.Attribute("Name")!.Value);
    }

    [Fact]
    public void ManifestXml_RejectsNamesOutsideTheAppxCharset()
    {
        Assert.Throws<InvalidDataException>(() => WindowsExtensionPack.ManifestXml(
            "54181DoradSoft.929-.recitation_1", "CN=A", "D", new Version(5, 1, 8, 0).ToString(), "x", "54181DoradSoft.929-"));
    }

    [Fact]
    public void ManifestXml_RejectsNonFourPartVersions()
    {
        Assert.Throws<InvalidDataException>(() => WindowsExtensionPack.ManifestXml(
            "54181DoradSoft.929-.recitation-1", "CN=A", "D", "5.1.8", "x", "54181DoradSoft.929-"));
    }

    [Fact]
    public void LoadPackageNameOverrides_ReadsTheBundledStoreMap()
    {
        var dir = Dir("map");
        File(dir, "extension-packs.json5", """
            {
                // store ids land here after Partner Center registration
                "version": 1,
                "addOns": {
                    "recitation_1": { "storeId": "9ABC", "packageName": "Main.App-.dlc.recitation-1" },
                    "perushim_notes": { "storeId": "9XYZ" }
                }
            }
            """);

        var overrides = WindowsExtensionPack.LoadPackageNameOverrides(dir / "extension-packs.json5");

        var pair = Assert.Single(overrides);
        Assert.Equal("recitation_1", pair.Key);
        Assert.Equal("Main.App-.dlc.recitation-1", pair.Value);
    }

    [Fact]
    public void LoadPackageNameOverrides_MissingFile_YieldsNoOverrides()
    {
        Assert.Empty(WindowsExtensionPack.LoadPackageNameOverrides(_root / "absent.json"));
    }

    [Fact]
    public void ExtractWindowsStoreLogo_PrefersTheStoreLogo_ThenAnyLogoAsset()
    {
        var dir = Dir("msix");
        var msix = dir / "base.msix";
        using (var stream = new FileStream(msix, FileMode.Create))
        using (var archive = new System.IO.Compression.ZipArchive(stream, System.IO.Compression.ZipArchiveMode.Create))
        {
            archive.CreateEntry("Square44x44Logo.scale-200.png");
            archive.CreateEntry("StoreLogo.png");
        }

        Assert.Equal("StoreLogo.png", Build.ExtractWindowsStoreLogo(msix).Name);
    }

    [Fact]
    public void ExtractWindowsStoreLogo_FallsBackToAnyLogoPng_AndRejectsEmptyPackages()
    {
        var dir = Dir("msix2");
        var msix = dir / "base.msix";
        using (var stream = new FileStream(msix, FileMode.Create))
        using (var archive = new System.IO.Compression.ZipArchive(stream, System.IO.Compression.ZipArchiveMode.Create))
        {
            archive.CreateEntry("Square150x150Logo.scale-100.png");
        }
        Assert.Equal("Square150x150Logo.scale-100.png", Build.ExtractWindowsStoreLogo(msix).Name);

        var empty = dir / "empty.msix";
        using (var stream = new FileStream(empty, FileMode.Create))
        using (var archive = new System.IO.Compression.ZipArchive(stream, System.IO.Compression.ZipArchiveMode.Create))
        {
            archive.CreateEntry("AppxManifest.xml");
        }
        Assert.Throws<InvalidDataException>(() => Build.ExtractWindowsStoreLogo(empty));
    }

    [Fact]
    public void MainPackageIdentity_ReadsTheCheckedInManifestFields()
    {
        var dir = Dir("manifests");
        File(dir, "Package.appxmanifest", """
            <?xml version="1.0" encoding="utf-8"?>
            <Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
              <Identity Name="54181DoradSoft.929-" Publisher="CN=89549FF8-687E-4A0E-B9EB-D872BBFFE2B6" Version="0.0.0.0" />
              <Properties>
                <DisplayName>$placeholder$</DisplayName>
                <PublisherDisplayName>DoradSoft</PublisherDisplayName>
              </Properties>
            </Package>
            """);

        var (name, publisher, publisherDisplayName) =
            WindowsExtensionPack.MainPackageIdentity(dir / "Package.appxmanifest");

        Assert.Equal("54181DoradSoft.929-", name);
        Assert.Equal("CN=89549FF8-687E-4A0E-B9EB-D872BBFFE2B6", publisher);
        Assert.Equal("DoradSoft", publisherDisplayName);
    }
}
