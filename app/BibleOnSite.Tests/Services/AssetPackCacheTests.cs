using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using Microsoft.Maui.ApplicationModel;

namespace BibleOnSite.Tests.Services;

public class AssetPackCacheTests
{
    private const string Pack = "perushim_notes";
    private const string Notes = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";

    [Theory]
    [InlineData("5.0.104", "100")]
    [InlineData("5.0.100", "104")]
    public async Task UpdatedApp_DoesNotReuse_AndSweeps_PreviousBuildsExtractedNotes(string version, string build)
    {
        await using var storage = new TestStorage();
        var app = App("5.0.100", "100");
        var previous = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, app.Object, Pack);
        await File.WriteAllTextAsync(Path.Join(previous, Notes), "old notes", TestContext.Current.CancellationToken);
        app.SetupGet(a => a.VersionString).Returns(version);
        app.SetupGet(a => a.BuildString).Returns(build);

        var current = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        Directory.Exists(current).Should().BeTrue();
        File.Exists(Path.Join(current, Notes)).Should().BeFalse();
        Directory.Exists(previous).Should().BeFalse(
            "the generation sweep removes the previous build's extracted ODR cache");
    }

    [Fact]
    public async Task CurrentBuild_ReusesItsOwnExtractedNotes()
    {
        await using var storage = new TestStorage();
        var app = App("5.0.104", "104");
        var first = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, app.Object, Pack);
        await File.WriteAllTextAsync(Path.Join(first, Notes), "current notes", TestContext.Current.CancellationToken);

        var second = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        (await File.ReadAllTextAsync(Path.Join(second, Notes), TestContext.Current.CancellationToken)).Should().Be("current notes");
    }

    [Fact]
    public async Task StaleGeneration_ThatCannotBeDeleted_IsTolerated()
    {
        await using var storage = new TestStorage();
        var app = App("5.0.104", "104");
        // A file held open inside a stale generation blocks recursive delete —
        // the sweep failure must not keep the app from resolving its own dir.
        var assetsRoot = Path.Join(storage.Root, "asset_packs");
        var staleDir = Path.Join(assetsRoot, "old-generation");
        Directory.CreateDirectory(staleDir);
        // Pre-create the current generation so a locked assets root does not
        // stop AssetPackCacheDirectory from resolving it.
        Directory.CreateDirectory(Path.Join(assetsRoot, "5.0.104-104", Pack));
        var staleFile = Path.Join(staleDir, Notes);
        await File.WriteAllTextAsync(staleFile, "old notes", TestContext.Current.CancellationToken);
        // Windows honors the open handle; on POSIX an advisory lock does not
        // block unlink, so the assets root itself is made non-writable.
        await using var locked = new FileStream(staleFile, FileMode.Open, FileAccess.Read, FileShare.None);
        var lockedDirectory = !OperatingSystem.IsWindows();
        if (lockedDirectory)
        {
            File.SetUnixFileMode(assetsRoot, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        }
        try
        {
            var current = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

            Directory.Exists(current).Should().BeTrue();
        }
        finally
        {
            if (lockedDirectory)
            {
                File.SetUnixFileMode(assetsRoot,
                    UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }
    }

    [Fact]
    public async Task CurrentApp_DoesNotTrustLegacyUnversionedAssetPackCache_AndSweepsIt()
    {
        await using var storage = new TestStorage();
        var legacy = Path.Join(storage.Root, "asset_packs", Pack);
        Directory.CreateDirectory(legacy);
        await File.WriteAllTextAsync(Path.Join(legacy, Notes), "legacy notes", TestContext.Current.CancellationToken);
        var app = App("5.0.104", "104");

        var current = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

        File.Exists(Path.Join(current, Notes)).Should().BeFalse();
        Directory.Exists(legacy).Should().BeFalse(
            "the generation sweep removes legacy unversioned pack directories");
    }

    [Fact]
    public async Task UndeletableStaleGeneration_IsLoggedAndSkipped_WhileOthersAreSwept()
    {
        await using var storage = new TestStorage();
        var odrRoot = Path.Join(storage.Root, "asset_packs");
        var stubborn = Path.Join(odrRoot, "4.9.0-9");
        var collectible = Path.Join(odrRoot, "4.8.0-8");
        Directory.CreateDirectory(stubborn);
        Directory.CreateDirectory(collectible);
        var file = Path.Join(stubborn, Notes);
        await File.WriteAllTextAsync(file, "old notes", TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(Path.Join(collectible, Notes), "old notes", TestContext.Current.CancellationToken);

        // Read-only payloads cannot be deleted on Windows; a read-only
        // generation directory blocks the unlink on Unix. Either way the
        // generation delete fails and the sweep must keep going.
        File.SetAttributes(file, FileAttributes.ReadOnly);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(stubborn, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        }

        try
        {
            var current = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, App("5.0.104", "104").Object, Pack);

            Directory.Exists(current).Should().BeTrue();
            Directory.Exists(stubborn).Should().BeTrue("an IO failure is logged and skipped, never fatal");
            Directory.Exists(collectible).Should().BeFalse("other stale generations are still swept");
        }
        finally
        {
            File.SetAttributes(file, FileAttributes.Normal);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(stubborn, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }
    }

    [Fact]
    public async Task UnreadableOdrRoot_NeverBreaksCacheAccess()
    {
        await using var storage = new TestStorage();
        var odrRoot = Path.Join(storage.Root, "asset_packs");
        var stale = Path.Join(odrRoot, "4.9.0-9");
        Directory.CreateDirectory(stale);
        var app = App("5.0.104", "104");

        // Unix mode 0300: enumeration (needs read) is denied while traversal
        // and subdirectory creation (need write+execute) stay possible.
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(odrRoot, UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }

        try
        {
            var current = PadDeliveryService.AssetPackCacheDirectory(storage.FileSystem.Object, app.Object, Pack);

            Directory.Exists(current).Should().BeTrue("a failed sweep must never block ODR access");
            if (OperatingSystem.IsWindows())
            {
                Directory.Exists(stale).Should().BeFalse("without ACL denial the stale generation is swept");
            }
            else
            {
                Directory.Exists(stale).Should().BeTrue("enumeration was denied, so nothing was swept");
            }
        }
        finally
        {
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(odrRoot, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }
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
