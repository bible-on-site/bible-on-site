using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using System.Text.Json;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.Devices;

namespace BibleOnSite.Tests.Services;

public class PerushimAttributionTests
{
    private const string CatalogDb = "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite";
    private const string NotesDb = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string ModernNote = "בניגוד לתיאוריות שונות, עולה מכאן שהקרבת קרבנות היא מעשה ראשוני ובסיסי";

    [Fact]
    public async Task UpdatedApp_ReplacesOldCatalogBeforeLabelingDeliveredNotes()
    {
        await using var storage = new TestStorage();
        await BundleCatalogAsync(storage);
        var oldCatalog = await storage.CreateDatabaseAsync(CatalogDb, CatalogSchema,
            "INSERT INTO perush VALUES (13,'בכור שור',1345)");
        await oldCatalog.CloseAsync();
        await CreateNotesAsync(storage, timestamp: "200");

        var catalog = new PerushimCatalogService(storage.FileSystem.Object);
        var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object);
        var names = await catalog.GetPerushimByIdsAsync(await notes.GetPerushIdsForPerekAsync(4));
        var displayed = await notes.LoadNotesForPerekAsync(4, names);

        displayed.Should().ContainSingle();
        displayed[0].NoteContent.Should().Be(ModernNote);
        displayed[0].PerushName.Should().Be("ביאור שטיינזלץ");
        (await catalog.GetPerushimByIdsAsync([15]))[15].Name.Should().Be("בכור שור");
    }

    [Theory]
    [InlineData("100", null)] // Legacy notes from the old ID mapping.
    [InlineData("200", "wrong")] // Timestamps alone do not establish compatibility.
    public async Task MismatchedNotes_AreUnavailableAndNeverLabeledWithCurrentCatalog(string timestamp, string? mapping)
    {
        await using var storage = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, timestamp, mapping == null ? null : new() { [13] = "בכור שור" });
        var service = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object);

        var ids = await service.GetPerushIdsForPerekAsync(4);
        var displayed = await service.LoadNotesForPerekAsync(4, new Dictionary<int, Perush>
        {
            [13] = new() { Id = 13, Name = "ביאור שטיינזלץ" }
        });

        service.IsAvailable.Should().BeFalse();
        ids.Should().BeEmpty();
        displayed.Should().BeEmpty();
    }

    [Fact]
    public async Task IndependentlyGeneratedNotes_WithSameIdMappingRemainCompatible()
    {
        await using var storage = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, "999", CurrentMapping);
        var service = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object);

        (await service.GetPerushIdsForPerekAsync(4)).Should().Equal(13);
        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task NativeRelease_WithJsonReflectionDisabled_ValidatesAndDisplaysMatchingNotes()
    {
        JsonSerializer.IsReflectionEnabledByDefault.Should().BeFalse();
        await using var storage = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, "999", CurrentMapping);
        var service = DiagnosticService(storage);
        var catalog = new PerushimCatalogService(storage.FileSystem.Object);

        var notes = await service.LoadNotesForPerekAsync(4, await catalog.GetPerushimByIdsAsync([13]));

        notes.Should().ContainSingle().Which.PerushName.Should().Be("ביאור שטיינזלץ");
        notes.Single().NoteContent.Should().Be(ModernNote);
        var report = await service.GetDiagnosticsAsync();
        report.Should().Contain("IsAvailable: True")
            .And.Contain("Notes validation: Compatible catalog mapping (2 entries)")
            .And.Contain("JSON reflection enabled by default: False");
    }

    [Fact]
    public async Task Diagnostics_ExplainsReportedLegacyPackMismatch_WhenOdrFileExists()
    {
        await using var storage = new TestStorage();
        await using var delivered = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, "1790678024");
        await CreateNotesAsync(delivered, "1790678024");
        var pad = NotesDeliveryTests.Pad();
        pad.Setup(p => p.TryGetAssetPathAsync("perushim_notes", It.IsAny<CancellationToken>())).ReturnsAsync(delivered.Root);
        var service = DiagnosticService(storage, pad);

        var report = await service.GetDiagnosticsAsync();

        report.Should().Contain("Platform: iOS")
            .And.Contain("Local DB exists: True").And.Contain("PAD file at root: True")
            .And.Contain("IsAvailable: False")
            .And.Contain("Legacy build mismatch (notes=1790678024, catalog=200)");
        (await service.TryDownloadNotesAsync()).Should().BeFalse();
        (await service.GetPerushIdsForPerekAsync(4)).Should().BeEmpty();
    }

    [Theory]
    [InlineData("{\"13\":\"בכור שור\"}", "Catalog mapping mismatch (notes=1, catalog=2)")]
    [InlineData("null", "Catalog mapping mismatch (notes=0, catalog=2)")]
    [InlineData("invalid JSON", "Validation error: JsonException:")]
    public async Task Diagnostics_RetainsValidationFailureReason(string snapshot, string reason)
    {
        await using var storage = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, "200");
        var db = await storage.CreateDatabaseAsync(NotesDb);
        await db.ExecuteAsync("INSERT INTO _metadata VALUES ('perush_catalog',?)", snapshot);
        await db.CloseAsync();
        var service = DiagnosticService(storage);

        await service.InitializeAsync();

        (await service.GetDiagnosticsAsync()).Should().Contain("IsAvailable: False").And.Contain(reason);
    }

    [Fact]
    public async Task Download_RecoversFromRejectedPackWithEqualTimestampAndUpdatesDiagnosticStatus()
    {
        await using var storage = new TestStorage();
        await using var delivered = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, "300", new() { [13] = "בכור שור" });
        await CreateNotesAsync(delivered, "300", CurrentMapping);
        var pad = NotesDeliveryTests.Pad();
        pad.Setup(p => p.TryGetAssetPathAsync("perushim_notes", It.IsAny<CancellationToken>())).ReturnsAsync(delivered.Root);
        var service = DiagnosticService(storage, pad);
        await service.InitializeAsync();
        service.IsAvailable.Should().BeFalse();

        (await service.TryDownloadNotesAsync()).Should().BeTrue();

        service.IsAvailable.Should().BeTrue();
        (await service.GetDiagnosticsAsync()).Should().Contain("Compatible catalog mapping (2 entries)");
        pad.Verify(p => p.FetchAsync(It.IsAny<string>(), It.IsAny<IProgress<double>?>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static PerushimNotesService DiagnosticService(TestStorage storage, Mock<IPadDeliveryService>? pad = null)
    {
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.iOS);
        return new PerushimNotesService((pad ?? NotesDeliveryTests.Pad()).Object, storage.FileSystem.Object,
            device.Object, Mock.Of<IAppInfo>());
    }

    [Theory]
    [InlineData("invalid JSON")]
    [InlineData("null")]
    [InlineData("{\"13\":\"בכור שור\",\"15\":\"ביאור שטיינזלץ\"}")]
    [InlineData("{\"12\":\"ביאור שטיינזלץ\",\"15\":\"בכור שור\"}")]
    public async Task InvalidMapping_IsRejectedEvenWhenBuildTimestampMatches(string snapshot)
    {
        await using var storage = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, "200");
        var db = await storage.CreateDatabaseAsync(NotesDb);
        await db.ExecuteAsync("INSERT INTO _metadata VALUES ('perush_catalog',?)", snapshot);
        await db.CloseAsync();
        var service = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object);

        (await service.GetPerushIdsForPerekAsync(4)).Should().BeEmpty();
        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task NotesWithoutGenerationMetadata_CannotBeAttributed()
    {
        await using var storage = new TestStorage();
        await BundleCatalogAsync(storage);
        await storage.CreateDatabaseAsync(NotesDb, "CREATE TABLE note (perush_id INTEGER)");
        var service = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object);

        await service.InitializeAsync();
        service.IsAvailable.Should().BeFalse();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Download_ReplacesIncompatibleExistingNotesAndRechecksAttribution(bool assetsSubfolder)
    {
        await using var storage = new TestStorage();
        await using var delivered = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(storage, "100");
        await CreateNotesAsync(delivered, "300", CurrentMapping);
        if (assetsSubfolder)
        {
            Directory.CreateDirectory(Path.Combine(delivered.Root, "assets"));
            File.Move(Path.Combine(delivered.Root, NotesDb), Path.Combine(delivered.Root, "assets", NotesDb));
        }
        var pad = NotesDeliveryTests.Pad();
        pad.Setup(p => p.FetchAsync("perushim_notes", It.IsAny<IProgress<double>?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true).Callback(() => pad.Setup(p => p.TryGetAssetPathAsync("perushim_notes", It.IsAny<CancellationToken>()))
                .ReturnsAsync(delivered.Root));
        var service = new PerushimNotesService(pad.Object, storage.FileSystem.Object);
        await service.InitializeAsync();

        (await service.TryDownloadNotesAsync()).Should().BeTrue();
        service.IsAvailable.Should().BeTrue();
        pad.Verify(p => p.FetchAsync("perushim_notes", It.IsAny<IProgress<double>?>(), It.IsAny<CancellationToken>()), Times.Once);
        var catalog = new PerushimCatalogService(storage.FileSystem.Object);
        var names = await catalog.GetPerushimByIdsAsync([13]);
        (await service.LoadNotesForPerekAsync(4, names)).Single().PerushName.Should().Be("ביאור שטיינזלץ");
    }

    [Fact]
    public async Task Download_DoesNotAcceptIncompatibleDeliveredPack()
    {
        await using var storage = new TestStorage();
        await using var delivered = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(delivered, "300", new() { [13] = "בכור שור" });
        var pad = NotesDeliveryTests.Pad();
        pad.Setup(p => p.TryGetAssetPathAsync("perushim_notes", It.IsAny<CancellationToken>())).ReturnsAsync(delivered.Root);
        var service = new PerushimNotesService(pad.Object, storage.FileSystem.Object);

        (await service.TryDownloadNotesAsync()).Should().BeFalse();
        service.IsAvailable.Should().BeFalse();
        (await service.GetPerushIdsForPerekAsync(4)).Should().BeEmpty();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Download_RejectsIncompatibleFetchedOrBundledNotes(bool bundled)
    {
        await using var storage = new TestStorage();
        await using var delivered = new TestStorage();
        await BundleCatalogAsync(storage);
        await CreateNotesAsync(delivered, "300", new() { [13] = "בכור שור" });
        var pad = NotesDeliveryTests.Pad();
        if (bundled)
        {
            storage.PackageFiles[NotesDb] = await File.ReadAllBytesAsync(Path.Combine(delivered.Root, NotesDb), TestContext.Current.CancellationToken);
        }
        else
        {
            pad.Setup(p => p.FetchAsync("perushim_notes", It.IsAny<IProgress<double>?>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(true).Callback(() => pad.Setup(p => p.TryGetAssetPathAsync("perushim_notes", It.IsAny<CancellationToken>()))
                    .ReturnsAsync(delivered.Root));
        }
        var service = new PerushimNotesService(pad.Object, storage.FileSystem.Object);

        (await service.TryDownloadNotesAsync()).Should().BeFalse();
        service.IsAvailable.Should().BeFalse();
        (await service.LoadNotesForPerekAsync(4, new Dictionary<int, Perush>())).Should().BeEmpty();
    }

    private const string CatalogSchema = "CREATE TABLE perush (id INTEGER PRIMARY KEY, name TEXT, priority INTEGER)";
    private static Dictionary<int, string> CurrentMapping => new() { [13] = "ביאור שטיינזלץ", [15] = "בכור שור" };

    private static Task BundleCatalogAsync(TestStorage storage) => storage.BundleDatabaseAsync(CatalogDb,
        CatalogSchema, "INSERT INTO perush VALUES (13,'ביאור שטיינזלץ',2000),(15,'בכור שור',1345)",
        "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)",
        "INSERT INTO _metadata VALUES ('build_timestamp','200')");

    private static async Task CreateNotesAsync(TestStorage storage, string timestamp, Dictionary<int, string>? mapping = null)
    {
        var db = await storage.CreateDatabaseAsync(NotesDb,
            "CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)",
            "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)");
        await db.ExecuteAsync("INSERT INTO _metadata VALUES ('build_timestamp',?)", timestamp);
        if (mapping != null)
        {
            await db.ExecuteAsync("INSERT INTO _metadata VALUES ('perush_catalog',?)",
                JsonSerializer.Serialize(mapping, AppJsonContext.Default.PerushCatalog));
        }
        await db.ExecuteAsync("INSERT INTO note VALUES (13,4,3,0,?)", ModernNote);
        await db.CloseAsync();
    }
}
