using System.Reflection;
using BibleOnSite.Services;
using SQLite;

namespace BibleOnSite.Tests.Services;

public sealed class PerushimCatalogServiceTests : IDisposable
{
    private readonly string _tempRoot;
    private readonly List<SQLiteAsyncConnection> _connections = [];

    static PerushimCatalogServiceTests()
    {
        SQLitePCL.Batteries_V2.Init();
    }

    public PerushimCatalogServiceTests()
    {
        _tempRoot = Path.Combine(Path.GetTempPath(), "BibleOnSiteCatalogTests_" + Guid.NewGuid());
        Directory.CreateDirectory(_tempRoot);
    }

    public void Dispose()
    {
        foreach (var connection in _connections)
            connection.CloseAsync().GetAwaiter().GetResult();

        try
        {
            if (Directory.Exists(_tempRoot))
                Directory.Delete(_tempRoot, true);
        }
        catch
        {
            // Best-effort cleanup on temp directory.
        }
    }

    [Fact]
    public async Task GetAllPerushimAsync_WhenCatalogMissing_ReturnsEmpty()
    {
        var service = CreateService(catalogMissing: true);

        var perushim = await service.GetAllPerushimAsync();
        var byIds = await service.GetPerushimByIdsAsync([1, 2]);

        service.IsAvailable.Should().BeFalse();
        perushim.Should().BeEmpty();
        byIds.Should().BeEmpty();
    }

    [Fact]
    public async Task GetAllPerushimAsync_ReturnsRowsOrderedByPriority()
    {
        var connection = await CreateCatalogConnectionAsync(
            (2, "Rashi", 20),
            (1, "Targum", 10),
            (3, null, 30));
        var service = CreateService(connection: connection);

        var perushim = await service.GetAllPerushimAsync();

        service.IsAvailable.Should().BeTrue();
        perushim.Select(p => p.Id).Should().Equal(1, 2, 3);
        perushim.Select(p => p.Name).Should().Equal("Targum", "Rashi", string.Empty);
        perushim.Select(p => p.Priority).Should().Equal(10, 20, 30);
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_FiltersDistinctIdsIntoDictionary()
    {
        var connection = await CreateCatalogConnectionAsync(
            (1, "Targum", 10),
            (2, "Rashi", 20),
            (3, "Ibn Ezra", 30));
        var service = CreateService(connection: connection);

        var perushim = await service.GetPerushimByIdsAsync([2, 2, 3, 99]);

        perushim.Keys.Should().BeEquivalentTo([2, 3]);
        perushim[2].Name.Should().Be("Rashi");
        perushim[3].Priority.Should().Be(30);
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_WithNoIds_ReturnsEmptyWithoutQuerying()
    {
        var connection = await CreateCatalogConnectionAsync((1, "Targum", 10));
        var service = CreateService(connection: connection);

        var perushim = await service.GetPerushimByIdsAsync([]);

        perushim.Should().BeEmpty();
    }

    private async Task<SQLiteAsyncConnection> CreateCatalogConnectionAsync(
        params (int id, string? name, int priority)[] rows)
    {
        var dbPath = Path.Combine(_tempRoot, Guid.NewGuid() + ".sqlite");
        var connection = new SQLiteAsyncConnection(
            dbPath,
            SQLiteOpenFlags.ReadWrite | SQLiteOpenFlags.Create);
        _connections.Add(connection);

        await connection.ExecuteAsync(
            "CREATE TABLE perush (id INTEGER PRIMARY KEY, name TEXT, priority INTEGER NOT NULL)");
        foreach (var (id, name, priority) in rows)
        {
            await connection.ExecuteAsync(
                "INSERT INTO perush (id, name, priority) VALUES (?, ?, ?)",
                id,
                name,
                priority);
        }

        return connection;
    }

    private static PerushimCatalogService CreateService(
        SQLiteAsyncConnection? connection = null,
        bool catalogMissing = false)
    {
        var service = (PerushimCatalogService)Activator.CreateInstance(
            typeof(PerushimCatalogService),
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            args: [],
            culture: null)!;

        SetPrivateField(service, "_connection", connection);
        SetPrivateField(service, "_isInitialized", true);
        SetPrivateField(service, "_catalogMissing", catalogMissing);
        return service;
    }

    private static void SetPrivateField<T>(PerushimCatalogService service, string name, T value)
    {
        typeof(PerushimCatalogService)
            .GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)!
            .SetValue(service, value);
    }
}
