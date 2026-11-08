using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Windows extension-pack map contract (#2923): pack → optional-package
/// identity resolution, StoreId binding, and the payload-completeness probe
/// the Store/fallback legs share.
/// </summary>
public class WindowsExtensionPackMapTests
{
    [Fact]
    public void NullOrEmptyMap_YieldsEmptyMap_SoEveryPackFallsBackToReleasePayload()
    {
        foreach (var map in new string?[] { null, "", "   " }.Select(json => new WindowsExtensionPackMap(json)))
        {
            map.StoreIdFor("recitation_1").Should().BeNull();
            map.PackageNameFor("Main.App-", "recitation_1").Should().Be("Main.App-.recitation-1");
        }
    }

    [Fact]
    public void ConfiguredAddOn_ResolvesItsStoreId()
    {
        var map = new WindowsExtensionPackMap("""
            { "version": 1, "addOns": {
                "recitation_1": { "storeId": "9ABCDEF1234", "packageName": "Main.App-.dlc.recitation-1" },
                "perushim_notes": { "storeId": "9ZZZZZZZZZ" }
            } }
            """);

        map.StoreIdFor("recitation_1").Should().Be("9ABCDEF1234");
        map.StoreIdFor("perushim_notes").Should().Be("9ZZZZZZZZZ");
        map.PackageNameFor("Main.App-", "recitation_1").Should().Be("Main.App-.dlc.recitation-1",
            "an explicit packageName override wins over the convention");
        map.PackageNameFor("Main.App-", "perushim_notes").Should().Be("Main.App-.perushim-notes",
            "a missing packageName falls back to the related-set convention");
    }

    [Fact]
    public void AddOnWithoutStoreId_IsNotStoreDeliverable_ButKeepsPackageIdentity()
    {
        var map = new WindowsExtensionPackMap("""
            { "version": 1, "addOns": { "recitation_2": { "storeId": "" } } }
            """);

        map.StoreIdFor("recitation_2").Should().BeNull();
        map.PackageNameFor("Main.App-", "recitation_2").Should().Be("Main.App-.recitation-2");
    }

    [Fact]
    public void CommentsAreTolerated_SoTheBundledAssetCanDocumentItself()
    {
        var map = new WindowsExtensionPackMap("""
            {
                // partner-center durable add-ons, keyed by pack name
                "version": 1,
                "addOns": { /* inline */ "recitation_1": { "storeId": "9ABC" } }
            }
            """);

        map.StoreIdFor("recitation_1").Should().Be("9ABC");
    }

    [Theory]
    [InlineData("""{ "version": 2, "addOns": {} }""", "unsupported map version")]
    [InlineData("""{ "version": 1, "addOns": { "bad pack!": {} } }""", "pack names are store-safe ids")]
    [InlineData("""{ "version": 1, "addOns": { "recitation_1": { "storeId": "not-a-store-id!" } } }""", "StoreIds are alphanumeric")]
    [InlineData("""{ "version": 1, "addOns": { "recitation_1": { "packageName": "bad_name" } } }""", "appx identities cannot carry underscores")]
    [InlineData("""{ "version": 1, "addOns": { "recitation_1": null } }""", "null entries are rejected")]
    public void MalformedMap_IsRejected(string json, string because)
    {
        var act = () => new WindowsExtensionPackMap(json);

        act.Should().Throw<InvalidDataException>(because);
    }

    [Theory]
    [InlineData("recitation_1", "Main.App-.recitation-1")]
    [InlineData("recitation_39", "Main.App-.recitation-39")]
    [InlineData("perushim_notes", "Main.App-.perushim-notes")]
    public void OptionalPackageName_HyphenatesPackNames_ForTheAppxIdentityCharset(string pack, string expected)
    {
        WindowsExtensionPackMap.OptionalPackageName("Main.App-", pack).Should().Be(expected);
    }

    [Fact]
    public void FileName_IsTheBundledAssetName()
    {
        WindowsExtensionPackMap.FileName.Should().Be("windows-extension-packs.json");
    }

    [Theory]
    [InlineData("""{ "version": 1 }""")]
    [InlineData("""{ "version": 1, "addOns": [] }""")]
    [InlineData("""{ "version": 1, "addOns": "none" }""")]
    public void Map_WithoutAnAddOnsObject_YieldsAnEmptyMap(string json)
    {
        var map = new WindowsExtensionPackMap(json);

        map.StoreIdFor("recitation_1").Should().BeNull();
        map.PackageNameFor("Main.App-", "recitation_1").Should().Be("Main.App-.recitation-1");
    }

    [Theory]
    [InlineData("""{ "version": 1, "addOns": { "": {} } }""", "blank")]
    [InlineData("""{ "version": 1, "addOns": { "   ": {} } }""", "whitespace")]
    public void Map_WithAnUnnamedAddOn_IsRejected(string json, string because)
    {
        var act = () => new WindowsExtensionPackMap(json);

        act.Should().Throw<InvalidDataException>(because);
    }

    [Fact]
    public void AddOn_WithNonStringStoreIdAndPackageName_FallsBackToDefaults()
    {
        var map = new WindowsExtensionPackMap("""
            { "version": 1, "addOns": {
                "recitation_1": { "storeId": 42, "packageName": null },
                "recitation_2": { "storeId": "9ABC", "packageName": 7 }
            } }
            """);

        map.StoreIdFor("recitation_1").Should().BeNull("a non-string storeId is not store-deliverable");
        map.PackageNameFor("Main.App-", "recitation_1").Should().Be("Main.App-.recitation-1");
        map.StoreIdFor("recitation_2").Should().Be("9ABC");
        map.PackageNameFor("Main.App-", "recitation_2").Should().Be("Main.App-.recitation-2",
            "a non-string packageName falls back to the related-set convention");
    }

    [Theory]
    [InlineData("""{ "version": 1, "addOns": { "recitation_1": { "packageName": "ab" } } }""", "appx identities need 3+ chars")]
    [InlineData("""{ "version": 1, "addOns": { "recitation_1": { "packageName": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } }""", "appx identities cap at 50 chars")]
    [InlineData("""{ "version": 1, "addOns": { "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa": {} } }""", "pack ids cap at 64 chars")]
    public void Map_WithOutOfBoundsIdentityNames_IsRejected(string json, string because)
    {
        var act = () => new WindowsExtensionPackMap(json);

        act.Should().Throw<InvalidDataException>(because);
    }

    [Fact]
    public async Task PackPayloadComplete_RequiresThePrimaryPayload()
    {
        await using var storage = new TestStorage();
        var packDir = Path.Join(storage.Root, "recitation_1");
        Directory.CreateDirectory(packDir);

        PadDeliveryService.PackPayloadComplete(packDir, "recitation_1").Should().BeFalse();
        await File.WriteAllTextAsync(Path.Join(packDir, "recitation_1.zip"), "payload",
            TestContext.Current.CancellationToken);
        PadDeliveryService.PackPayloadComplete(packDir, "recitation_1").Should().BeTrue();
    }

    [Fact]
    public async Task PackPayloadComplete_NotesPackRequiresTheSearchIndexToo()
    {
        await using var storage = new TestStorage();
        var packDir = Path.Join(storage.Root, "perushim_notes");
        Directory.CreateDirectory(packDir);
        await File.WriteAllTextAsync(
            Path.Join(packDir, "sefaria-dump-5784-sivan-4.perushim_notes.sqlite"), "notes",
            TestContext.Current.CancellationToken);

        PadDeliveryService.PackPayloadComplete(packDir, "perushim_notes").Should().BeFalse(
            "a partial extraction must not hide a missing search index");
        await File.WriteAllTextAsync(
            Path.Join(packDir, "sefaria-dump-5784-sivan-4.hebrew_search.sqlite"), "index",
            TestContext.Current.CancellationToken);
        PadDeliveryService.PackPayloadComplete(packDir, "perushim_notes").Should().BeTrue();
    }
}
