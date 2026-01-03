using SQLite;

namespace BibleOnSite.Services;

/// <summary>
/// Service for managing the local SQLite database.
/// Provides singleton access to the database connection.
/// </summary>
public class LocalDatabaseService
{
    private const string DbName = "db.sqlite";
    private static readonly Lazy<LocalDatabaseService> _instance = new(() => new LocalDatabaseService());

    /// <summary>
    /// Singleton instance of the LocalDatabaseService.
    /// </summary>
    public static LocalDatabaseService Instance => _instance.Value;

    private SQLiteAsyncConnection? _database;
    private bool _isInitialized;

    private LocalDatabaseService() { }

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

        var dbPath = Path.Combine(FileSystem.AppDataDirectory, DbName);

        // Copy database from app package to writable location if it doesn't exist
        if (!File.Exists(dbPath))
        {
            await CopyDatabaseFromAssetsAsync(dbPath);
        }

        _database = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
        _isInitialized = true;
    }

    private static async Task CopyDatabaseFromAssetsAsync(string targetPath)
    {
        try
        {
            await using var sourceStream = await FileSystem.OpenAppPackageFileAsync(DbName);
            await using var targetStream = File.Create(targetPath);
            await sourceStream.CopyToAsync(targetStream);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to copy database from assets: {ex.Message}");
            throw;
        }
    }
}
