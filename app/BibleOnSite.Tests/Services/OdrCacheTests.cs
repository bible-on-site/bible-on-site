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
        await File.WriteAllTextAsync(Path.Join(previous, Notes), "old notes", TestContext.Current.CancellationToken);
        app.SetupGet(a => a.VersionString).Returns(version);
        app.SetupGet(a => a.BuildString).Returns(build);

        var current = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        Directory.Exists(current).Should().BeTrue();
        File.Exists(Path.Join(current, Notes)).Should().BeFalse();
        Directory.Exists(previous).Should().BeFalse("previous-generation extractions are purged, not just ignored");
    }

    [Fact]
    public async Task CurrentBuild_ReusesItsOwnExtractedNotes()
    {
        await using var storage = new TestStorage();
        var app = App("5.0.104", "104");
        var first = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);
        await File.WriteAllTextAsync(Path.Join(first, Notes), "current notes", TestContext.Current.CancellationToken);

        var second = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        (await File.ReadAllTextAsync(Path.Join(second, Notes), TestContext.Current.CancellationToken)).Should().Be("current notes");
    }

    [Fact]
    public async Task StaleGeneration_ThatCannotBeDeleted_IsTolerated()
    {
        await using var storage = new TestStorage();
        var app = App("5.0.104", "104");
        // A file held open inside a stale generation blocks recursive delete —
        // the sweep failure must not keep the app from resolving its own dir.
        var staleDir = Path.Join(storage.Root, "odr_assets", "old-generation");
        Directory.CreateDirectory(staleDir);
        var staleFile = Path.Join(staleDir, Notes);
        await File.WriteAllTextAsync(staleFile, "old notes", TestContext.Current.CancellationToken);
        await using var locked = new FileStream(staleFile, FileMode.Open, FileAccess.Read, FileShare.None);

        var current = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        Directory.Exists(current).Should().BeTrue();
    }

    [Fact]
    public async Task CurrentApp_DoesNotTrustLegacyUnversionedOdrCache()
    {
        await using var storage = new TestStorage();
        var legacy = Path.Join(storage.Root, "odr_assets", Pack);
        Directory.CreateDirectory(legacy);
        await File.WriteAllTextAsync(Path.Join(legacy, Notes), "legacy notes", TestContext.Current.CancellationToken);
        var app = App("5.0.104", "104");

        var current = PadDeliveryService.OdrCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        File.Exists(Path.Join(current, Notes)).Should().BeFalse();
    }

    private static Mock<IAppInfo> App(string version, string build)
    {
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns(version);
        app.SetupGet(a => a.BuildString).Returns(build);
        return app;
    }

    [Fact]
    public void PayloadFileName_UsesNotesDatabaseForTheNotesPack_AndZipOtherwise()
    {
        PadDeliveryService.PayloadFileName("perushim_notes")
            .Should().Be("sefaria-dump-5784-sivan-4.perushim_notes.sqlite");
        PadDeliveryService.PayloadFileName("other_pack").Should().Be("other_pack.zip");
    }

    [Fact]
    public async Task UnsupportedPlatform_DeliveryIsANoOp()
    {
        // The net10.0 test host compiles the no-PAD/ODR branch of the service.
        var service = PadDeliveryService.Instance;

        (await service.TryGetAssetPathAsync(Pack, TestContext.Current.CancellationToken)).Should().BeNull();
        (await service.FetchAsync(Pack, progress: null, cancellationToken: TestContext.Current.CancellationToken)).Should().BeFalse();
        (await service.GetDeliveryDiagnosticsAsync(Pack))
            .Should().ContainSingle().Which.Should().Contain("no on-demand delivery");
    }
}
