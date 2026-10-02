using SQLite;
using BibleOnSite.Helpers;

namespace BibleOnSite.Services;

/// <summary>
/// Service for managing the local SQLite database.
/// Provides singleton access to the database connection.
/// </summary>
public class LocalDatabaseService
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
    private static readonly Lazy<LocalDatabaseService> _instance = new(() => new LocalDatabaseService());

    /// <summary>
    /// Singleton instance of the LocalDatabaseService.
    /// </summary>
    public static LocalDatabaseService Instance => _instance.Value;

    private SQLiteAsyncConnection? _database;
    private bool _isInitialized;

    private readonly IFileSystem _fileSystem;

    private LocalDatabaseService() : this(FileSystem.Current) { }

    public LocalDatabaseService(IFileSystem fileSystem) { _fileSystem = fileSystem; }

    /// <summary>
    /// Gets the database connection, initializing it if necessary.
    /// </summary>
    public async Task<SQLiteAsyncConnection> GetDatabaseAsync()
    {
        if (_isInitialized && _database != null)
            return _database;

        await InitializeAsync();
        return _database!;
    }

    /// <summary>
    /// Initializes the database by copying from app assets if needed.
    /// </summary>
    public async Task InitializeAsync()
    {
        if (_isInitialized)
            return;

        var dbPath = Path.Combine(_fileSystem.AppDataDirectory, DbName);

        // Copy database from app package to writable location if it doesn't exist
        if (!File.Exists(dbPath))
        {
            await CopyDatabaseFromAssetsAsync(dbPath);
        }

        _database = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
        _isInitialized = true;
    }

    private async Task CopyDatabaseFromAssetsAsync(string targetPath)
    {
        try
        {
            await using var sourceStream = await _fileSystem.OpenAppPackageFileAsync(DbName);
            await AtomicFile.CopyAsync(sourceStream, targetPath);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to copy database from assets: {ex.Message}");
            throw;
        }
    }
}
