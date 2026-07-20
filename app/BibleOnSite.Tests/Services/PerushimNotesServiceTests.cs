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

    static PerushimNotesServiceTests()
    {
        SQLitePCL.Batteries_V2.Init();
    }

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

    private static async Task CreateNotesDatabaseAsync(
        string dataDirectory,
        params (int perushId, int perekId, int pasuk, int noteIdx, string? content)[] rows)
    {
        var dbPath = Path.Join(dataDirectory, NotesDbFileName);
        var conn = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadWrite | SQLiteOpenFlags.Create);

        await conn.ExecuteAsync("CREATE TABLE IF NOT EXISTS _metadata (key TEXT, value TEXT)");
        await conn.ExecuteAsync("DELETE FROM _metadata");
        await conn.ExecuteAsync("INSERT INTO _metadata (key, value) VALUES ('build_timestamp', '1700000000')");

        await conn.ExecuteAsync(
            "CREATE TABLE IF NOT EXISTS note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)");
        await conn.ExecuteAsync("DELETE FROM note");

        foreach (var (perushId, perekId, pasuk, noteIdx, content) in rows)
        {
            await conn.ExecuteAsync(
                "INSERT INTO note (perush_id, perek_id, pasuk, note_idx, note_content) VALUES (?, ?, ?, ?, ?)",
                perushId, perekId, pasuk, noteIdx, content);
        }

        await conn.CloseAsync();
    }

    private sealed class FakePadDeliveryService : IPadDeliveryService
    {
        public string? AssetPath { get; set; }

        public string? AssetPathAfterFetch { get; set; }

        public bool FetchResult { get; set; }

        public int FetchCalls { get; private set; }

        public Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default) =>
            Task.FromResult(AssetPath);

        public Task<bool> FetchAsync(string packName, IProgress<double>? progress = null, CancellationToken cancellationToken = default)
        {
            FetchCalls++;
            AssetPath = AssetPathAfterFetch ?? AssetPath;
            return Task.FromResult(FetchResult);
        }

        public Task<List<string>> GetDeliveryDiagnosticsAsync(string packName) =>
            Task.FromResult(new List<string>());
    }
}
