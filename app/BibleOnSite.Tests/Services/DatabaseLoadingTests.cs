using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

public class DatabaseLoadingTests
{
    private const string BibleDb = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
    private const string CatalogDb = "sefaria-dump-5784-sivan-4.perushim_catalog.sqlite";

    [Fact]
    public async Task BibleDatabase_CopiesPackagedFileOnce_AndReusesReadOnlyConnection()
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync(BibleDb, "CREATE TABLE sample (value TEXT)", "INSERT INTO sample VALUES ('bundled')");
        var service = new LocalDatabaseService(storage.FileSystem.Object);
        var db = await service.GetDatabaseAsync();
        (await db.ExecuteScalarAsync<string>("SELECT value FROM sample")).Should().Be("bundled");
        await service.InitializeAsync();
        (await service.GetDatabaseAsync()).Should().BeSameAs(db);
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(BibleDb), Times.Once);
        await FluentActions.Awaiting(() => db.ExecuteAsync("DELETE FROM sample")).Should().ThrowAsync<SQLite.SQLiteException>();
    }

    [Fact]
    public async Task BibleDatabase_WithMissingPackage_RetainsOfflineCopy()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(BibleDb, "CREATE TABLE sample (value TEXT)", "INSERT INTO sample VALUES ('existing')");
        var db = await new LocalDatabaseService(storage.FileSystem.Object).GetDatabaseAsync();
        (await db.ExecuteScalarAsync<string>("SELECT value FROM sample")).Should().Be("existing");
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(BibleDb), Times.Once);
    }

    [Fact]
    public async Task BibleDatabase_PropagatesCopyFailure_AndCanRetry()
    {
        await using var storage = new TestStorage();
        var service = new LocalDatabaseService(storage.FileSystem.Object);
        await FluentActions.Awaiting(() => service.InitializeAsync()).Should().ThrowAsync<FileNotFoundException>();
        await storage.BundleDatabaseAsync(BibleDb, "CREATE TABLE sample (value TEXT)");
        (await service.GetDatabaseAsync()).Should().NotBeNull();
    }

    [Fact]
    public async Task Catalog_CopiesPackage_QueriesData_AndInitializesOnlyOnce()
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync(CatalogDb, "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)",
            "INSERT INTO perush VALUES (1,'Rashi',2),(2,NULL,1)");
        var service = new PerushimCatalogService(storage.FileSystem.Object);
        service.IsAvailable.Should().BeFalse();
        (await service.GetAllPerushimAsync()).Select(p => p.Name).Should().Equal("", "Rashi");
        var db = await service.GetConnectionAsync();
        await service.InitializeAsync();
        (await service.GetConnectionAsync()).Should().BeSameAs(db);
        service.IsAvailable.Should().BeTrue();
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(CatalogDb), Times.Once);
    }

    [Fact]
    public async Task Catalog_WhenPackageIsMissing_RemembersUnavailableState()
    {
        await using var storage = new TestStorage();
        var service = new PerushimCatalogService(storage.FileSystem.Object);
        (await service.GetConnectionAsync()).Should().BeNull();
        (await service.GetAllPerushimAsync()).Should().BeEmpty();
        (await service.GetPerushimByIdsAsync([1])).Should().BeEmpty();
        await service.InitializeAsync();
        service.IsAvailable.Should().BeFalse();
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(CatalogDb), Times.Once);
    }

    [Fact]
    public async Task Catalog_WithExistingFileAndMissingPackage_RetainsOfflineCopy()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(CatalogDb, "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)");
        var service = new PerushimCatalogService(storage.FileSystem.Object);
        (await service.GetAllPerushimAsync()).Should().BeEmpty();
        service.IsAvailable.Should().BeTrue();
        storage.FileSystem.Verify(f => f.OpenAppPackageFileAsync(CatalogDb), Times.Once);
    }

    [Fact]
    public async Task BibleDatabase_RefreshesExistingTextFromUpdatedPackage()
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync(BibleDb, "CREATE TABLE sample (value TEXT)", "INSERT INTO sample VALUES ('corrected')");
        var old = await storage.CreateDatabaseAsync(BibleDb, "CREATE TABLE sample (value TEXT)", "INSERT INTO sample VALUES ('old')");
        await old.CloseAsync();
        var db = await new LocalDatabaseService(storage.FileSystem.Object).GetDatabaseAsync();
        (await db.ExecuteScalarAsync<string>("SELECT value FROM sample")).Should().Be("corrected");
    }
}
