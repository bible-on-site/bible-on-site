using System.Reflection;
using BibleOnSite.Services;
using SQLite;

namespace BibleOnSite.Tests.Services;

public sealed class PerushimCatalogServiceTests : IDisposable
{
    private readonly string _tempRoot;
    private readonly List<SQLiteAsyncConnection> _connections = [];

    public PerushimCatalogServiceTests()
    {
        _tempRoot = Path.Join(Path.GetTempPath(), Path.GetRandomFileName());
        Directory.CreateDirectory(_tempRoot);
    }

    public void Dispose()
    {
        foreach (var connection in _connections)
        {
            connection.CloseAsync().GetAwaiter().GetResult();
        }

        try
        {
            if (Directory.Exists(_tempRoot))
            {
                Directory.Delete(_tempRoot, true);
            }
        }
        catch (DirectoryNotFoundException)
        {
            // Best-effort cleanup on temp directory.
        }
        catch (IOException)
        {
            // Best-effort cleanup on temp directory.
        }
        catch (UnauthorizedAccessException)
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

    [Fact]
    public async Task GetPerushimByIdsAsync_AcrossManyCalls_QueriesTheCatalogOnce()
    {
        var connection = await CreateCatalogConnectionAsync(
            (1, "Targum", 10),
            (2, "Rashi", 20));
        var queries = TraceQueries(connection);
        var service = CreateService(connection: connection);

        for (var i = 0; i < 20; i++)
        {
            (await service.GetPerushimByIdsAsync([1, 2])).Keys.Should().BeEquivalentTo([1, 2]);
        }
        (await service.GetAllPerushimAsync()).Select(p => p.Id).Should().Equal(1, 2);

        queries.Should().ContainSingle();
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_WithOnlyUnknownIds_ReturnsEmpty()
    {
        var connection = await CreateCatalogConnectionAsync((1, "Targum", 10));
        var service = CreateService(connection: connection);

        var perushim = await service.GetPerushimByIdsAsync([98, 99]);

        perushim.Should().BeEmpty();
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_WithNoIds_DoesNotLoadTheCatalog()
    {
        var connection = await CreateCatalogConnectionAsync((1, "Targum", 10));
        var queries = TraceQueries(connection);
        var service = CreateService(connection: connection);

        (await service.GetPerushimByIdsAsync([])).Should().BeEmpty();

        queries.Should().BeEmpty();
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_AfterTheConnectionIsReopened_ReadsTheNewCatalog()
    {
        var first = await CreateCatalogConnectionAsync((1, "Targum", 10));
        var second = await CreateCatalogConnectionAsync((1, "Onkelos", 5));
        var service = CreateService(connection: first);
        (await service.GetPerushimByIdsAsync([1]))[1].Name.Should().Be("Targum");

        SetPrivateField(service, "_connection", second);

        (await service.GetPerushimByIdsAsync([1]))[1].Name.Should().Be("Onkelos");
        (await service.GetAllPerushimAsync()).Single().Priority.Should().Be(5);
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_ConcurrentFirstCalls_ShareOneLoad()
    {
        var connection = await CreateCatalogConnectionAsync(
            (1, "Targum", 10),
            (2, "Rashi", 20));
        var queries = TraceQueries(connection);
        var service = CreateService(connection: connection);

        var results = await Task.WhenAll(Enumerable.Range(0, 16)
            .Select(_ => Task.Run(() => service.GetPerushimByIdsAsync([2]), TestContext.Current.CancellationToken)));

        results.Should().AllSatisfy(r => r[2].Name.Should().Be("Rashi"));
        queries.Should().ContainSingle();
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_AfterAFailedLoad_RetriesOnTheNextCall()
    {
        var connection = await CreateCatalogConnectionAsync((1, "Targum", 10));
        await connection.ExecuteAsync("ALTER TABLE perush RENAME TO perush_pending");
        var service = CreateService(connection: connection);

        var failed = () => service.GetPerushimByIdsAsync([1]);
        await failed.Should().ThrowAsync<SQLiteException>();
        await connection.ExecuteAsync("ALTER TABLE perush_pending RENAME TO perush");

        (await service.GetPerushimByIdsAsync([1]))[1].Name.Should().Be("Targum");
    }

    [Fact]
    public async Task GetPerushimByIdsAsync_WhenACallerEditsAResult_LaterReadsAreUnaffected()
    {
        var connection = await CreateCatalogConnectionAsync((1, "Targum", 10));
        var service = CreateService(connection: connection);

        (await service.GetPerushimByIdsAsync([1]))[1].Name = "Temporary";
        (await service.GetAllPerushimAsync()).Single().Priority = 99;

        var perush = (await service.GetPerushimByIdsAsync([1]))[1];
        perush.Name.Should().Be("Targum");
        perush.Priority.Should().Be(10);
    }

    private static List<string> TraceQueries(SQLiteAsyncConnection connection)
    {
        var queries = new List<string>();
        var sqlite = connection.GetConnection();
        sqlite.Tracer = line =>
        {
            if (line.Contains("FROM perush", StringComparison.Ordinal))
            {
                lock (queries)
                {
                    queries.Add(line);
                }
            }
        };
        sqlite.Trace = true;
        return queries;
    }

    private async Task<SQLiteAsyncConnection> CreateCatalogConnectionAsync(
        params (int id, string? name, int priority)[] rows)
    {
        var dbFileName = Path.ChangeExtension(Path.GetRandomFileName(), ".sqlite");
        dbFileName = Path.GetFileName(dbFileName);
        var dbPath = Path.Join(_tempRoot, dbFileName);
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
