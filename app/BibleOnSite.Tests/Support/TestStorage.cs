using Microsoft.Maui.Storage;
using SQLite;

namespace BibleOnSite.Tests.Support;

/// <summary>Isolated real files and SQLite databases behind the app's package-file boundary.</summary>
public sealed class TestStorage : IAsyncDisposable
{
    private readonly List<SQLiteAsyncConnection> _connections = [];
    public string Root { get; } = Path.Combine(Path.GetTempPath(), "BibleOnSite", Guid.NewGuid().ToString("N"));
    public Mock<IFileSystem> FileSystem { get; } = new();
    public Dictionary<string, byte[]> PackageFiles { get; } = [];

    public TestStorage()
    {
        Directory.CreateDirectory(Root);
        FileSystem.SetupGet(f => f.AppDataDirectory).Returns(Root);
        FileSystem.SetupGet(f => f.CacheDirectory).Returns(Root);
        FileSystem.Setup(f => f.OpenAppPackageFileAsync(It.IsAny<string>()))
            .Returns((string name) => PackageFiles.TryGetValue(name, out var bytes)
                ? Task.FromResult<Stream>(new MemoryStream(bytes))
                : Task.FromException<Stream>(new FileNotFoundException(name)));
    }

    public async Task<SQLiteAsyncConnection> CreateDatabaseAsync(string name, params string[] statements)
    {
        var path = Path.Combine(Root, name);
        var connection = new SQLiteAsyncConnection(path);
        _connections.Add(connection);
        // sqlite-net pools read-only and writable connections separately.
        _connections.Add(new SQLiteAsyncConnection(path, SQLiteOpenFlags.ReadOnly));
        foreach (var statement in statements) await connection.ExecuteAsync(statement);
        return connection;
    }

    public async Task BundleDatabaseAsync(string name, params string[] statements)
    {
        var connection = await CreateDatabaseAsync(name, statements);
        await connection.CloseAsync();
        PackageFiles[name] = await File.ReadAllBytesAsync(Path.Combine(Root, name));
        File.Delete(Path.Combine(Root, name));
    }

    public async ValueTask DisposeAsync()
    {
        foreach (var connection in _connections) await connection.CloseAsync();
        Directory.Delete(Root, true);
    }
}
