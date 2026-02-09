using BibleOnSite.Models;
using SQLite;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading perushim notes (commentary text per pasuk).
/// Notes are delivered via Play Asset Delivery (PAD) on Android or HTTP fallback — not bundled.
/// If the notes DB is not present, returns empty; download can be triggered separately.
/// </summary>
public class PerushimNotesService
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string PerushimNotesPackName = "perushim_notes";

    /// <summary>HTTP fallback URL when PAD is not available (sideloaded, emulator, or non-Android).</summary>
    private const string NotesDownloadUrl =
        "https://bible-on-site-assets.s3.il-central-1.amazonaws.com/perushim/sefaria-dump-5784-sivan-4.perushim_notes.sqlite";

    private readonly IPadDeliveryService _padService;

    private static readonly Lazy<PerushimNotesService> _instance =
        new(() => new PerushimNotesService(PadDeliveryService.Instance));

    public static PerushimNotesService Instance => _instance.Value;

    private SQLiteAsyncConnection? _connection;
    private bool _initialized;
    private bool _notesMissing = true;

    public PerushimNotesService(IPadDeliveryService padService)
    {
        _padService = padService;
    }

    /// <summary>Whether the notes database is available (from PAD or HTTP download).</summary>
    public bool IsAvailable => _initialized && !_notesMissing && _connection != null;

    /// <summary>
    /// Initializes the notes connection. Does not download — only opens if file exists.
    /// On Android, also copies from PAD if the pack is already available.
    /// </summary>
    public async Task InitializeAsync()
    {
        if (_initialized)
            return;

        var dbPath = Path.Combine(FileSystem.AppDataDirectory, NotesDbName);

        if (!File.Exists(dbPath))
        {
            var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
            if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath))
            {
                _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
                _notesMissing = false;
            }
            else
            {
                _notesMissing = true;
            }
        }
        else
        {
            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _notesMissing = false;
        }

        _initialized = true;
    }

    /// <summary>
    /// Attempts to download the notes database. On Android, tries PAD first, then HTTP fallback.
    /// Call when IsAvailable is false.
    /// </summary>
    public async Task<bool> TryDownloadNotesAsync(IProgress<double>? progress = null)
    {
        var dbPath = Path.Combine(FileSystem.AppDataDirectory, NotesDbName);
        if (File.Exists(dbPath))
        {
            await InitializeAsync();
            return true;
        }

        var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
        if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath))
        {
            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _notesMissing = false;
            _initialized = true;
            return true;
        }

        if (await _padService.FetchAsync(PerushimNotesPackName, progress))
        {
            padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
            if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath))
            {
                _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
                _notesMissing = false;
                _initialized = true;
                return true;
            }
        }

        return await TryDownloadFromHttpAsync(dbPath, progress);
    }

    private static async Task<bool> TryCopyFromPadAsync(string padAssetsPath, string dbPath)
    {
        var srcPath = Path.Combine(padAssetsPath, NotesDbName);
        if (!File.Exists(srcPath))
            return false;
        try
        {
            await Task.Run(() => File.Copy(srcPath, dbPath, overwrite: true));
            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to copy perushim notes from PAD: {ex.Message}");
            return false;
        }
    }

    private async Task<bool> TryDownloadFromHttpAsync(string dbPath, IProgress<double>? progress)
    {
        try
        {
            using var client = new HttpClient();
            client.Timeout = TimeSpan.FromMinutes(5);

            using var response = await client.GetAsync(NotesDownloadUrl, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();

            var totalBytes = response.Content.Headers.ContentLength ?? 0L;
            await using var stream = await response.Content.ReadAsStreamAsync();
            await using var fileStream = File.Create(dbPath);

            var buffer = new byte[81920];
            long totalRead = 0;
            int read;
            while ((read = await stream.ReadAsync(buffer)) > 0)
            {
                await fileStream.WriteAsync(buffer.AsMemory(0, read));
                totalRead += read;
                if (totalBytes > 0 && progress != null)
                {
                    progress.Report((double)totalRead / totalBytes);
                }
            }

            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _notesMissing = false;
            _initialized = true;
            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to download perushim notes from HTTP: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Gets distinct perush IDs that have notes for the given perek.
    /// </summary>
    public async Task<List<int>> GetPerushIdsForPerekAsync(int perekId)
    {
        await InitializeAsync();
        if (_connection == null)
            return new List<int>();

        var rows = await _connection.QueryAsync<IdRow>(
            "SELECT DISTINCT perush_id AS Id FROM note WHERE perek_id = ? ORDER BY perush_id",
            perekId);

        return rows.Select(r => r.Id).ToList();
    }

    /// <summary>
    /// Loads all notes for a perek. Returns empty if notes DB is not available.
    /// </summary>
    public async Task<List<PerekPerushNote>> LoadNotesForPerekAsync(int perekId, IReadOnlyDictionary<int, Perush> perushById)
    {
        await InitializeAsync();
        if (_connection == null)
            return new List<PerekPerushNote>();

        var rows = await _connection.QueryAsync<NoteRow>(
            "SELECT perush_id, perek_id, pasuk, note_idx, note_content FROM note " +
            "WHERE perek_id = ? ORDER BY pasuk ASC, perush_id ASC, note_idx ASC",
            perekId);

        return rows
            .Select(r =>
            {
                var name = perushById.GetValueOrDefault(r.PerushId)?.Name ?? $"Perush {r.PerushId}";
                return new PerekPerushNote
                {
                    PerushId = r.PerushId,
                    PerushName = name,
                    PerekId = r.PerekId,
                    Pasuk = r.Pasuk,
                    NoteIdx = r.NoteIdx,
                    NoteContent = r.NoteContent ?? string.Empty
                };
            })
            .ToList();
    }

    private class IdRow
    {
        [Column("Id")]
        public int Id { get; set; }
    }

    private class NoteRow
    {
        [Column("perush_id")]
        public int PerushId { get; set; }

        [Column("perek_id")]
        public int PerekId { get; set; }

        [Column("pasuk")]
        public int Pasuk { get; set; }

        [Column("note_idx")]
        public int NoteIdx { get; set; }

        [Column("note_content")]
        public string? NoteContent { get; set; }
    }
}
