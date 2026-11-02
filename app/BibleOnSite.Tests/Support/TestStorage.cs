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
        await connection.CloseAsync();
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
        await new SQLiteAsyncConnection(Path.Join(Root, name), flags).CloseAsync();
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var connection in _connections)
        {
            await connection.CloseAsync();
        }
        foreach (var stream in _packageStreams)
        {
            stream.Dispose();
        }
        Directory.Delete(Root, true);
    }
}
