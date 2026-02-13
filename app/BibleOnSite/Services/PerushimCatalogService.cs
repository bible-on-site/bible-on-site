using BibleOnSite.Models;
using SQLite;

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

    private PerushimCatalogService() { }

    /// <summary>Whether the catalog database is available.</summary>
    public bool IsAvailable => _isInitialized && !_catalogMissing && _connection != null;

    /// <summary>
    /// Gets the database connection. Returns null if the catalog is not bundled.
    /// </summary>
    public async Task<SQLiteAsyncConnection?> GetConnectionAsync()
    {
        if (_catalogMissing)
            return null;
        if (_isInitialized && _connection != null)
            return _connection;
        await InitializeAsync();
        return _connection;
    }

    /// <summary>
    /// Initializes by copying the catalog from app package to AppDataDirectory if needed.
    /// </summary>
    public async Task InitializeAsync()
    {
        if (_isInitialized)
            return;

        var dbPath = Path.Combine(FileSystem.AppDataDirectory, CatalogDbName);

        if (!File.Exists(dbPath))
        {
            try
            {
                await CopyCatalogFromAssetsAsync(dbPath);
            }
            catch (FileNotFoundException)
            {
                _catalogMissing = true;
                _isInitialized = true;
                return;
            }
        }

        _connection = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
        _isInitialized = true;
    }

    private static async Task CopyCatalogFromAssetsAsync(string targetPath)
    {
        await using var sourceStream = await FileSystem.OpenAppPackageFileAsync(CatalogDbName);
        await using var targetStream = File.Create(targetPath);
        await sourceStream.CopyToAsync(targetStream);
    }

    /// <summary>
    /// Gets all perushim ordered by priority (Targum first, Rashi second, etc.).
    /// </summary>
    public async Task<List<Perush>> GetAllPerushimAsync()
    {
        var conn = await GetConnectionAsync();
        if (conn == null)
            return new List<Perush>();

        var rows = await conn.QueryAsync<PerushRow>(
            "SELECT id, name, priority FROM perush ORDER BY priority ASC");

        return rows.Select(r => new Perush { Id = r.Id, Name = r.Name ?? string.Empty, Priority = r.Priority })
            .ToList();
    }

    /// <summary>
    /// Gets perush by IDs. Used to resolve names for perushim that have notes in a perek.
    /// </summary>
    public async Task<Dictionary<int, Perush>> GetPerushimByIdsAsync(IEnumerable<int> ids)
    {
        var conn = await GetConnectionAsync();
        if (conn == null)
            return new Dictionary<int, Perush>();

        var idList = string.Join(",", ids.Distinct());
        if (string.IsNullOrEmpty(idList))
            return new Dictionary<int, Perush>();

        var rows = await conn.QueryAsync<PerushRow>(
            $"SELECT id, name, priority FROM perush WHERE id IN ({idList})");

        return rows.ToDictionary(r => r.Id, r => new Perush { Id = r.Id, Name = r.Name ?? string.Empty, Priority = r.Priority });
    }

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
