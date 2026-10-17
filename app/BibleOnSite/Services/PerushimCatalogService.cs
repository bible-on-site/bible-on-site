using BibleOnSite.Models;
using SQLite;
using BibleOnSite.Helpers;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading perushim catalog (parshan + perush metadata) from bundled SQLite.
/// The catalog is small (~50–100 KB) and bundled in Resources/Raw.
/// Notes are loaded separately via PerushimNotesService (PAD/on-demand).
/// </summary>
public class PerushimCatalogService
{
    private const string CatalogDbName = "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite";

    private static readonly Lazy<PerushimCatalogService> _instance =
        new(() => new PerushimCatalogService());

    public static PerushimCatalogService Instance => _instance.Value;

    private SQLiteAsyncConnection? _connection;
    private bool _isInitialized;
    private bool _catalogMissing;
    private readonly SemaphoreSlim _initializeLock = new(1, 1);
    private readonly object _catalogLoadLock = new();
    private SQLiteAsyncConnection? _catalogConnection;
    private Task<Catalog>? _catalogLoad;

    private readonly IFileSystem _fileSystem;

    private PerushimCatalogService() : this(FileSystem.Current) { }

    public PerushimCatalogService(IFileSystem fileSystem) { _fileSystem = fileSystem; }

    /// <summary>Whether the catalog database is available.</summary>
    public bool IsAvailable => _isInitialized && !_catalogMissing && _connection != null;

    /// <summary>
    /// Gets the database connection. Returns null if the catalog is not bundled.
    /// </summary>
    public async Task<SQLiteAsyncConnection?> GetConnectionAsync()
    {
        if (_catalogMissing)
        {
            return null;
        }

        if (_isInitialized && _connection != null)
        {
            return _connection;
        }

        await InitializeAsync();
        return _connection;
    }

    /// <summary>
    /// Refreshes the catalog from the installed app before resolving note IDs.
    /// Generated IDs can change between releases, so a copy from an older app is unsafe.
    /// </summary>
    public async Task InitializeAsync()
    {
        await _initializeLock.WaitAsync();
        try
        {
            if (_isInitialized)
            {
                return;
            }

            var dbPath = Path.Combine(_fileSystem.AppDataDirectory, CatalogDbName);
            try
            {
                await PackagedDatabase.RefreshAsync(_fileSystem, CatalogDbName);
            }
            catch (FileNotFoundException)
            {
                _catalogMissing = true;
                _isInitialized = true;
                return;
            }

            _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _isInitialized = true;
        }
        finally { _initializeLock.Release(); }
    }

    /// <summary>
    /// Gets all perushim ordered by priority (Targum first, Rashi second, etc.).
    /// </summary>
    public async Task<List<Perush>> GetAllPerushimAsync()
    {
        var conn = await GetConnectionAsync();
        if (conn == null)
        {
            return new List<Perush>();
        }

        return [.. (await GetCatalogAsync(conn)).ByPriority];
    }

    /// <summary>
    /// Gets perush by IDs. Used to resolve names for perushim that have notes in a perek.
    /// Served from the in-memory catalog, which is read once per connection.
    /// </summary>
    public async Task<Dictionary<int, Perush>> GetPerushimByIdsAsync(IEnumerable<int> ids)
    {
        var conn = await GetConnectionAsync();
        if (conn == null)
        {
            return new Dictionary<int, Perush>();
        }

        var idList = ids.Distinct().ToList();
        if (idList.Count == 0)
        {
            return new Dictionary<int, Perush>();
        }

        var byId = (await GetCatalogAsync(conn)).ById;
        return idList.Where(byId.ContainsKey).ToDictionary(id => id, id => byId[id]);
    }

    /// <summary>
    /// The catalog is small and immutable for the lifetime of a connection, so concurrent
    /// first callers share one load. Keyed on the connection: a re-opened DB is re-read.
    /// A failed load is not cached, so the next call retries.
    /// </summary>
    private Task<Catalog> GetCatalogAsync(SQLiteAsyncConnection conn)
    {
        lock (_catalogLoadLock)
        {
            if (_catalogLoad == null || _catalogConnection != conn || _catalogLoad.IsFaulted || _catalogLoad.IsCanceled)
            {
                _catalogConnection = conn;
                _catalogLoad = LoadCatalogAsync(conn);
            }
            return _catalogLoad;
        }
    }

    private static async Task<Catalog> LoadCatalogAsync(SQLiteAsyncConnection conn)
    {
        var rows = await conn.QueryAsync<PerushRow>(
            "SELECT id, name, priority FROM perush ORDER BY priority ASC");
        var byPriority = rows
            .Select(r => new Perush { Id = r.Id, Name = r.Name ?? string.Empty, Priority = r.Priority })
            .ToList();
        return new Catalog(byPriority, byPriority.ToDictionary(p => p.Id));
    }

    private sealed record Catalog(List<Perush> ByPriority, Dictionary<int, Perush> ById);

    private class PerushRow
    {
        [Column("id")]
        public int Id { get; set; }

        [Column("name")]
        public string? Name { get; set; }

        [Column("priority")]
        public int Priority { get; set; }
    }
}
