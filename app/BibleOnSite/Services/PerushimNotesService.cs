using BibleOnSite.Models;
using SQLite;
using BibleOnSite.Helpers;
using System.Text.Json;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading perushim notes (commentary text per pasuk).
/// Android: delivered via Play Asset Delivery (PAD) as an on-demand asset pack in the AAB.
/// iOS: delivered via Apple On-Demand Resources (ODR) tagged in an asset catalog.
/// Data updates are coupled to app releases — updating perushim data requires a new app version.
/// On app update the client compares build_timestamp in the local DB vs the store-delivered
/// version and auto-upgrades if the store copy is newer.
/// If the notes DB is not yet available, returns empty; download can be triggered separately.
/// </summary>
public class PerushimNotesService
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string PerushimNotesPackName = "perushim_notes";

    private readonly IPadDeliveryService _padService;
    private readonly string? _dataDirectoryOverride;
    private readonly IFileSystem _fileSystem;
    private readonly IDeviceInfo _deviceInfo;
    private readonly IAppInfo _appInfo;
    private readonly PerushimCatalogService? _catalog;

    private static readonly Lazy<PerushimNotesService> _instance =
        new(() => new PerushimNotesService(PadDeliveryService.Instance));

    public static PerushimNotesService Instance => _instance.Value;

    private SQLiteAsyncConnection? _connection;
    private bool _initialized;
    private bool _notesMissing = true;
    private readonly SemaphoreSlim _operationLock = new(1, 1);

    public PerushimNotesService(IPadDeliveryService padService)
        : this(padService, null, null, null)
    {
    }

    public PerushimNotesService(IPadDeliveryService padService, IFileSystem fileSystem)
        : this(padService, fileSystem, null, null)
    {
    }

    public PerushimNotesService(IPadDeliveryService padService, IFileSystem? fileSystem,
        IDeviceInfo? deviceInfo, IAppInfo? appInfo)
    {
        _padService = padService;
        _fileSystem = fileSystem ?? FileSystem.Current;
        _deviceInfo = deviceInfo ?? DeviceInfo.Current;
        _appInfo = appInfo ?? AppInfo.Current;
        _catalog = new PerushimCatalogService(_fileSystem);
    }

    /// <summary>
    /// Factory for unit testing — allows injecting the data directory instead of using FileSystem.AppDataDirectory.
    /// </summary>
    public static PerushimNotesService CreateForTesting(IPadDeliveryService padService, string dataDirectory)
    {
        return new PerushimNotesService(padService, dataDirectory);
    }

    private PerushimNotesService(IPadDeliveryService padService, string dataDirectory) : this(padService)
    {
        _dataDirectoryOverride = dataDirectory;
        // This factory isolates raw-note tests from the platform's package storage.
        _catalog = null;
    }

    private string DataDirectory => _dataDirectoryOverride ?? _fileSystem.AppDataDirectory;

    /// <summary>Whether compatible notes are available from PAD/ODR or a bundled asset.</summary>
    public bool IsAvailable => _initialized && !_notesMissing && _connection != null;

    /// <summary>
    /// Builds a diagnostic report for support (platform, state, PAD/ODR path, app package).
    /// Call when Perushim don't show so the user can export and share the file.
    /// </summary>
    public async Task<string> GetDiagnosticsAsync()
    {
        await InitializeAsync();
        var dbPath = Path.Combine(DataDirectory, NotesDbName);
        var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
        var appPackageHasFile = await AppPackageHasNotesAsync();

        var lines = new List<string>
        {
            "=== Perushim notes diagnostics ===",
            $"Time: {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss}Z",
            $"Platform: {_deviceInfo.Platform} ({_deviceInfo.VersionString})",
            $"App: {_appInfo.VersionString} build {_appInfo.BuildString}",
            "",
            $"IsAvailable: {IsAvailable}",
            $"Initialized: {_initialized}",
            $"NotesMissing: {_notesMissing}",
            $"Local DB path: {dbPath}",
            $"Local DB exists: {File.Exists(dbPath)}",
            $"PAD/ODR path: {(padPath ?? "(null)")}",
            $"App package has notes file: {appPackageHasFile}",
        };
        if (padPath != null)
        {
            var atRoot = File.Exists(Path.Combine(padPath, NotesDbName));
            var atAssets = File.Exists(Path.Combine(padPath, "assets", NotesDbName));
            lines.Add($"  PAD file at root: {atRoot}");
            lines.Add($"  PAD file in assets/: {atAssets}");
        }
        if (File.Exists(dbPath))
        {
            try
            {
                var ts = await GetBuildTimestampAsync(dbPath);
                lines.Add($"Local DB build_timestamp: {ts}");
            }
            catch (Exception ex)
            {
                lines.Add($"Local DB build_timestamp error: {ex.Message}");
            }
        }

        // Platform-specific delivery diagnostics (ODR on iOS, PAD on Android)
        try
        {
            var deliveryDiag = await _padService.GetDeliveryDiagnosticsAsync(PerushimNotesPackName);
            lines.AddRange(deliveryDiag);
        }
        catch (Exception ex)
        {
            lines.Add($"Delivery diagnostics error: {ex.GetType().Name}: {ex.Message}");
        }

        return string.Join(Environment.NewLine, lines);
    }

    private async Task<bool> AppPackageHasNotesAsync()
    {
        try
        {
            await using var s = await _fileSystem.OpenAppPackageFileAsync(NotesDbName);
            return s != null;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Initializes the notes connection. Does not download — only opens if file exists.
    /// Also copies from the on-demand delivery cache (PAD on Android, ODR on iOS) if
    /// the pack is already available or has a newer build.
    /// </summary>
    public async Task InitializeAsync()
    {
        await _operationLock.WaitAsync();
        try { await InitializeCoreAsync(); }
        finally { _operationLock.Release(); }
    }

    private async Task InitializeCoreAsync()
    {
        if (_initialized)
            return;

        var dbPath = Path.Combine(DataDirectory, NotesDbName);

        if (!File.Exists(dbPath))
        {
            // No local DB → try PAD/ODR first, then fallback to app package (e.g. Android Debug APK)
            var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
            if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath))
            {
                _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
                _notesMissing = false;
            }
            else if (await TryCopyFromAppPackageAsync(dbPath))
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

        await ValidateLocalNotesAsync();
        _initialized = true;
    }

    /// <summary>
    /// Attempts to download the notes database via the platform's on-demand delivery
    /// mechanism (PAD on Android, ODR on iOS). Call when IsAvailable is false.
    /// </summary>
    public async Task<bool> TryDownloadNotesAsync(IProgress<double>? progress = null)
    {
        await _operationLock.WaitAsync();
        try { return await TryDownloadNotesCoreAsync(progress); }
        finally { _operationLock.Release(); }
    }

    private async Task<bool> TryDownloadNotesCoreAsync(IProgress<double>? progress)
    {
        var dbPath = Path.Combine(DataDirectory, NotesDbName);
        if (File.Exists(dbPath))
        {
            await InitializeCoreAsync();
            if (IsAvailable)
                return true;
        }

        // Try PAD/ODR path if already available
        var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
        if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath))
        {
            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _notesMissing = false;
            _initialized = true;
            if (await ValidateLocalNotesAsync())
                return true;
        }

        // Try on-demand fetch (downloads from store)
        if (await _padService.FetchAsync(PerushimNotesPackName, progress))
        {
            padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName);
            if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath))
            {
                _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
                _notesMissing = false;
                _initialized = true;
                if (await ValidateLocalNotesAsync())
                    return true;
            }
        }

        // Last resort: try bundled app package (e.g. Android Debug APK)
        if (await TryCopyFromAppPackageAsync(dbPath))
        {
            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _notesMissing = false;
            _initialized = true;
            if (await ValidateLocalNotesAsync())
                return true;
        }

        Console.Error.WriteLine("Perushim notes not available via on-demand delivery. Ensure the perushim_notes asset pack (Android) or ODR tag (iOS) is included in the build.");
        return false;
    }

    /// <summary>
    /// A catalog and notes pack are delivered independently. Never join their IDs
    /// unless the pack records the same complete ID-to-name mapping. Legacy packs
    /// can only be trusted when generated together with this catalog.
    /// </summary>
    private async Task<bool> ValidateLocalNotesAsync()
    {
        if (_connection == null)
            return false;
        if (_catalog == null)
            return true;
        try
        {
            var catalogConnection = await _catalog.GetConnectionAsync();
            // Without a catalog the UI cannot display commentaries. Raw note access
            // remains useful for diagnostics, but there are no names to misattribute.
            if (catalogConnection == null)
                return true;

            string? snapshot = null;
            try
            {
                snapshot = await _connection.ExecuteScalarAsync<string>(
                    "SELECT value FROM _metadata WHERE key = 'perush_catalog'");
            }
            catch (SQLiteException) { /* Legacy notes may have no metadata. */ }

            bool compatible;
            if (snapshot != null)
            {
                var expected = JsonSerializer.Deserialize<Dictionary<int, string>>(snapshot);
                var current = await _catalog.GetAllPerushimAsync();
                compatible = expected != null && expected.Count == current.Count &&
                    current.All(p => expected.TryGetValue(p.Id, out var name) && name == p.Name);
            }
            else
            {
                var notesTimestamp = await GetBuildTimestampAsync(Path.Combine(DataDirectory, NotesDbName));
                var catalogTimestamp = await GetBuildTimestampAsync(Path.Combine(_fileSystem.AppDataDirectory,
                    "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite"));
                compatible = notesTimestamp > 0 && notesTimestamp == catalogTimestamp;
            }
            if (compatible)
                return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Could not verify perushim attribution: {ex.Message}");
        }

        await _connection.CloseAsync();
        _connection = null;
        _notesMissing = true;
        Console.Error.WriteLine("Perushim notes do not match the installed catalog; download a matching pack.");
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
            if (!File.Exists(padDbPath))
                padDbPath = Path.Combine(padPath, "assets", NotesDbName);
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
                await using var source = File.OpenRead(padDbPath);
                await AtomicFile.CopyAsync(source, localDbPath);
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
        // PAD may expose pack root or an "assets" subfolder depending on SDK/version
        var srcPath = Path.Combine(padAssetsPath, NotesDbName);
        if (!File.Exists(srcPath))
            srcPath = Path.Combine(padAssetsPath, "assets", NotesDbName);
        if (!File.Exists(srcPath))
            return false;
        try
        {
            await using var source = File.OpenRead(srcPath);
            await AtomicFile.CopyAsync(source, dbPath);
            return true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to copy perushim notes from PAD: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Copies the notes DB from the app package when bundled (e.g. Android Debug MauiAsset fallback).
    /// </summary>
    private async Task<bool> TryCopyFromAppPackageAsync(string dbPath)
    {
        try
        {
            await using var source = await _fileSystem.OpenAppPackageFileAsync(NotesDbName);
            await AtomicFile.CopyAsync(source, dbPath);
            return true;
        }
        catch (FileNotFoundException)
        {
            return false;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Perushim notes copy from app package failed: {ex.Message}");
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
