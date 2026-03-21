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
        _tempRoot = Path.Combine(Path.GetTempPath(), "BibleOnSiteTests_" + Guid.NewGuid());
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
        var dataDir = Path.Combine(_tempRoot, nameof(InitializeAsync_WithExistingDb_SetsIsAvailableTrue));
        Directory.CreateDirectory(dataDir);
        await CreateNotesDatabaseAsync(dataDir);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeTrue();
    }

    [Fact]
    public async Task InitializeAsync_WithoutDb_AndNoPad_SetsNotesMissing()
    {
        var dataDir = Path.Combine(_tempRoot, nameof(InitializeAsync_WithoutDb_AndNoPad_SetsNotesMissing));
        Directory.CreateDirectory(dataDir);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);

        await service.InitializeAsync();

        service.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task InitializeAsync_CalledTwice_IsIdempotent()
    {
        var dataDir = Path.Combine(_tempRoot, nameof(InitializeAsync_CalledTwice_IsIdempotent));
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
        var dataDir = Path.Combine(_tempRoot, nameof(GetPerushIdsForPerekAsync_ReturnsDistinctIds));
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
        var dataDir = Path.Combine(_tempRoot, nameof(LoadNotesForPerekAsync_ReturnsNotes));
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
    public async Task LoadNotesForPerekAsync_WhenNotInitialized_ReturnsEmpty()
    {
        var dataDir = Path.Combine(_tempRoot, nameof(LoadNotesForPerekAsync_WhenNotInitialized_ReturnsEmpty));
        Directory.CreateDirectory(dataDir);

        var service = PerushimNotesService.CreateForTesting(new FakePadDeliveryService(), dataDir);
        var notes = await service.LoadNotesForPerekAsync(1, new Dictionary<int, Perush>());

        notes.Should().BeEmpty();
    }

    private static async Task CreateNotesDatabaseAsync(
        string dataDirectory,
        params (int perushId, int perekId, int pasuk, int noteIdx, string content)[] rows)
    {
        var dbPath = Path.Combine(dataDirectory, NotesDbFileName);
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
        public Task<string?> TryGetAssetPathAsync(string packName, CancellationToken cancellationToken = default) =>
            Task.FromResult<string?>(null);

        public Task<bool> FetchAsync(string packName, IProgress<double>? progress = null, CancellationToken cancellationToken = default) =>
            Task.FromResult(false);

        public Task<List<string>> GetDeliveryDiagnosticsAsync(string packName) =>
            Task.FromResult(new List<string>());
    }
}
