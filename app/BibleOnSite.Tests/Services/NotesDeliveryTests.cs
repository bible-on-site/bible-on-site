using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Devices;

namespace BibleOnSite.Tests.Services;

public class NotesDeliveryTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private static PerushimNotesService Create(TestStorage storage, Mock<IPadDeliveryService>? pad = null)
    {
        pad ??= Pad();
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.Android);
        device.SetupGet(d => d.VersionString).Returns("15");
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns("1.2.3");
        app.SetupGet(a => a.BuildString).Returns("123");
        return new PerushimNotesService(pad.Object, storage.FileSystem.Object, device.Object, app.Object);
    }

    public static Mock<IPadDeliveryService> Pad()
    {
        var pad = new Mock<IPadDeliveryService>();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync((string?)null);
        pad.Setup(p => p.GetDeliveryDiagnosticsAsync(It.IsAny<string>())).ReturnsAsync(["delivery status"]);
        return pad;
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task BundledDatabase_IsCopiedAndQueried_DuringInitializeOrDownload(bool download)
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync(DbName, "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
            "INSERT INTO note VALUES (1,1,1,0,'bundled note')");
        var service = Create(storage);
        if (download)
        {
            (await service.TryDownloadNotesAsync()).Should().BeTrue();
        }
        else
        {
            await service.InitializeAsync();
        }
        service.IsAvailable.Should().BeTrue();
        var notes = await service.LoadNotesForPerekAsync(1, new Dictionary<int, Perush>());
        notes.Single().NoteContent.Should().Be("bundled note");
        (await service.GetPerushIdsForPerekAsync(99)).Should().BeEmpty();
    }

    [Fact]
    public async Task Diagnostics_ReportsLocalAndDeliveryState_AndIncludesMetadata()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(DbName, "CREATE TABLE _metadata (key TEXT, value TEXT)",
            "INSERT INTO _metadata VALUES ('build_timestamp','1234')");
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(storage.Root);
        var report = await Create(storage, pad).GetDiagnosticsAsync();
        report.Should().Contain("Platform: Android (15)").And.Contain("App: 1.2.3 build 123")
            .And.Contain("IsAvailable: True").And.Contain("Local DB build_timestamp: 1234")
            .And.Contain("PAD file at root: True").And.Contain("PAD file in assets/: False")
            .And.Contain("delivery status").And.Contain("App package has notes file: False");
    }

    [Fact]
    public async Task Diagnostics_WhenUnavailable_ReportsMissingDataAndDeliveryFailure()
    {
        await using var storage = new TestStorage();
        var pad = Pad();
        pad.Setup(p => p.GetDeliveryDiagnosticsAsync(It.IsAny<string>())).ThrowsAsync(new IOException("store down"));
        var service = Create(storage, pad);
        var report = await service.GetDiagnosticsAsync();
        report.Should().Contain("IsAvailable: False").And.Contain("NotesMissing: True")
            .And.Contain("PAD/ODR path: (null)").And.Contain("Delivery diagnostics error: IOException: store down");
        (await service.GetPerushIdsForPerekAsync(1)).Should().BeEmpty();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Diagnostics_WhenDeliveryPathThrows_StillProducesSupportReport(bool localDatabaseExists)
    {
        await using var storage = new TestStorage();
        if (localDatabaseExists)
        {
            await storage.CreateDatabaseAsync(DbName, "CREATE TABLE note (perush_id INTEGER)");
        }
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("store unavailable"));

        var report = await Create(storage, pad).GetDiagnosticsAsync();

        report.Should().Contain("PAD/ODR path error: IOException: store unavailable")
            .And.Contain("delivery status").And.Contain($"IsAvailable: {localDatabaseExists}");
        if (!localDatabaseExists)
        {
            report.Should().Contain("Initialization error: IOException: store unavailable");
        }
    }

    [Fact]
    public async Task Diagnostics_RecognizesBundledNotes_AndLegacyMissingMetadata()
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync(DbName, "CREATE TABLE note (perush_id INTEGER)");
        var report = await Create(storage).GetDiagnosticsAsync();
        report.Should().Contain("App package has notes file: True").And.Contain("Local DB build_timestamp: 0");
    }

    [Theory]
    [InlineData("invalid")] [InlineData(null)]
    public async Task Upgrade_WithInvalidOrMissingTimestamp_KeepsLocalData(string? timestamp)
    {
        await using var local = new TestStorage();
        await using var remote = new TestStorage();
        await local.CreateDatabaseAsync(DbName, "CREATE TABLE _metadata (key TEXT, value TEXT)",
            "INSERT INTO _metadata VALUES ('build_timestamp','100')", "CREATE TABLE note (perush_id INTEGER)");
        var remoteDb = await remote.CreateDatabaseAsync(DbName, "CREATE TABLE _metadata (key TEXT, value TEXT)");
        if (timestamp != null)
        {
            await remoteDb.ExecuteAsync("INSERT INTO _metadata VALUES ('build_timestamp',?)", timestamp);
        }
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(remote.Root);
        var service = Create(local, pad);
        await service.InitializeAsync();
        service.IsAvailable.Should().BeTrue();
        (await service.GetDiagnosticsAsync()).Should().Contain("Local DB build_timestamp: 100");
    }

    [Fact]
    public async Task Upgrade_WhenDeliveryThrows_KeepsLocalDatabaseAvailable()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(DbName, "CREATE TABLE note (perush_id INTEGER)");
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ThrowsAsync(new IOException("store down"));
        var service = Create(storage, pad);
        await service.InitializeAsync();
        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task Upgrade_WhenPackDirectoryHasNoDatabase_KeepsLocalNotes()
    {
        await using var local = new TestStorage();
        await using var remote = new TestStorage();
        await local.CreateDatabaseAsync(DbName, "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
            "INSERT INTO note VALUES (1,1,1,0,'local note')");
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(remote.Root);
        var service = Create(local, pad);
        var notes = await service.LoadNotesForPerekAsync(1, new Dictionary<int, Perush>());
        notes.Single().NoteContent.Should().Be("local note");
        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task Initialize_CopiesAlreadyDeliveredDatabaseFromAssetsSubfolder()
    {
        await using var storage = new TestStorage();
        await using var remote = new TestStorage();
        Directory.CreateDirectory(Path.Combine(remote.Root, "assets"));
        var db = await remote.CreateDatabaseAsync(Path.Combine("assets", DbName), "CREATE TABLE note (perush_id INTEGER)");
        await db.CloseAsync();
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(remote.Root);
        var service = Create(storage, pad);
        await service.InitializeAsync();
        service.IsAvailable.Should().BeTrue();
        File.Exists(Path.Combine(storage.Root, DbName)).Should().BeTrue();
    }

    [Fact]
    public async Task Upgrade_ReadsDeliveredDatabaseFromAssetsSubfolder_AndPublishesNewNotes()
    {
        await using var local = new TestStorage();
        await using var remote = new TestStorage();
        var localDb = await local.CreateDatabaseAsync(DbName, "CREATE TABLE _metadata (key TEXT, value TEXT)",
            "INSERT INTO _metadata VALUES ('build_timestamp','100')");
        await localDb.CloseAsync();
        Directory.CreateDirectory(Path.Combine(remote.Root, "assets"));
        var remoteDb = await remote.CreateDatabaseAsync(Path.Combine("assets", DbName),
            "CREATE TABLE _metadata (key TEXT, value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','200')",
            "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
            "INSERT INTO note VALUES (1,1,1,0,'upgraded')");
        await remoteDb.CloseAsync();
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(remote.Root);
        var service = Create(local, pad);
        var notes = await service.LoadNotesForPerekAsync(1, new Dictionary<int, Perush>());
        notes.Single().NoteContent.Should().Be("upgraded");
        (await service.GetDiagnosticsAsync()).Should().Contain("Local DB build_timestamp: 200");
    }

    [Fact]
    public async Task Diagnostics_WhenLocalDatabaseIsCorrupt_ReportsZeroTimestamp()
    {
        await using var storage = new TestStorage();
        await File.WriteAllTextAsync(Path.Combine(storage.Root, DbName), "not a sqlite database", TestContext.Current.CancellationToken);
        var service = Create(storage);
        var report = await service.GetDiagnosticsAsync();
        report.Should().Contain("Local DB build_timestamp: 0");
    }

    [Fact]
    public async Task Initialize_WhenPadCopyFails_FallsBackToBundledPackage()
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync(DbName, "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
            "INSERT INTO note VALUES (1,1,1,0,'bundled note')");
        await using var remote = new TestStorage();
        var remoteDb = await remote.CreateDatabaseAsync(DbName, "CREATE TABLE note (perush_id INTEGER)");
        await remoteDb.CloseAsync();
        await using var exclusive = new FileStream(Path.Combine(remote.Root, DbName), FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var pad = Pad();
        pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>())).ReturnsAsync(remote.Root);
        var service = Create(storage, pad);
        await service.InitializeAsync();
        service.IsAvailable.Should().BeTrue();
        var notes = await service.LoadNotesForPerekAsync(1, new Dictionary<int, Perush>());
        notes.Single().NoteContent.Should().Be("bundled note");
    }

    [Fact]
    public async Task Download_WhenPackageAccessFails_ReturnsFalse()
    {
        await using var storage = new TestStorage();
        storage.FileSystem.Setup(f => f.OpenAppPackageFileAsync(It.IsAny<string>())).ThrowsAsync(new IOException("package unreadable"));
        (await Create(storage).TryDownloadNotesAsync()).Should().BeFalse();
    }

    [Fact]
    public async Task UnsupportedDesktopDelivery_ReportsUnavailableWithoutThrowing()
    {
        var service = PadDeliveryService.Instance;
        (await service.TryGetAssetPathAsync("perushim_notes", TestContext.Current.CancellationToken)).Should().BeNull();
        (await service.FetchAsync("perushim_notes", cancellationToken: TestContext.Current.CancellationToken)).Should().BeFalse();
        (await service.GetDeliveryDiagnosticsAsync("perushim_notes")).Should().Contain("Platform: no on-demand delivery support");
        var analytics = new AnalyticsService();
        analytics.SetScreen("test");
        analytics.LogSearch("משה");
    }

    [Fact]
    public void IndependentExtensionsUseTheirOwnApplePayloadNames()
    {
        PadDeliveryService.PayloadFileName("perushim_notes").Should().Be("sefaria-dump-5784-sivan-4.perushim_notes.sqlite");
        PadDeliveryService.PayloadFileName("recitation_1").Should().Be("recitation_1.zip");
        PadDeliveryService.PayloadFileName("recitation_39").Should().Be("recitation_39.zip");
    }
}
