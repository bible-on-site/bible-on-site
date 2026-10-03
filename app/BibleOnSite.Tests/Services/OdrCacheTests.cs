using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using Microsoft.Maui.ApplicationModel;

namespace BibleOnSite.Tests.Services;

public class OdrCacheTests
{
    private const string Pack = "perushim_notes";
    private const string Notes = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";

    [Theory]
    [InlineData("5.0.104", "100")]
    [InlineData("5.0.100", "104")]
    public async Task UpdatedApp_DoesNotReusePreviousBuildsExtractedNotes(string version, string build)
    {
        await using var storage = new TestStorage();
        var app = App("5.0.100", "100");
        var previous = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);
        await File.WriteAllTextAsync(Path.Combine(previous, Notes), "old notes");
        app.SetupGet(a => a.VersionString).Returns(version);
        app.SetupGet(a => a.BuildString).Returns(build);

        var current = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        Directory.Exists(current).Should().BeTrue();
        File.Exists(Path.Combine(current, Notes)).Should().BeFalse();
        File.Exists(Path.Combine(previous, Notes)).Should().BeTrue();
    }

    [Fact]
    public async Task CurrentBuild_ReusesItsOwnExtractedNotes()
    {
        await using var storage = new TestStorage();
        var app = App("5.0.104", "104");
        var first = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);
        await File.WriteAllTextAsync(Path.Combine(first, Notes), "current notes");

        var second = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        (await File.ReadAllTextAsync(Path.Combine(second, Notes))).Should().Be("current notes");
    }

    [Fact]
    public async Task CurrentApp_DoesNotTrustLegacyUnversionedOdrCache()
    {
        await using var storage = new TestStorage();
        var legacy = Path.Combine(storage.Root, "odr_assets", Pack);
        Directory.CreateDirectory(legacy);
        await File.WriteAllTextAsync(Path.Combine(legacy, Notes), "legacy notes");
        var app = App("5.0.104", "104");

        var current = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        File.Exists(Path.Combine(current, Notes)).Should().BeFalse();
    }

    private static Mock<IAppInfo> App(string version, string build)
    {
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns(version);
        app.SetupGet(a => a.BuildString).Returns(build);
        return app;
    }
}
