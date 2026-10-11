using BibleOnSite.Models;
using BibleOnSite.Services;
using FluentAssertions;
using SQLite;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Unit tests for <see cref="PerushimNotesService"/> using <see cref="PerushimNotesService.CreateForTesting"/>.
/// </summary>
public sealed class PerushimNotesServiceTests : IDisposable
{
    private const string NotesDbFileName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";

    private readonly string _tempRoot;

    public PerushimNotesServiceTests()
    {
        _tempRoot = Path.Join(Path.GetTempPath(), "BibleOnSiteTests_" + Path.GetRandomFileName());
        Directory.CreateDirectory(_tempRoot);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempRoot))
                Directory.Delete(_tempRoot, true);
        }
        catch
        {
            // Best-effort cleanup on temp directory.
        }
    }

    [Fact]
    public void IsAvailable_ReturnsFalse_BeforeInitialize()
    {
        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), _tempRoot);

        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_WithExistingDb_SetsIsAvailableTrue()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithExistingDb_SetsIsAvailableTrue));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(dataDir);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task InitializeAsync_WithoutDb_AndNoPad_SetsNotesMissing()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithoutDb_AndNoPad_SetsNotesMissing));
        Directory.CreateDirectory(dataDir);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_CalledTwice_IsIdempotent()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_CalledTwice_IsIdempotent));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(dataDir);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();
        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task GetPerushIdsForPerekAsync_ReturnsDistinctIds()
    {
        var dataDir = Path.Join(_tempRoot, nameof(GetPerushIdsForPerekAsync_ReturnsDistinctIds));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(
            dataDir,
            (10, 1, 1, 0, "a"),
            (10, 1, 2, 0, "b"),
            (20, 1, 1, 0, "c"));

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);
        await service.InitializeAsync();

        var ids = await service.GetPerushIdsForPerekAsync(1);

        ids.Should().Equal(10, 20);
    }

    [Fact]
    public async Task LoadNotesForPerekAsync_ReturnsNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(LoadNotesForPerekAsync_ReturnsNotes));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(
            dataDir,
            (5, 2, 3, 0, "note one"),
            (7, 2, 4, 1, "note two"));

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);
        await service.InitializeAsync();

        var perushById = new Dictionary<int, Perush>
        {
            { 5, new Perush { Id = 5, Name = "Rashi", Priority = 1 } },
            { 7, new Perush { Id = 7, Name = "Ibn Ezra", Priority = 2 } }
        };

        var notes = await service.LoadNotesForPerekAsync(2, perushById);

        notes.Should().HaveCount(2);
        notes[0].PerushId.Should().Be(5);
        notes[0].PerushName.Should().Be("Rashi");
        notes[0].PerekId.Should().Be(2);
        notes[0].Pasuk.Should().Be(3);
        notes[0].NoteIdx.Should().Be(0);
        notes[0].NoteContent.Should().Be("note one");
        notes[1].PerushId.Should().Be(7);
        notes[1].PerushName.Should().Be("Ibn Ezra");
        notes[1].PerekId.Should().Be(2);
        notes[1].Pasuk.Should().Be(4);
        notes[1].NoteIdx.Should().Be(1);
        notes[1].NoteContent.Should().Be("note two");
    }

    [Fact]
    public async Task LoadNotesForPerekAsync_UsesFallbackNameAndEmptyContent()
    {
        var dataDir = Path.Join(_tempRoot, nameof(LoadNotesForPerekAsync_UsesFallbackNameAndEmptyContent));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(
            dataDir,
            (42, 3, 5, 2, null));

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);
        await service.InitializeAsync();

        var notes = await service.LoadNotesForPerekAsync(3, new Dictionary<int, Perush>());

        notes.Should().ContainSingle();
        notes[0].PerushId.Should().Be(42);
        notes[0].PerushName.Should().Be("Perush 42");
        notes[0].NoteContent.Should().BeEmpty();
    }

    [Fact]
    public async Task LoadNotesForPerekAsync_WhenNotInitialized_ReturnsEmpty()
    {
        var dataDir = Path.Join(_tempRoot, nameof(LoadNotesForPerekAsync_WhenNotInitialized_ReturnsEmpty));
        Directory.CreateDirectory(dataDir);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);
        var notes = await service.LoadNotesForPerekAsync(1, new Dictionary<int, Perush>());

        notes.Should().BeEmpty();
    }

    [Fact]
    public async Task TryDownloadNotesAsync_CopiesAvailablePadDatabase()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_CopiesAvailablePadDatabase));
        var padDir = Path.Join(_tempRoot, "pad-root");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(padDir, (9, 4, 1, 0, "pad note"));

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir },
            dataDir);

        var downloaded = await service.TryDownloadNotesAsync();

        downloaded.Should().BeTrue();
        service.IsAvailable.Should().BeTrue();
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeTrue();
        var ids = await service.GetPerushIdsForPerekAsync(4);
        ids.Should().Equal(9);
    }

    [Fact]
    public async Task TryDownloadNotesAsync_FetchesThenCopiesDatabaseFromAssetsFolder()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_FetchesThenCopiesDatabaseFromAssetsFolder));
        var padDir = Path.Join(_tempRoot, "pad-assets");
        var assetsDir = Path.Join(padDir, "assets");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(assetsDir);
        await CreateNotesDatabaseAsync(assetsDir, (11, 6, 2, 0, "asset note"));
        var fakePad = new FakePadDeliveryService
        {
            FetchResult = true,
            AssetPathAfterFetch = padDir
        };

        var service = PerushimNotesService.CreateForTesting(fakePad, dataDir);

        var downloaded = await service.TryDownloadNotesAsync();

        downloaded.Should().BeTrue();
        fakePad.FetchCalls.Should().Be(1);
        service.IsAvailable.Should().BeTrue();
        var ids = await service.GetPerushIdsForPerekAsync(6);
        ids.Should().Equal(11);
    }

    [Fact]
    public async Task InitializeAsync_WithNewerPadDatabase_ReplacesLocalDatabase()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithNewerPadDatabase_ReplacesLocalDatabase));
        var padDir = Path.Join(_tempRoot, "pad-newer");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(
            dataDir,
            buildTimestamp: 100,
            (3, 8, 1, 0, "local note"));
        await CreateNotesDatabaseAsync(
            padDir,
            buildTimestamp: 200,
            (4, 8, 1, 0, "pad note"));

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir },
            dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        var ids = await service.GetPerushIdsForPerekAsync(8);
        ids.Should().Equal(4);
        var notes = await service.LoadNotesForPerekAsync(8, new Dictionary<int, Perush>());
        notes.Should().ContainSingle().Which.NoteContent.Should().Be("pad note");
    }

    [Fact]
    public async Task InitializeAsync_WithOlderPadDatabase_KeepsLocalDatabase()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithOlderPadDatabase_KeepsLocalDatabase));
        var padDir = Path.Join(_tempRoot, "pad-older");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(
            dataDir,
            buildTimestamp: 200,
            (3, 8, 1, 0, "local note"));
        await CreateNotesDatabaseAsync(
            padDir,
            buildTimestamp: 100,
            (4, 8, 1, 0, "pad note"));

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir },
            dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        var notes = await service.LoadNotesForPerekAsync(8, new Dictionary<int, Perush>());
        notes.Should().ContainSingle().Which.NoteContent.Should().Be("local note");
    }

    [Fact]
    public async Task TryDownloadNotesAsync_WhenLocalDatabaseAlreadyExists_ReturnsTrueWithoutFetching()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_WhenLocalDatabaseAlreadyExists_ReturnsTrueWithoutFetching));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(dataDir, (7, 3, 1, 0, "local note"));
        var fakePad = new FakePadDeliveryService();
        var service = PerushimNotesService.CreateForTesting(fakePad, dataDir);

        var downloaded = await service.TryDownloadNotesAsync();

        downloaded.Should().BeTrue();
        fakePad.FetchCalls.Should().Be(0);
        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task TryDownloadNotesAsync_WhenFetchedPackHasNoDatabase_ReturnsFalse()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_WhenFetchedPackHasNoDatabase_ReturnsFalse));
        var padDir = Path.Join(_tempRoot, "pad-empty-after-fetch");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        var fakePad = new FakePadDeliveryService
        {
            FetchResult = true,
            AssetPathAfterFetch = padDir
        };
        var service = PerushimNotesService.CreateForTesting(fakePad, dataDir);

        var downloaded = await service.TryDownloadNotesAsync();

        downloaded.Should().BeFalse();
        fakePad.FetchCalls.Should().Be(1);
        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task TryDownloadNotesAsync_WhenTargetDirectoryIsMissing_ReturnsFalse()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_WhenTargetDirectoryIsMissing_ReturnsFalse));
        var padDir = Path.Join(_tempRoot, "pad-target-missing");
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(padDir, (8, 4, 1, 0, "pad note"));
        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir },
            dataDir);

        var downloaded = await service.TryDownloadNotesAsync();

        downloaded.Should().BeFalse();
        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_WhenPadMetadataIsUnreadable_KeepsLocalDatabase()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WhenPadMetadataIsUnreadable_KeepsLocalDatabase));
        var padDir = Path.Join(_tempRoot, "pad-bad-metadata");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(dataDir, buildTimestamp: 200, (9, 4, 1, 0, "local note"));
        await File.WriteAllTextAsync(Path.Join(padDir, NotesDbFileName), "not sqlite", TestContext.Current.CancellationToken);
        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir },
            dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        var notes = await service.LoadNotesForPerekAsync(4, new Dictionary<int, Perush>());
        notes.Should().ContainSingle().Which.NoteContent.Should().Be("local note");
    }

    [Fact]
    public async Task InitializeAsync_WithLegacyV1DatabaseAndEqualTimestampPad_AdoptsPadCopy()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithLegacyV1DatabaseAndEqualTimestampPad_AdoptsPadCopy));
        var padDir = Path.Join(_tempRoot, "pad-equal-ts");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);

        // A v1 row-based pack left over from an older app version — same
        // generation as the store pack, so a timestamp comparison alone would
        // keep it and the device would still carry an unqueryable ~285 MB file.
        var legacy = new SQLiteAsyncConnection(Path.Join(dataDir, NotesDbFileName));
        await legacy.ExecuteAsync("CREATE TABLE _metadata (key TEXT, value TEXT)");
        await legacy.ExecuteAsync("INSERT INTO _metadata VALUES ('build_timestamp','1500000000')");
        await legacy.ExecuteAsync("CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)");
        await legacy.ExecuteAsync("INSERT INTO note VALUES (9,4,1,0,'stale note')");
        await legacy.CloseAsync();

        await CreateNotesDatabaseAsync(
            padDir,
            buildTimestamp: 1500000000,
            (9, 4, 1, 0, "fresh note"));

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir },
            dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        var notes = await service.LoadNotesForPerekAsync(4, new Dictionary<int, Perush>());
        notes.Should().ContainSingle().Which.NoteContent.Should().Be("fresh note");
    }

    [Fact]
    public async Task InitializeAsync_WithLegacyV1Database_DeletesRejectedFilesAndStagedIndex()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithLegacyV1Database_DeletesRejectedFilesAndStagedIndex));
        Directory.CreateDirectory(dataDir);

        // v1 notes + a staged search index + journal sidecars — all must go so
        // the device does not keep hundreds of MB of unusable data.
        var legacy = new SQLiteAsyncConnection(Path.Join(dataDir, NotesDbFileName));
        await legacy.ExecuteAsync("CREATE TABLE _metadata (key TEXT, value TEXT)");
        await legacy.ExecuteAsync("CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)");
        await legacy.CloseAsync();
        var indexPath = Path.Join(dataDir, PerushimNotesService.SearchIndexDbName);
        await File.WriteAllTextAsync(indexPath, "staged index", TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(indexPath + "-wal", "journal", TestContext.Current.CancellationToken);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse();
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeFalse("a rejected legacy DB must not linger on the device");
        File.Exists(indexPath).Should().BeFalse("the index belongs to the rejected generation");
        File.Exists(indexPath + "-wal").Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_SweepsInterruptedAtomicCopyLeftovers()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_SweepsInterruptedAtomicCopyLeftovers));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(dataDir, (7, 3, 1, 0, "local note"));
        var staleNotes = Path.Join(dataDir, $"{NotesDbFileName}.{Guid.NewGuid():N}.tmp");
        var staleIndex = Path.Join(dataDir, $"{PerushimNotesService.SearchIndexDbName}.{Guid.NewGuid():N}.tmp");
        await File.WriteAllTextAsync(staleNotes, "partial copy", TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(staleIndex, "partial copy", TestContext.Current.CancellationToken);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);
        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        File.Exists(staleNotes).Should().BeFalse();
        File.Exists(staleIndex).Should().BeFalse();
        Directory.GetFiles(dataDir, "*.tmp").Should().BeEmpty();
    }

    [Fact]
    public async Task InitializeAsync_CopiesDeliveredIndexAlongsidePadNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_CopiesDeliveredIndexAlongsidePadNotes));
        var padDir = Path.Join(_tempRoot, "pad-with-index");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(padDir, (9, 4, 1, 0, "pad note"));
        await File.WriteAllTextAsync(Path.Join(padDir, PerushimNotesService.SearchIndexDbName), "delivered index", TestContext.Current.CancellationToken);

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir },
            dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        var stagedIndex = Path.Join(dataDir, PerushimNotesService.SearchIndexDbName);
        File.Exists(stagedIndex).Should().BeTrue();
        (await service.GetDeliveredIndexPathAsync()).Should().Be(stagedIndex);
    }

    [Fact]
    public async Task InitializeAsync_WithLegacyV1Database_RejectsIt_AndDownloadRecovers()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithLegacyV1Database_RejectsIt_AndDownloadRecovers));
        var padDir = Path.Join(_tempRoot, "pad-legacy-replacement");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);

        // A v1 row-based pack left over from an older app version.
        var legacy = new SQLiteAsyncConnection(Path.Join(dataDir, NotesDbFileName));
        await legacy.ExecuteAsync("CREATE TABLE _metadata (key TEXT, value TEXT)");
        await legacy.ExecuteAsync("INSERT INTO _metadata VALUES ('build_timestamp','1500000000')");
        await legacy.ExecuteAsync("CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)");
        await legacy.ExecuteAsync("INSERT INTO note VALUES (9,4,1,0,'stale note')");
        await legacy.CloseAsync();

        await CreateNotesDatabaseAsync(padDir, (9, 4, 1, 0, "fresh note"));

        // GetDiagnosticsAsync touches MAUI platform services, so inject mocks.
        var fileSystem = new Mock<IFileSystem>();
        fileSystem.SetupGet(f => f.AppDataDirectory).Returns(dataDir);
        fileSystem.Setup(f => f.OpenAppPackageFileAsync(It.IsAny<string>()))
            .ReturnsAsync((string name) => throw new FileNotFoundException(name));
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.Android);
        device.SetupGet(d => d.VersionString).Returns("15");
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns("1.2.3");
        app.SetupGet(a => a.BuildString).Returns("123");
        var service = new PerushimNotesService(
            new FakePadDeliveryService { FetchResult = true, AssetPathAfterFetch = padDir },
            fileSystem.Object,
            device.Object,
            app.Object);

        await service.InitializeAsync();
        service.IsAvailable.Should().BeFalse();
        (await service.GetDiagnosticsAsync()).Should().Contain("Legacy notes schema");

        (await service.TryDownloadNotesAsync()).Should().BeTrue();

        service.IsAvailable.Should().BeTrue();
        var notes = await service.LoadNotesForPerekAsync(4, new Dictionary<int, Perush>());
        notes.Should().ContainSingle().Which.NoteContent.Should().Be("fresh note");
    }

    [Fact]
    public async Task TryDownloadNotesAsync_WhenDeliveryUnavailable_ReturnsFalse()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_WhenDeliveryUnavailable_ReturnsFalse));
        Directory.CreateDirectory(dataDir);
        var fakePad = new FakePadDeliveryService { FetchResult = false };
        var progress = new Progress<double>();
        var service = PerushimNotesService.CreateForTesting(fakePad, dataDir);

        var downloaded = await service.TryDownloadNotesAsync(progress);

        downloaded.Should().BeFalse();
        fakePad.FetchCalls.Should().Be(1);
        fakePad.LastProgress.Should().BeSameAs(progress);
        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task LoadNotesForPerekAsync_ForPerekWithoutBlob_ReturnsEmpty()
    {
        var dataDir = Path.Join(_tempRoot, nameof(LoadNotesForPerekAsync_ForPerekWithoutBlob_ReturnsEmpty));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(dataDir, (7, 1, 1, 0, "a"));

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        var notes = await service.LoadNotesForPerekAsync(999, new Dictionary<int, Perush>());

        notes.Should().BeEmpty();
        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task InitializeAsync_WithV2DbAndNoCatalog_AcceptsNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithV2DbAndNoCatalog_AcceptsNotes));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(dataDir, (7, 1, 1, 0, "a"));
        // The real ctor creates a catalog service; with no catalog anywhere,
        // attribution cannot be checked but raw notes stay usable.
        var service = new PerushimNotesService(
            new FakePadDeliveryService(), FileSystemReturning(dataDir), DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task InitializeAsync_WithMatchingCatalogSnapshot_AcceptsNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithMatchingCatalogSnapshot_AcceptsNotes));
        Directory.CreateDirectory(dataDir);
        await CreateCatalogDatabaseAsync(dataDir, 777, (1, "רשי", 100));
        await CreateNotesDatabaseFromStatementsAsync(
            dataDir,
            [.. BibleOnSite.Tests.Support.NotesDbV2.Statements((7, 1, 1, 0, "a")),
                "INSERT INTO _metadata VALUES ('perush_catalog','{\"1\":\"רשי\"}')",
                "INSERT INTO _metadata VALUES ('build_timestamp','555')"]);

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), FileSystemReturning(dataDir), DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue("the pack records the same catalog the app ships");
    }

    [Fact]
    public async Task InitializeAsync_WithMismatchedCatalogSnapshot_RejectsAndMarksGeneration()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithMismatchedCatalogSnapshot_RejectsAndMarksGeneration));
        Directory.CreateDirectory(dataDir);
        await CreateCatalogDatabaseAsync(dataDir, 777, (1, "רשי", 100));
        await CreateNotesDatabaseFromStatementsAsync(
            dataDir,
            [.. BibleOnSite.Tests.Support.NotesDbV2.Statements((7, 1, 1, 0, "a")),
                "INSERT INTO _metadata VALUES ('perush_catalog','{\"1\":\"שונה\"}')",
                "INSERT INTO _metadata VALUES ('build_timestamp','555')"]);

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), FileSystemReturning(dataDir), DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse("notes from a different catalog generation are rejected");
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeFalse();
        File.Exists(Path.Join(dataDir, NotesDbFileName + ".rejected"))
            .Should().BeTrue("a generation defect is recorded so the same pack is not re-copied");
    }

    [Fact]
    public async Task InitializeAsync_WithMatchingLegacyTimestamps_AcceptsNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithMatchingLegacyTimestamps_AcceptsNotes));
        Directory.CreateDirectory(dataDir);
        await CreateCatalogDatabaseAsync(dataDir, 555, (1, "רשי", 100));
        // v2 notes without a perush_catalog snapshot fall back to matching
        // build timestamps — the pre-snapshot pack generation.
        await CreateNotesDatabaseAsync(dataDir, 555, (7, 1, 1, 0, "a"));

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), FileSystemReturning(dataDir), DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task InitializeAsync_WithMismatchedLegacyTimestamps_RejectsNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithMismatchedLegacyTimestamps_RejectsNotes));
        Directory.CreateDirectory(dataDir);
        await CreateCatalogDatabaseAsync(dataDir, 222, (1, "רשי", 100));
        await CreateNotesDatabaseAsync(dataDir, 111, (7, 1, 1, 0, "a"));

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), FileSystemReturning(dataDir), DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse("a notes pack from a different build must not be trusted");
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_WhenCatalogQueryFails_RejectsWithoutMarker()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WhenCatalogQueryFails_RejectsWithoutMarker));
        Directory.CreateDirectory(dataDir);
        // A catalog file that opens but has no perush table — GetAllPerushimAsync throws.
        var catalog = new SQLiteAsyncConnection(Path.Join(dataDir, CatalogDbFileName));
        await catalog.ExecuteAsync("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)");
        await catalog.CloseAsync();
        await CreateNotesDatabaseFromStatementsAsync(
            dataDir,
            [.. BibleOnSite.Tests.Support.NotesDbV2.Statements((7, 1, 1, 0, "a")),
                "INSERT INTO _metadata VALUES ('perush_catalog','{\"1\":\"רשי\"}')"]);

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), FileSystemReturning(dataDir), DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse("a mid-validation failure rejects the notes");
        File.Exists(Path.Join(dataDir, NotesDbFileName + ".rejected"))
            .Should().BeFalse("an ambiguous failure must not block an equal-build pack");
    }

    [Fact]
    public async Task InitializeAsync_WithRejectedGenerationMarker_SkipsMatchingPadCopy()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithRejectedGenerationMarker_SkipsMatchingPadCopy));
        var padDir = Path.Join(_tempRoot, "pad-rejected");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(padDir, 555, (9, 4, 1, 0, "pad note"));
        // A previous launch already rejected this exact generation.
        await File.WriteAllTextAsync(Path.Join(dataDir, NotesDbFileName + ".rejected"), "555",
            TestContext.Current.CancellationToken);

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir }, dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse("the rejected generation must not loop copy→reject→delete");
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeFalse();

        // A different generation clears the marker on the next initialize.
        await CreateNotesDatabaseAsync(padDir, 777, (9, 4, 1, 0, "pad note"));
        var service2 = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir }, dataDir);

        await service2.InitializeAsync();

        service2.IsAvailable.Should().BeTrue("a new pack generation proceeds past the marker");
        File.Exists(Path.Join(dataDir, NotesDbFileName + ".rejected")).Should().BeFalse();
    }

    [Fact]
    public async Task TryDownloadNotesAsync_IgnoresRejectionMarkerOnExplicitRetry()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_IgnoresRejectionMarkerOnExplicitRetry));
        var padDir = Path.Join(_tempRoot, "pad-retry");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(padDir, 555, (9, 4, 1, 0, "pad note"));
        await File.WriteAllTextAsync(Path.Join(dataDir, NotesDbFileName + ".rejected"), "555",
            TestContext.Current.CancellationToken);

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir }, dataDir);

        var downloaded = await service.TryDownloadNotesAsync();

        downloaded.Should().BeTrue("an explicit download retries even a rejected generation");
        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task InitializeAsync_CopiesV2DatabaseFromAppPackage()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_CopiesV2DatabaseFromAppPackage));
        var packDir = Path.Join(_tempRoot, "packaged");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(packDir);
        await CreateNotesDatabaseAsync(packDir, (9, 4, 1, 0, "bundled note"));
        var packagedBytes = await File.ReadAllBytesAsync(
            Path.Join(packDir, NotesDbFileName), TestContext.Current.CancellationToken);
        var fileSystem = FileSystemReturning(dataDir, (NotesDbFileName, packagedBytes));

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), fileSystem, DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue("the bundled Debug-APK copy is adopted after schema checks");
        var ids = await service.GetPerushIdsForPerekAsync(4);
        ids.Should().Equal(9);
    }

    [Fact]
    public async Task InitializeAsync_RejectsLegacyAppPackageDatabase()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_RejectsLegacyAppPackageDatabase));
        var packDir = Path.Join(_tempRoot, "packaged-legacy");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(packDir);
        // A v1 row-based bundle cannot be queried — it must never become the local DB.
        var legacy = new SQLiteAsyncConnection(Path.Join(packDir, NotesDbFileName));
        await legacy.ExecuteAsync("CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)");
        await legacy.CloseAsync();
        var packagedBytes = await File.ReadAllBytesAsync(
            Path.Join(packDir, NotesDbFileName), TestContext.Current.CancellationToken);
        var fileSystem = FileSystemReturning(dataDir, (NotesDbFileName, packagedBytes));

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), fileSystem, DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse();
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeFalse();
        File.Exists(Path.Join(dataDir, NotesDbFileName + ".pkgcheck")).Should().BeFalse(
            "the rejected staged copy is removed");
    }

    [Fact]
    public async Task InitializeAsync_WithDbMissingMetadata_RejectsAsLegacy()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WithDbMissingMetadata_RejectsAsLegacy));
        Directory.CreateDirectory(dataDir);
        // No _metadata table at all — schema_version cannot even be queried.
        var legacy = new SQLiteAsyncConnection(Path.Join(dataDir, NotesDbFileName));
        await legacy.ExecuteAsync("CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)");
        await legacy.CloseAsync();

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse();
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeFalse();
    }

    [Fact]
    public async Task TryDownloadNotesAsync_WhenCopiedPackFailsValidation_ReturnsFalse()
    {
        var dataDir = Path.Join(_tempRoot, nameof(TryDownloadNotesAsync_WhenCopiedPackFailsValidation_ReturnsFalse));
        var padDir = Path.Join(_tempRoot, "pad-catalog-mismatch");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateCatalogDatabaseAsync(dataDir, 777, (1, "רשי", 100));
        await CreateNotesDatabaseFromStatementsAsync(
            padDir,
            [.. BibleOnSite.Tests.Support.NotesDbV2.Statements((7, 1, 1, 0, "a")),
                "INSERT INTO _metadata VALUES ('perush_catalog','{\"1\":\"שונה\"}')",
                "INSERT INTO _metadata VALUES ('build_timestamp','555')"]);

        var service = new PerushimNotesService(
            new FakePadDeliveryService { AssetPath = padDir, FetchResult = false },
            FileSystemReturning(dataDir), DeviceMock(), AppMock());

        var downloaded = await service.TryDownloadNotesAsync();

        downloaded.Should().BeFalse("a copied pack that fails validation cannot satisfy the request");
        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task GetDiagnosticsAsync_ReportsPadFilesAndLocalTimestamp()
    {
        var dataDir = Path.Join(_tempRoot, nameof(GetDiagnosticsAsync_ReportsPadFilesAndLocalTimestamp));
        var padDir = Path.Join(_tempRoot, "pad-diag");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(dataDir, (7, 1, 1, 0, "a"));
        await File.WriteAllTextAsync(Path.Join(padDir, NotesDbFileName), "pad", TestContext.Current.CancellationToken);
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.Android);
        device.SetupGet(d => d.VersionString).Returns("15");
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns("1.2.3");
        app.SetupGet(a => a.BuildString).Returns("123");

        var service = new PerushimNotesService(
            new FakePadDeliveryService { AssetPath = padDir },
            FileSystemReturning(dataDir), device.Object, app.Object);

        var diagnostics = await service.GetDiagnosticsAsync();

        diagnostics.Should().Contain("PAD file at root: True")
            .And.Contain("Local DB build_timestamp: 1700000000")
            .And.Contain("IsAvailable: True");
    }

    [Fact]
    public async Task GetDiagnosticsAsync_ReportsPadAndDeliveryErrors()
    {
        var dataDir = Path.Join(_tempRoot, nameof(GetDiagnosticsAsync_ReportsPadAndDeliveryErrors));
        Directory.CreateDirectory(dataDir);
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.Android);
        device.SetupGet(d => d.VersionString).Returns("15");
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns("1.2.3");
        app.SetupGet(a => a.BuildString).Returns("123");
        var service = new PerushimNotesService(
            new FakePadDeliveryService
            {
                AssetPathError = new InvalidOperationException("pad down"),
                DiagnosticsError = new InvalidOperationException("diag down"),
            },
            FileSystemReturning(dataDir), device.Object, app.Object);

        var diagnostics = await service.GetDiagnosticsAsync();

        diagnostics.Should().Contain("PAD/ODR path error")
            .And.Contain("Delivery diagnostics error")
            .And.Contain("IsAvailable: False");
    }

    [Fact]
    public async Task InitializeAsync_WhenDataDirectoryMissing_ToleratesSweepFailure()
    {
        // SweepStaleTempFiles runs Directory.GetFiles on a directory that does
        // not exist — the failure must not break initialization.
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WhenDataDirectoryMissing_ToleratesSweepFailure));
        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_WhenRejectedMarkerPathIsDirectory_ToleratesWriteFailure()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WhenRejectedMarkerPathIsDirectory_ToleratesWriteFailure));
        Directory.CreateDirectory(dataDir);
        // A directory squatting on the marker path makes the rejection
        // bookkeeping write fail — the rejection itself must still complete.
        Directory.CreateDirectory(Path.Join(dataDir, NotesDbFileName + ".rejected"));
        var legacy = new SQLiteAsyncConnection(Path.Join(dataDir, NotesDbFileName));
        await legacy.ExecuteAsync("CREATE TABLE _metadata (key TEXT, value TEXT)");
        await legacy.ExecuteAsync("CREATE TABLE note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)");
        await legacy.CloseAsync();

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse();
        File.Exists(Path.Join(dataDir, NotesDbFileName)).Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_WhenRejectedMarkerIsLocked_ProceedsWithCopy()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WhenRejectedMarkerIsLocked_ProceedsWithCopy));
        var padDir = Path.Join(_tempRoot, "pad-marker-locked");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(padDir, 777, (9, 4, 1, 0, "pad note"));
        var markerPath = Path.Join(dataDir, NotesDbFileName + ".rejected");
        await File.WriteAllTextAsync(markerPath, "555", TestContext.Current.CancellationToken);
        // An unreadable marker must not veto the copy — fail open.
        await using var locked = new FileStream(markerPath, FileMode.Open, FileAccess.Read, FileShare.None);

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir }, dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue("a locked marker file must not block a healthy pack");
    }

    [Fact]
    public async Task InitializeAsync_WhenDeliveredIndexCopyFails_KeepsNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_WhenDeliveredIndexCopyFails_KeepsNotes));
        var padDir = Path.Join(_tempRoot, "pad-index-fail");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(padDir);
        await CreateNotesDatabaseAsync(padDir, (9, 4, 1, 0, "pad note"));
        await File.WriteAllTextAsync(Path.Join(padDir, PerushimNotesService.SearchIndexDbName),
            "delivered index", TestContext.Current.CancellationToken);
        // A directory squatting on the index destination makes the copy fail —
        // the notes DB itself is still usable.
        Directory.CreateDirectory(Path.Join(dataDir, PerushimNotesService.SearchIndexDbName));

        var service = PerushimNotesService.CreateForTesting(
            new FakePadDeliveryService { AssetPath = padDir }, dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        var ids = await service.GetPerushIdsForPerekAsync(4);
        ids.Should().Equal(9);
    }

    [Fact]
    public async Task InitializeAsync_CopiesPackageIndexAlongsideBundledNotes()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_CopiesPackageIndexAlongsideBundledNotes));
        var packDir = Path.Join(_tempRoot, "packaged-with-index");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(packDir);
        await CreateNotesDatabaseAsync(packDir, (9, 4, 1, 0, "bundled note"));
        var notesBytes = await File.ReadAllBytesAsync(
            Path.Join(packDir, NotesDbFileName), TestContext.Current.CancellationToken);
        var indexBytes = new byte[] { 1, 2, 3 };
        var fileSystem = FileSystemReturning(dataDir,
            (NotesDbFileName, notesBytes), (PerushimNotesService.SearchIndexDbName, indexBytes));

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), fileSystem, DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
        (await File.ReadAllBytesAsync(
                Path.Join(dataDir, PerushimNotesService.SearchIndexDbName),
                TestContext.Current.CancellationToken))
            .Should().Equal(indexBytes);
    }

    [Fact]
    public async Task InitializeAsync_ToleratesPackageIndexCopyFailure()
    {
        var dataDir = Path.Join(_tempRoot, nameof(InitializeAsync_ToleratesPackageIndexCopyFailure));
        var packDir = Path.Join(_tempRoot, "packaged-index-fail");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(packDir);
        await CreateNotesDatabaseAsync(packDir, (9, 4, 1, 0, "bundled note"));
        var notesBytes = await File.ReadAllBytesAsync(
            Path.Join(packDir, NotesDbFileName), TestContext.Current.CancellationToken);
        var fileSystem = new Mock<IFileSystem>();
        fileSystem.SetupGet(f => f.AppDataDirectory).Returns(dataDir);
        fileSystem.Setup(f => f.OpenAppPackageFileAsync(It.IsAny<string>()))
            .Returns((string name) => name == NotesDbFileName
                ? Task.FromResult<Stream>(new MemoryStream(notesBytes))
                : name == PerushimNotesService.SearchIndexDbName
                    ? Task.FromException<Stream>(new IOException("index read failed"))
                    : Task.FromException<Stream>(new FileNotFoundException(name)));

        var service = new PerushimNotesService(
            new FakePadDeliveryService(), fileSystem.Object, DeviceMock(), AppMock());

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue("a failed index copy must not lose the notes DB");
        File.Exists(Path.Join(dataDir, PerushimNotesService.SearchIndexDbName)).Should().BeFalse();
    }

    [Fact]
    public async Task GetDiagnosticsAsync_ReportsPackagedNotesFile()
    {
        var dataDir = Path.Join(_tempRoot, nameof(GetDiagnosticsAsync_ReportsPackagedNotesFile));
        var packDir = Path.Join(_tempRoot, "packaged-diag");
        Directory.CreateDirectory(dataDir);
        Directory.CreateDirectory(packDir);
        await CreateNotesDatabaseAsync(packDir, (9, 4, 1, 0, "bundled note"));
        var notesBytes = await File.ReadAllBytesAsync(
            Path.Join(packDir, NotesDbFileName), TestContext.Current.CancellationToken);
        var service = new PerushimNotesService(
            new FakePadDeliveryService(),
            FileSystemReturning(dataDir, (NotesDbFileName, notesBytes)), DeviceMock(), AppMock());

        var diagnostics = await service.GetDiagnosticsAsync();

        diagnostics.Should().Contain("App package has notes file: True")
            .And.Contain("IsAvailable: True");
    }

    private const string CatalogDbFileName = "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite";

    private static IDeviceInfo DeviceMock()
    {
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.Android);
        device.SetupGet(d => d.VersionString).Returns("15");
        return device.Object;
    }

    private static IAppInfo AppMock()
    {
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns("1.2.3");
        app.SetupGet(a => a.BuildString).Returns("123");
        return app.Object;
    }

    /// <summary>
    /// An <see cref="IFileSystem"/> rooted at <paramref name="dataDirectory"/>;
    /// named package files materialize from byte arrays, everything else misses.
    /// </summary>
    private static IFileSystem FileSystemReturning(string dataDirectory,
        params (string Name, byte[] Bytes)[] packageFiles)
    {
        var fileSystem = new Mock<IFileSystem>();
        fileSystem.SetupGet(f => f.AppDataDirectory).Returns(dataDirectory);
        fileSystem.SetupGet(f => f.CacheDirectory).Returns(dataDirectory);
        fileSystem.Setup(f => f.OpenAppPackageFileAsync(It.IsAny<string>()))
            .Returns((string name) =>
            {
                var file = packageFiles.FirstOrDefault(f => f.Name == name);
                return file.Bytes != null
                    ? Task.FromResult<Stream>(new MemoryStream(file.Bytes))
                    : Task.FromException<Stream>(new FileNotFoundException(name));
            });
        return fileSystem.Object;
    }

    /// <summary>Builds a catalog fixture: `_metadata` + a `perush` table.</summary>
    private static async Task CreateCatalogDatabaseAsync(
        string dataDirectory,
        long buildTimestamp,
        params (int id, string name, int priority)[] perushim)
    {
        var path = Path.Join(dataDirectory, CatalogDbFileName);
        var conn = new SQLiteAsyncConnection(path);
        await conn.ExecuteAsync("CREATE TABLE _metadata (key TEXT PRIMARY KEY, value TEXT)");
        await conn.ExecuteAsync("INSERT INTO _metadata VALUES ('build_timestamp', ?)", buildTimestamp.ToString());
        await conn.ExecuteAsync("CREATE TABLE perush (id INTEGER PRIMARY KEY, name TEXT, priority INTEGER)");
        foreach (var (id, name, priority) in perushim)
        {
            await conn.ExecuteAsync("INSERT INTO perush VALUES (?, ?, ?)", id, name, priority);
        }
        await conn.CloseAsync();
    }

    private static async Task CreateNotesDatabaseAsync(
        string dataDirectory,
        params (int perushId, int perekId, int pasuk, int noteIdx, string? content)[] rows) =>
        await CreateNotesDatabaseAsync(dataDirectory, 1700000000, rows);

    private static async Task CreateNotesDatabaseAsync(
        string dataDirectory,
        long buildTimestamp,
        params (int perushId, int perekId, int pasuk, int noteIdx, string? content)[] rows) =>
        await CreateNotesDatabaseFromStatementsAsync(
            dataDirectory,
            [.. BibleOnSite.Tests.Support.NotesDbV2.Statements(rows),
                $"INSERT OR REPLACE INTO _metadata (key, value) VALUES ('build_timestamp', '{buildTimestamp}')"]);

    /// <summary>Executes raw DDL/DML against the notes DB path in <paramref name="dataDirectory"/>.</summary>
    private static async Task CreateNotesDatabaseFromStatementsAsync(
        string dataDirectory, params string[] statements)
    {
        var dbPath = Path.Join(dataDirectory, NotesDbFileName);
        var conn = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadWrite | SQLiteOpenFlags.Create);

        foreach (var statement in statements)
        {
            await conn.ExecuteAsync(statement);
        }

        await conn.CloseAsync();
    }

    private sealed class FakePadDeliveryService : IPadDeliveryService
    {
        public string? AssetPath { get; set; }

        public string? AssetPathAfterFetch { get; set; }

        public bool FetchResult { get; set; }

        public int FetchCalls { get; private set; }

        public IProgress<double>? LastProgress { get; private set; }

        public Exception? AssetPathError { get; set; }

        public Exception? DiagnosticsError { get; set; }

        public Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default) =>
            AssetPathError != null ? Task.FromException<string?>(AssetPathError) : Task.FromResult(AssetPath);

        public Task<bool> FetchAsync(string packName, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
        {
            FetchCalls++;
            LastProgress = progress;
            AssetPath = AssetPathAfterFetch ?? AssetPath;
            return Task.FromResult(FetchResult);
        }

        public Task<List<string>> GetDeliveryDiagnosticsAsync(string packName) =>
            DiagnosticsError != null
                ? Task.FromException<List<string>>(DiagnosticsError)
                : Task.FromResult(new List<string>());
    }
}
