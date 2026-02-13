using BibleOnSite.Models;
using SQLite;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading perushim notes (commentary text per pasuk).
/// Notes are delivered via Play Asset Delivery (PAD) as an on-demand asset pack bundled in the AAB.
/// Data updates are coupled to app releases — updating perushim data requires a new app version
/// and AAB upload to Google Play. On app update, the client compares build_timestamp in the
/// local DB vs the PAD version and auto-upgrades if the PAD copy is newer.
/// If the notes DB is not yet available, returns empty; PAD download can be triggered separately.
/// </summary>
public class PerushimNotesService
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string PerushimNotesPackName = "perushim_notes";

    private readonly IPadDeliveryService _padService;
    private readonly string? _dataDirectoryOverride;

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

    /// <summary>
    /// Factory for unit testing — allows injecting the data directory instead of using FileSystem.AppDataDirectory.
    /// </summary>
    public static PerushimNotesService CreateForTesting(IPadDeliveryService padService, string dataDirectory)
    {
        return new PerushimNotesService(padService, dataDirectory);
    }

    private PerushimNotesService(IPadDeliveryService padService, string dataDirectory)
    {
        _padService = padService;
        _dataDirectoryOverride = dataDirectory;
    }

    private string DataDirectory => _dataDirectoryOverride ?? FileSystem.AppDataDirectory;

    /// <summary>Whether the notes database is available (from PAD or HTTP download).</summary>
    public bool IsAvailable => _initialized && !_notesMissing && _connection != null;

    /// <summary>
    /// Initializes the notes connection. Does not download — only opens if file exists.
    /// On Android, also copies from PAD if the pack is already available or has a newer build.
    /// </summary>
    public async Task InitializeAsync()
    {
        if (_initialized)
            return;

        var dbPath = Path.Combine(FileSystem.AppDataDirectory, NotesDbName);

        if (!File.Exists(dbPath))
        {
            // No local DB → try to copy from PAD if already available
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
            // Local DB exists → check if PAD has a newer build (e.g. after app update)
            await TryUpgradeFromPadAsync(dbPath);
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

        Console.Error.WriteLine("Perushim notes not available via PAD. Publish an AAB with the perushim_notes asset pack.");
        return false;
    }

    /// <summary>
    /// Compares build_timestamp in local DB vs PAD DB; overwrites local if PAD is newer.
    /// </summary>
    private async Task TryUpgradeFromPadAsync(string localDbPath)
    {
        try
        {
            var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
            if (padPath == null) return;

            var padDbPath = Path.Combine(padPath, NotesDbName);
            if (!File.Exists(padDbPath)) return;

            var localTs = await GetBuildTimestampAsync(localDbPath);
            var padTs = await GetBuildTimestampAsync(padDbPath);

            if (padTs > localTs)
            {
                // Close any existing connection before overwriting
                if (_connection != null)
                {
                    await _connection.CloseAsync();
                    _connection = null;
                }
                await Task.Run(() => File.Copy(padDbPath, localDbPath, overwrite: true));
                Console.WriteLine($"Perushim notes upgraded from PAD (local={localTs}, pad={padTs})");
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to check/upgrade perushim notes from PAD: {ex.Message}");
        }
    }

    /// <summary>
    /// Reads the build_timestamp (Unix epoch seconds) from a perushim notes SQLite _metadata table.
    /// Returns 0 if unavailable or on error.
    /// </summary>
    private static async Task<long> GetBuildTimestampAsync(string dbPath)
    {
        if (!File.Exists(dbPath)) return 0;
        SQLiteAsyncConnection? conn = null;
        try
        {
            conn = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            var rows = await conn.QueryAsync<MetadataRow>(
                "SELECT value AS Value FROM _metadata WHERE key = 'build_timestamp'");
            if (rows.Count > 0 && long.TryParse(rows[0].Value, out var ts))
                return ts;
        }
        catch { /* DB may not have _metadata table (legacy) */ }
        finally
        {
            if (conn != null) await conn.CloseAsync();
        }
        return 0;
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

    private class MetadataRow
    {
        [Column("Value")]
        public string? Value { get; set; }
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
