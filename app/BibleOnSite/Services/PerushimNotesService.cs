using BibleOnSite.Models;
using SQLite;
using BibleOnSite.Helpers;
using System.Text.Json;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading perushim notes (commentary text per pasuk).
/// Android: delivered via Play Asset Delivery (PAD) as an on-demand asset pack in the AAB.
/// iOS: delivered via Apple Background Assets as a managed on-demand asset pack.
/// Data updates are coupled to app releases — updating perushim data requires a new app version.
/// On app update the client compares build_timestamp in the local DB vs the store-delivered
/// version and auto-upgrades if the store copy is newer.
/// If the notes DB is not yet available, returns empty; download can be triggered separately.
/// </summary>
public class PerushimNotesService
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
#if IOS || MACCATALYST
    // App Store Connect accepts only alphanumerics and hyphens in asset-pack IDs.
    private const string PerushimNotesPackName = "perushim-notes";
#else
    private const string PerushimNotesPackName = "perushim_notes";
#endif
    private const string RemovedMarkerName = NotesDbName + ".removed";

    /// <summary>
    /// Ready-to-query FTS5 search index generated with the notes content — the
    /// second payload file of the notes asset pack. It is staged here before
    /// <see cref="SearchIndexService"/> adopts it into its cache.
    /// </summary>
    internal const string SearchIndexDbName = "sefaria-dump-5784-sivan-4.hebrew_search.sqlite";

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
    private string _notesValidationStatus = "Notes database unavailable";
    private readonly SemaphoreSlim _operationLock = new(1, 1);

    /// <summary>
    /// Raised after initialization, a download or a removal releases the pack,
    /// so work deferred while notes were undetermined can settle.
    /// </summary>
    internal event Action? OperationCompleted
    {
        add { lock (_operationCompletedSync) { _operationCompleted += value; } }
        remove { lock (_operationCompletedSync) { _operationCompleted -= value; } }
    }

    private readonly object _operationCompletedSync = new();
    private Action? _operationCompleted;

    private void ReleaseOperation()
    {
        _operationLock.Release();
        Action? handlers;
        lock (_operationCompletedSync) { handlers = _operationCompleted; }
        handlers?.Invoke();
    }

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
        _catalog = new PerushimCatalogService(_fileSystem, _appInfo);
    }

    /// <summary>
    /// Factory for unit testing — allows injecting the data directory instead of using FileSystem.AppDataDirectory.
    /// </summary>
    public static PerushimNotesService CreateForTesting(IPadDeliveryService padService, string dataDirectory)
    {
        return new PerushimNotesService(padService, dataDirectory);
    }

    /// <summary>
    /// Test-only cleanup: releases the pooled SQLite handle so temp files can be
    /// removed on Windows, where open handles block directory deletion.
    /// </summary>
    internal async Task CloseConnectionForTestingAsync()
    {
        await _operationLock.WaitAsync();
        try
        {
            if (_connection != null)
            {
                await _connection.CloseAsync();
                _connection = null;
                _initialized = false;
                _notesMissing = true;
            }
        }
        finally { _operationLock.Release(); }
    }

    private PerushimNotesService(IPadDeliveryService padService, string dataDirectory) : this(padService)
    {
        _dataDirectoryOverride = dataDirectory;
        // This factory isolates raw-note tests from the platform's package storage.
        _catalog = null;
    }

    private string DataDirectory => _dataDirectoryOverride ?? _fileSystem.AppDataDirectory;

    /// <summary>
    /// Tombstone recording a deliberate user removal. Neither delivery platform offers
    /// a per-pack uninstall, so while the store copy stays delivered init would
    /// silently re-copy the DB — this marker makes the removal persist until an
    /// explicit install clears it.
    /// </summary>
    private string RemovedMarkerPath => Path.Join(DataDirectory, RemovedMarkerName);

    /// <summary>True after the user deliberately removed the notes pack (until reinstalled).</summary>
    public bool IsRemovedByUser => File.Exists(RemovedMarkerPath);

    /// <summary>Whether compatible notes are available from store delivery or a bundled asset.</summary>
    public bool IsAvailable => _initialized && !_notesMissing && _connection != null;

    /// <summary>Whether <see cref="InitializeAsync"/> already settled once (successfully or not).</summary>
    public bool IsInitialized => _initialized;

    /// <summary>
    /// Whether the local notes DB file is on disk. When it is absent and the
    /// service is uninitialized, <see cref="InitializeAsync"/> will first
    /// materialize the delivered pack — a copy of hundreds of MB inside the
    /// operation lock — so UI-critical callers should kick it instead of
    /// awaiting it.
    /// </summary>
    internal bool HasLocalNotesFile => File.Exists(Path.Join(DataDirectory, NotesDbName));

    /// <summary>
    /// Starts initialization without awaiting it; a faulted init logs here
    /// instead of surfacing as an unobserved task exception. Callers that
    /// cannot block on first-launch pack materialization use this and rely on
    /// <see cref="OperationCompleted"/> to re-check availability.
    /// </summary>
    public void BeginInitialize()
    {
        // Task.Run keeps the file probes and pack-copy prefix off the
        // caller's thread — BeginInitialize exists for UI-critical callers.
        _ = Task.Run(InitializeAsync).ContinueWith(
            task => Console.WriteLine($"Perushim notes init failed: {task.Exception}"),
            TaskContinuationOptions.OnlyOnFaulted);
    }

    internal async Task<SQLiteAsyncConnection?> GetSearchConnectionAsync()
    {
        await InitializeAsync();
        return IsAvailable ? _connection : null;
    }

    /// <summary>
    /// Builds a diagnostic report for support (platform, state, delivery path, app package).
    /// Call when Perushim don't show so the user can export and share the file.
    /// </summary>
    public async Task<string> GetDiagnosticsAsync()
    {
        var diagnosticErrors = new List<string>();
        try { await InitializeAsync(); }
        catch (Exception ex)
        {
            diagnosticErrors.Add($"Initialization error: {ex.GetType().Name}: {ex.Message}");
        }
        var dbPath = Path.Join(DataDirectory, NotesDbName);
        string? padPath = null;
        try { padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName, CancellationToken.None); }
        catch (Exception ex)
        {
            diagnosticErrors.Add($"Delivery path error: {ex.GetType().Name}: {ex.Message}");
        }
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
            $"RemovedByUser: {IsRemovedByUser}",
            $"Notes validation: {_notesValidationStatus}",
            $"JSON reflection enabled by default: {JsonSerializer.IsReflectionEnabledByDefault}",
            $"Local DB path: {dbPath}",
            $"Local DB exists: {File.Exists(dbPath)}",
            $"Delivered search index exists: {File.Exists(Path.Join(DataDirectory, SearchIndexDbName))}",
            $"Delivery path: {(padPath ?? "(null)")}",
            $"App package has notes file: {appPackageHasFile}",
        };
        lines.AddRange(diagnosticErrors);
        if (padPath != null)
        {
            var atRoot = File.Exists(Path.Join(padPath, NotesDbName));
            var atAssets = File.Exists(Path.Join(padPath, "assets", NotesDbName));
            lines.Add($"  PAD file at root: {atRoot}");
            lines.Add($"  PAD file in assets/: {atAssets}");
        }
        var localTs = await GetBuildTimestampAsync(dbPath);
        lines.Add($"Local DB build_timestamp: {localTs}");

        // Platform-specific delivery diagnostics (Background Assets on iOS, PAD on Android)
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
        var hasNotes = false;
        try
        {
            await using var s = await _fileSystem.OpenAppPackageFileAsync(NotesDbName);
            hasNotes = s != null;
        }
        catch
        {
            return false;
        }
        return hasNotes;
    }

    /// <summary>
    /// Initializes the notes connection. Does not download — only opens if file exists.
    /// Also copies from the on-demand delivery cache (PAD on Android, Background Assets on iOS) if
    /// the pack is already available or has a newer build.
    /// </summary>
    public async Task InitializeAsync()
    {
        await _operationLock.WaitAsync();
        try { await InitializeCoreAsync(); }
        finally { ReleaseOperation(); }
    }

    private async Task InitializeCoreAsync()
    {
        if (_initialized)
        {
            return;
        }

        SweepStaleTempFiles();
        var dbPath = Path.Join(DataDirectory, NotesDbName);

        // A deliberate removal is never undone by initialization, a metadata
        // refresh, or a still-delivered store pack. Only an explicit install
        // (TryDownloadNotesAsync) lifts the tombstone. This branch runs only
        // while !_initialized, and _connection is never set before _initialized.
        if (File.Exists(RemovedMarkerPath))
        {
            File.Delete(dbPath);
            _notesMissing = true;
            _notesValidationStatus = "Removed by user";
            _initialized = true;
            return;
        }

        if (!File.Exists(dbPath))
        {
            // No local DB → try the delivered pack first, then fallback to app package (e.g. Android Debug APK)
            var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName, CancellationToken.None);
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
    /// mechanism (PAD on Android, Background Assets on iOS). Call when IsAvailable is false.
    /// </summary>
    public Task<bool> TryDownloadNotesAsync() => TryDownloadNotesAsync(null, CancellationToken.None);

    public Task<bool> TryDownloadNotesAsync(IProgress<double>? progress) =>
        TryDownloadNotesAsync(progress, CancellationToken.None);

    public Task<bool> TryDownloadNotesAsync(CancellationToken cancellationToken) =>
        TryDownloadNotesAsync(null, cancellationToken);

    public async Task<bool> TryDownloadNotesAsync(IProgress<double>? progress, CancellationToken cancellationToken)
    {
        await _operationLock.WaitAsync(cancellationToken);
        try { return await TryDownloadNotesCoreAsync(progress, cancellationToken); }
        finally { ReleaseOperation(); }
    }

    /// <summary>
    /// Removes the app-owned notes copy so the pack reads as not installed.
    /// The store-managed pack itself cannot be uninstalled (PAD/ODR expose no
    /// removal), so a tombstone records the intent and init will not resurrect it.
    /// </summary>
    public async Task RemoveNotesAsync()
    {
        await _operationLock.WaitAsync();
        try
        {
            // The tombstone is written before the delete so even a mid-removal
            // crash cannot leave the pack half-restored without a record.
            Directory.CreateDirectory(DataDirectory);
            await File.WriteAllTextAsync(RemovedMarkerPath, DateTime.UtcNow.ToString("O"));
            if (_connection != null)
            {
                await _connection.CloseAsync();
                _connection = null;
            }
            File.Delete(Path.Join(DataDirectory, NotesDbName));
            _notesMissing = true;
            _notesValidationStatus = "Removed by user";
            _initialized = true;
        }
        finally { ReleaseOperation(); }
    }

    private async Task<bool> TryDownloadNotesCoreAsync(IProgress<double>? progress, CancellationToken cancellationToken)
    {
        var dbPath = Path.Join(DataDirectory, NotesDbName);
        if (File.Exists(dbPath))
        {
            await InitializeCoreAsync();
            if (IsAvailable)
            {
                File.Delete(RemovedMarkerPath);
                return true;
            }
        }

        // Try the delivered pack path if already available. An explicit download retries a
        // rejected generation on purpose — the marker only gates automatic copies.
        var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName, CancellationToken.None);
        if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath, respectRejectionMarker: false))
        {
            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _notesMissing = false;
            _initialized = true;
            if (await ValidateLocalNotesAsync())
            {
                // A successful explicit install is the only action that lifts a removal.
                File.Delete(RemovedMarkerPath);
                return true;
            }
        }

        // Try on-demand fetch (downloads from store)
        if (await _padService.FetchAsync(PerushimNotesPackName, progress, cancellationToken))
        {
            padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName, CancellationToken.None);
            if (padPath != null && await TryCopyFromPadAsync(padPath, dbPath, respectRejectionMarker: false))
            {
                _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
                _notesMissing = false;
                _initialized = true;
                if (await ValidateLocalNotesAsync())
                {
                    File.Delete(RemovedMarkerPath);
                    return true;
                }
            }
        }

        // Last resort: try bundled app package (e.g. Android Debug APK)
        if (await TryCopyFromAppPackageAsync(dbPath))
        {
            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _notesMissing = false;
            _initialized = true;
            if (await ValidateLocalNotesAsync())
            {
                File.Delete(RemovedMarkerPath);
                return true;
            }
        }

        Console.Error.WriteLine($"Perushim notes not available via on-demand delivery. Ensure the {PerushimNotesPackName} on-demand pack (Android PAD / iOS asset pack) is included in the build.");
        return false;
    }

    /// <summary>
    /// A catalog and notes pack are delivered independently. Never join their IDs
    /// unless the pack records the same complete ID-to-name mapping. Legacy packs
    /// can only be trusted when generated together with this catalog.
    /// </summary>
    private async Task<bool> ValidateLocalNotesAsync()
    {
        var valid = await ValidateLocalNotesCoreAsync();
        if (valid)
        {
            // A pack that passed is a different generation than any rejected one.
            TryDelete(Path.Join(DataDirectory, NotesDbName + ".rejected"));
        }
        return valid;
    }

    private async Task<bool> ValidateLocalNotesCoreAsync()
    {
        if (_connection == null)
        {
            return false;
        }

        // Schema v2 stores notes as compressed per-perek blobs; a legacy or
        // future layout cannot be queried and must be replaced by download.
        var schemaVersion = await ReadSchemaVersionAsync();
        if (schemaVersion != PerushNoteBlob.SchemaVersion)
        {
            _notesValidationStatus = schemaVersion == null
                ? "Legacy notes schema (no schema_version); a v2 pack is required"
                : $"Unsupported notes schema version {schemaVersion} (requires {PerushNoteBlob.SchemaVersion})";
            await RejectNotesAsync(generationDefect: true);
            Console.Error.WriteLine("Perushim notes have an unsupported schema; download a matching pack.");
            return false;
        }

        if (_catalog == null)
        {
            _notesValidationStatus = "Catalog validation skipped for raw-note tests";
            return true;
        }
        try
        {
            var catalogConnection = await _catalog.GetConnectionAsync();
            // Without a catalog the UI cannot display commentaries. Raw note access
            // remains useful for diagnostics, but there are no names to misattribute.
            if (catalogConnection == null)
            {
                _notesValidationStatus = "Catalog unavailable; attribution cannot be checked";
                return true;
            }

            var snapshot = await _connection.ExecuteScalarAsync<string>(
                "SELECT value FROM _metadata WHERE key = 'perush_catalog'");

            bool compatible;
            if (snapshot != null)
            {
                var expected = JsonSerializer.Deserialize(snapshot, AppJsonContext.Default.PerushCatalog);
                var current = await _catalog.GetAllPerushimAsync();
                compatible = expected != null && expected.Count == current.Count &&
                    current.All(p => expected.TryGetValue(p.Id, out var name) && name == p.Name);
                _notesValidationStatus = compatible
                    ? $"Compatible catalog mapping ({current.Count} entries)"
                    : $"Catalog mapping mismatch (notes={expected?.Count ?? 0}, catalog={current.Count})";
            }
            else
            {
                var notesTimestamp = await GetBuildTimestampAsync(Path.Join(DataDirectory, NotesDbName));
                var catalogTimestamp = await GetBuildTimestampAsync(Path.Join(_fileSystem.AppDataDirectory,
                    "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite"));
                compatible = notesTimestamp > 0 && notesTimestamp == catalogTimestamp;
                _notesValidationStatus = compatible
                    ? $"Compatible legacy build ({notesTimestamp})"
                    : $"Legacy build mismatch (notes={notesTimestamp}, catalog={catalogTimestamp}); matching notes pack required";
            }
            if (compatible)
            {
                return true;
            }
        }
        catch (Exception ex)
        {
            _notesValidationStatus = $"Validation error: {ex.GetType().Name}: {ex.Message}";
            Console.Error.WriteLine($"Could not verify perushim attribution: {ex.Message}");
            // A mid-validation error can come from a locally corrupted file —
            // a healthy equal-build pack must stay allowed to replace it.
            await RejectNotesAsync(generationDefect: false);
            return false;
        }

        await RejectNotesAsync(generationDefect: true);
        Console.Error.WriteLine("Perushim notes do not match the installed catalog; download a matching pack.");
        return false;
    }

    /// <param name="generationDefect">
    /// True when the rejection proves the pack generation itself is unusable
    /// (unsupported schema, catalog mismatch) — then a marker blocks the same
    /// generation from being re-copied every launch. False for ambiguous
    /// failures (e.g. a locally corrupted file), where a healthy equal-build
    /// pack must stay allowed to replace it.
    /// </param>
    private async Task RejectNotesAsync(bool generationDefect)
    {
        if (_connection != null)
        {
            await _connection.CloseAsync();
            _connection = null;
        }
        _notesMissing = true;
        // Never leave an unusable generation on the device: the ~285 MB legacy
        // DB, its paired search index, journal sidecars, and interrupted
        // replacement leftovers are all app-owned and must go.
        var dbPath = Path.Join(DataDirectory, NotesDbName);
        // Remember the rejected generation so a same-generation pack is not
        // re-copied on every launch only to fail validation again.
        var rejectedTimestamp = await GetBuildTimestampAsync(dbPath);
        TryDelete(dbPath);
        TryDelete(dbPath + "-wal");
        TryDelete(dbPath + "-shm");
        var indexPath = Path.Join(DataDirectory, SearchIndexDbName);
        TryDelete(indexPath);
        TryDelete(indexPath + "-wal");
        TryDelete(indexPath + "-shm");
        if (!generationDefect)
        {
            return;
        }
        try
        {
            await File.WriteAllTextAsync(dbPath + ".rejected", rejectedTimestamp.ToString());
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to record rejected notes generation: {ex.Message}");
        }
    }

    /// <summary>
    /// The generation marker left by <see cref="RejectNotesAsync"/>: when the
    /// pack still carries the same build_timestamp that already failed
    /// validation, copying it again would loop copy→reject→delete on every
    /// launch. A different pack timestamp clears the marker by proceeding.
    /// </summary>
    private async Task<bool> IsRejectedGenerationAsync(string dbPath)
    {
        try
        {
            var marker = Path.Join(DataDirectory, NotesDbName + ".rejected");
            if (!File.Exists(marker))
            {
                return false;
            }
            var rejected = (await File.ReadAllTextAsync(marker)).Trim();
            var candidate = await GetBuildTimestampAsync(dbPath);
            return candidate > 0 && candidate.ToString() == rejected;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to check rejected notes generation: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Deletes leftovers of interrupted atomic replacements. Any
    /// "name.{guid}.tmp" file here is a stale artifact — live copies are only
    /// observable mid-flight to a concurrent caller, which the operation lock
    /// already serializes away.
    /// </summary>
    private void SweepStaleTempFiles()
    {
        try
        {
            foreach (var name in new[] { NotesDbName, SearchIndexDbName })
            {
                foreach (var file in Directory.GetFiles(DataDirectory, name + ".*.tmp"))
                {
                    TryDelete(file);
                }
            }
            // Staged app-package copy that never became the local DB.
            TryDelete(Path.Join(DataDirectory, NotesDbName + ".pkgcheck"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to sweep stale perushim temp files: {ex.Message}");
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to delete obsolete perushim file '{path}': {ex.Message}");
        }
    }

    /// <summary>
    /// The staged search index that arrived with the notes pack, or null when
    /// the pack is older than the delivered-index format.
    /// </summary>
    internal async Task<string?> GetDeliveredIndexPathAsync()
    {
        await InitializeAsync();
        return PeekDeliveredIndexPath();
    }

    /// <summary>
    /// The staged search index file if it is already on disk — a plain file
    /// probe that never initializes the pack, copies payloads, or blocks, so
    /// the verses index can check for an adoptable table without waiting on
    /// notes delivery.
    /// </summary>
    internal string? PeekDeliveredIndexPath()
    {
        var path = Path.Join(DataDirectory, SearchIndexDbName);
        return File.Exists(path) ? path : null;
    }

    /// <summary>
    /// Runs <paramref name="action"/> only when notes are definitively
    /// unavailable (initialized, then missing, rejected or removed). Skips
    /// without blocking while initialization or a download holds the pack, or
    /// before it was ever initialized — a staged index may still be adopted.
    /// Returns whether it ran.
    /// </summary>
    internal bool RunIfSettledUnavailable(Action action)
    {
        if (!_operationLock.Wait(0))
        {
            return false;
        }
        try
        {
            if (_initialized && !IsAvailable)
            {
                action();
                return true;
            }
            return false;
        }
        finally { _operationLock.Release(); }
    }

    /// <summary>Restages a delivered index after cache eviction, using only
    /// already available assets. Never initiates a store download.</summary>
    internal async Task<string?> RestoreDeliveredIndexPathAsync()
    {
        await _operationLock.WaitAsync();
        try
        {
            await InitializeCoreAsync();
            if (!IsAvailable)
            {
                return null;
            }
            var path = Path.Join(DataDirectory, SearchIndexDbName);
            if (!File.Exists(path))
            {
                var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName, CancellationToken.None);
                if (padPath != null)
                {
                    await TryCopyPadIndexAsync(padPath);
                }
                // Raw-note test instances isolate their directory from platform packages.
                if (!File.Exists(path) && _dataDirectoryOverride == null)
                {
                    await TryCopyPackageIndexAsync();
                }
            }
            return File.Exists(path) ? path : null;
        }
        finally { _operationLock.Release(); }
    }

    private async Task<string?> ReadSchemaVersionAsync()
    {
        try
        {
            return await _connection!.ExecuteScalarAsync<string>(
                "SELECT value FROM _metadata WHERE key = 'schema_version'");
        }
        catch (SQLiteException)
        {
            // DB may not have _metadata at all (legacy or corrupt file).
            return null;
        }
    }

    private static async Task<string?> ReadSchemaVersionAsync(string dbPath)
    {
        SQLiteAsyncConnection? conn = null;
        try
        {
            conn = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            return await conn.ExecuteScalarAsync<string>(
                "SELECT value FROM _metadata WHERE key = 'schema_version'");
        }
        catch (SQLiteException)
        {
            return null;
        }
        finally
        {
            if (conn != null)
            {
                await conn.CloseAsync();
            }
        }
    }

    /// <summary>
    /// Compares the local DB with the PAD copy and overwrites local when the
    /// pack is newer — or whenever the local file is an incompatible schema,
    /// even at equal build timestamps (a stale format must never survive a
    /// compatible pack that is already on the device).
    /// </summary>
    private async Task TryUpgradeFromPadAsync(string localDbPath)
    {
        try
        {
            var padPath = await _padService.TryGetAssetPathAsync(PerushimNotesPackName, CancellationToken.None);
            if (padPath == null)
            {
                return;
            }

            var padDbPath = Path.Join(padPath, NotesDbName);
            if (!File.Exists(padDbPath))
            {
                padDbPath = Path.Join(padPath, "assets", NotesDbName);
            }

            if (!File.Exists(padDbPath))
            {
                return;
            }

            var localSchema = await ReadSchemaVersionAsync(localDbPath);
            var padSchema = await ReadSchemaVersionAsync(padDbPath);
            if (padSchema != PerushNoteBlob.SchemaVersion)
            {
                return;
            }

            var localTs = await GetBuildTimestampAsync(localDbPath);
            var padTs = await GetBuildTimestampAsync(padDbPath);
            var localCompatible = localSchema == PerushNoteBlob.SchemaVersion;
            if ((!localCompatible || padTs > localTs) && !await IsRejectedGenerationAsync(padDbPath))
            {
                await using var source = File.OpenRead(padDbPath);
                await AtomicFile.CopyAsync(source, localDbPath);
                await TryCopyPadIndexAsync(padPath);
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
        if (!File.Exists(dbPath))
        {
            return 0;
        }

        SQLiteAsyncConnection? conn = null;
        try
        {
            conn = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            var rows = await conn.QueryAsync<MetadataRow>(
                "SELECT value AS Value FROM _metadata WHERE key = 'build_timestamp'");
            if (rows.Count > 0 && long.TryParse(rows[0].Value, out var ts))
            {
                return ts;
            }
        }
        catch { /* DB may not have _metadata table (legacy) */ }
        finally
        {
            if (conn != null)
            {
                await conn.CloseAsync();
            }
        }
        return 0;
    }

    private async Task<bool> TryCopyFromPadAsync(string padAssetsPath, string dbPath, bool respectRejectionMarker = true)
    {
        // PAD may expose pack root or an "assets" subfolder depending on SDK/version
        var srcPath = Path.Join(padAssetsPath, NotesDbName);
        if (!File.Exists(srcPath))
        {
            srcPath = Path.Join(padAssetsPath, "assets", NotesDbName);
        }

        if (!File.Exists(srcPath))
        {
            return false;
        }

        // An incompatible pack file would only be rejected and deleted after
        // the copy — checking first also avoids re-copying ~65 MB on every
        // launch while the store still serves an old generation.
        if (await ReadSchemaVersionAsync(srcPath) != PerushNoteBlob.SchemaVersion)
        {
            Console.Error.WriteLine("PAD notes have an incompatible schema; skipping copy.");
            return false;
        }
        if (respectRejectionMarker && await IsRejectedGenerationAsync(srcPath))
        {
            Console.Error.WriteLine("PAD notes match an already-rejected generation; skipping copy.");
            return false;
        }

        var copied = false;
        try
        {
            await using var source = File.OpenRead(srcPath);
            await AtomicFile.CopyAsync(source, dbPath);
            await TryCopyPadIndexAsync(padAssetsPath);
            copied = true;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to copy perushim notes from PAD: {ex.Message}");
        }
        return copied;
    }

    /// <summary>
    /// Copies the pack's delivered search index next to the notes DB when the
    /// pack carries one. Optional: packs older than the delivered-index format
    /// simply leave the app to build the index on-device.
    /// </summary>
    private async Task TryCopyPadIndexAsync(string padAssetsPath)
    {
        var srcPath = Path.Join(padAssetsPath, SearchIndexDbName);
        if (!File.Exists(srcPath))
        {
            srcPath = Path.Join(padAssetsPath, "assets", SearchIndexDbName);
        }
        if (!File.Exists(srcPath))
        {
            return;
        }
        try
        {
            await using var source = File.OpenRead(srcPath);
            await AtomicFile.CopyAsync(source, Path.Join(DataDirectory, SearchIndexDbName));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"Failed to copy delivered search index from PAD: {ex.Message}");
        }
    }

    /// <summary>
    /// Copies the notes DB from the app package when bundled (e.g. Android Debug MauiAsset fallback).
    /// The package cannot be inspected without materializing it, so it lands in
    /// a staging file first — the same schema and rejected-generation checks as
    /// a PAD pack run before it becomes the local DB. Without the gate a
    /// catalog-mismatched bundle would copy → reject → delete on every launch.
    /// </summary>
    private async Task<bool> TryCopyFromAppPackageAsync(string dbPath)
    {
        var staged = dbPath + ".pkgcheck";
        try
        {
            await using var source = await _fileSystem.OpenAppPackageFileAsync(NotesDbName);
            await AtomicFile.CopyAsync(source, staged);
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
        if (await ReadSchemaVersionAsync(staged) != PerushNoteBlob.SchemaVersion ||
            await IsRejectedGenerationAsync(staged))
        {
            TryDelete(staged);
            return false;
        }
        File.Move(staged, dbPath, overwrite: true);
        await TryCopyPackageIndexAsync();
        return true;
    }

    private async Task TryCopyPackageIndexAsync()
    {
        try
        {
            await using var source = await _fileSystem.OpenAppPackageFileAsync(SearchIndexDbName);
            await AtomicFile.CopyAsync(source, Path.Join(DataDirectory, SearchIndexDbName));
        }
        catch (FileNotFoundException)
        {
            // Bundled package may not carry the index — the app builds it on-device.
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            System.Diagnostics.Debug.WriteLine($"Delivered search index copy from app package failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Gets distinct perush IDs that have notes for the given perek.
    /// </summary>
    public async Task<List<int>> GetPerushIdsForPerekAsync(int perekId)
    {
        await InitializeAsync();
        if (_connection == null)
        {
            return new List<int>();
        }

        var rows = await _connection.QueryAsync<IdRow>(
            "SELECT perush_id AS Id FROM perek_perush WHERE perek_id = ? ORDER BY perush_id",
            perekId);

        return rows.Select(r => r.Id).ToList();
    }

    /// <summary>Retains the compressed chapter and lightweight identities, with no note strings.</summary>
    internal async Task<PerushNoteChapter?> LoadChapterAsync(int perekId)
    {
        await InitializeAsync();
        if (_connection == null) { return null; }
        var rows = await _connection.QueryAsync<BlobRow>(
            "SELECT data AS Data FROM note_blob WHERE perek_id = ?", perekId);
        return rows.Count == 0 ? null : await Task.Run(() => new PerushNoteChapter(rows[0].Data));
    }

    /// <summary>
    /// Loads all notes for a perek. Returns empty if notes DB is not available.
    /// </summary>
    public async Task<List<PerekPerushNote>> LoadNotesForPerekAsync(int perekId, IReadOnlyDictionary<int, Perush> perushById)
    {
        await InitializeAsync();
        if (_connection == null)
        {
            return new List<PerekPerushNote>();
        }

        var rows = await _connection.QueryAsync<BlobRow>(
            "SELECT data AS Data FROM note_blob WHERE perek_id = ?",
            perekId);
        if (rows.Count == 0)
        {
            return new List<PerekPerushNote>();
        }

        // A whole perek's notes decompress in one pass — keep that off the UI thread.
        var blob = rows[0].Data;
        var decoded = await Task.Run(() => PerushNoteBlob.Decode(blob));

        return decoded
            .Select(r =>
            {
                var name = perushById.GetValueOrDefault(r.PerushId)?.Name ?? $"Perush {r.PerushId}";
                return new PerekPerushNote
                {
                    PerushId = r.PerushId,
                    PerushName = name,
                    PerekId = perekId,
                    Pasuk = r.Pasuk,
                    NoteIdx = r.NoteIdx,
                    NoteContent = r.Content
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

    private class BlobRow
    {
        [Column("data")]
        public byte[] Data { get; set; } = [];
    }
}
