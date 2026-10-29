using Microsoft.Maui.Storage;
using SQLite;

namespace BibleOnSite.Tests.Support;

/// <summary>Isolated real files and SQLite databases behind the app's package-file boundary.</summary>
public sealed class TestStorage : IAsyncDisposable
{
    private readonly List<SQLiteAsyncConnection> _connections = [];
    private readonly List<MemoryStream> _packageStreams = [];
    public string Root { get; } = Path.Join(Path.GetTempPath(), "BibleOnSite", Guid.NewGuid().ToString("N"));
    public Mock<IFileSystem> FileSystem { get; } = new();
    public Dictionary<string, byte[]> PackageFiles { get; } = [];

    public TestStorage()
    {
        Directory.CreateDirectory(Root);
        FileSystem.SetupGet(f => f.AppDataDirectory).Returns(Root);
        FileSystem.SetupGet(f => f.CacheDirectory).Returns(Root);
        FileSystem.Setup(f => f.OpenAppPackageFileAsync(It.IsAny<string>()))
            .Returns((string name) => PackageFiles.TryGetValue(name, out var bytes)
                ? Task.FromResult<Stream>(PackageStream(bytes))
                : Task.FromException<Stream>(new FileNotFoundException(name)));
    }

    /// <summary>Hands a packaged file's bytes to the service under test; disposed with the storage.</summary>
    private MemoryStream PackageStream(byte[] bytes)
    {
        var stream = new MemoryStream(bytes);
        _packageStreams.Add(stream);
        return stream;
    }

    public async Task<SQLiteAsyncConnection> CreateDatabaseAsync(string name, params string[] statements)
    {
        var path = Path.Join(Root, name);
        var connection = new SQLiteAsyncConnection(path);
        _connections.Add(connection);
        // sqlite-net pools read-only and writable connections separately.
        _connections.Add(new SQLiteAsyncConnection(path, SQLiteOpenFlags.ReadOnly));
        foreach (var statement in statements)
        {
            await connection.ExecuteAsync(statement);
        }
        return connection;
    }

    public async Task BundleDatabaseAsync(string name, params string[] statements)
    {
        var fileName = Path.GetFileName(name);
        if (fileName != name)
        {
            throw new ArgumentException("A package database must have a plain file name.", nameof(name));
        }
        var connection = await CreateDatabaseAsync(fileName, statements);
        await ClosePooledSafelyAsync(connection);
        PackageFiles[fileName] = await File.ReadAllBytesAsync(Path.Join(Root, fileName));
        File.Delete(Path.Join(Root, fileName));
    }

    /// <summary>
    /// Closes the pooled sqlite-net connection for one file under <see cref="Root"/> —
    /// including a connection a service opened and pooled itself — so tests can delete
    /// or replace the file on Windows. Scoped to a single connection string; never
    /// resets the shared pool, which other test classes may be using in parallel.
    /// </summary>
    public Task CloseDatabaseFileAsync(string name) => CloseDatabaseFileAsync(name, SQLiteOpenFlags.ReadOnly);

    /// <inheritdoc cref="CloseDatabaseFileAsync(string)"/>
    public async Task CloseDatabaseFileAsync(string name, SQLiteOpenFlags flags)
    {
        await ClosePooledSafelyAsync(new SQLiteAsyncConnection(Path.Join(Root, name), flags));
    }

    /// <summary>
    /// Closes the shared pool entry behind <paramref name="connection"/> without
    /// racing an in-flight query. <c>SQLiteAsyncConnection.CloseAsync()</c> frees
    /// the native handle without taking the pooled connection's <c>Lock()</c> —
    /// closing a file a fire-and-forget service read is still using crashes the
    /// process on a freed <c>sqlite3*</c>. Holding the lock through the close
    /// waits out any read already executing and makes later reads hit a cleanly
    /// <c>NullHandle</c> (a managed SQLiteException, not a native fault).
    /// Runs on a dedicated thread: <c>Lock()</c> uses <see cref="Monitor"/>,
    /// which must exit on the thread that entered — an await-resumed scope
    /// throws <see cref="SynchronizationLockException"/>.
    /// </summary>
    private static Task ClosePooledSafelyAsync(SQLiteAsyncConnection connection)
    {
        SQLiteConnectionWithLock pooled;
        try
        {
            pooled = connection.GetConnection();
        }
        catch (SQLiteException)
        {
            // The file can't be opened (e.g. already deleted): no live pool
            // entry can hold a handle on it, so a plain close only clears a
            // stale entry and never races a read.
            return connection.CloseAsync();
        }
        return Task.Run(() =>
        {
            using (pooled.Lock())
            {
                connection.CloseAsync().GetAwaiter().GetResult();
            }
        });
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var connection in _connections)
        {
            await ClosePooledSafelyAsync(connection);
        }
        foreach (var stream in _packageStreams)
        {
            stream.Dispose();
        }
        try
        {
            Directory.Delete(Root, true);
        }
        catch (IOException)
        {
            // A service handle outside this storage's tracking (e.g. a cached
            // connection member) can still hold a file under Root — Windows
            // then refuses the delete. A residue dir beats an unsafe close;
            // the OS reaps it on process exit anyway.
        }
        catch (UnauthorizedAccessException)
        {
            // Same residual-handle case, surfaced by locked read-only files.
        }
    }
}
