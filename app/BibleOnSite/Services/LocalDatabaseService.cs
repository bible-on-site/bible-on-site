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
    private readonly SemaphoreSlim _initializeLock = new(1, 1);

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
    /// Refreshes generated Bible text from the installed app before opening it.
    /// </summary>
    public async Task InitializeAsync()
    {
        await _initializeLock.WaitAsync();
        try
        {
            if (_isInitialized)
                return;
            await PackagedDatabase.RefreshAsync(_fileSystem, DbName);
            var dbPath = Path.Combine(_fileSystem.AppDataDirectory, DbName);
            _database = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
            _isInitialized = true;
        }
        finally { _initializeLock.Release(); }
    }
}
