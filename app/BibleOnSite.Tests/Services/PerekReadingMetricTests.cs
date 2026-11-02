using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Offline metric reads from the packaged tanah_view sqlite (issue #2607):
/// a populated pack maps to models; a pack predating the metric tables
/// degrades to null/empty instead of failing the reader.
/// </summary>
public sealed class PerekReadingMetricTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    private static readonly string[] MetricSchema =
    [
        .. PerekDataServiceTests.Schema,
        "CREATE TABLE tanah_perek_metric (perek_id INTEGER PRIMARY KEY, word_count INTEGER, " +
            "estimated_seconds INTEGER, words_per_minute INTEGER NOT NULL, calc_version INTEGER NOT NULL, " +
            "source_hash TEXT NOT NULL, computed_at TEXT NOT NULL DEFAULT '')",
        "CREATE TABLE tanah_perek_pasuk_metric (perek_id INTEGER NOT NULL, pasuk INTEGER NOT NULL, " +
            "word_count INTEGER NOT NULL, cumulative_words INTEGER NOT NULL, calc_version INTEGER NOT NULL, " +
            "source_hash TEXT NOT NULL, PRIMARY KEY (perek_id, pasuk))"
    ];

    private static PerekDataService NewService(TestStorage storage) =>
        new(new LocalDatabaseService(storage.FileSystem.Object));

    [Fact]
    public async Task ReadingMetric_MapsTheStoredRow()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, MetricSchema);
        await db.ExecuteAsync(
            "INSERT INTO tanah_perek_metric VALUES (1, 361, 99, 220, 1, 'abc123', '')");

        var metric = await NewService(storage).GetReadingMetricAsync(1);

        metric.Should().NotBeNull();
        metric!.WordCount.Should().Be(361);
        metric.EstimatedSeconds.Should().Be(99);
        metric.WordsPerMinute.Should().Be(220);
        metric.CalcVersion.Should().Be(1);
        metric.SourceHash.Should().Be("abc123");
    }

    [Fact]
    public async Task ReadingMetric_PreservesNullWordCountAndEstimate()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, MetricSchema);
        await db.ExecuteAsync(
            "INSERT INTO tanah_perek_metric (perek_id, word_count, estimated_seconds, words_per_minute, calc_version, source_hash) " +
            "VALUES (1, NULL, NULL, 220, 1, 'deadbeef')");

        var metric = await NewService(storage).GetReadingMetricAsync(1);

        metric.Should().NotBeNull();
        metric!.WordCount.Should().BeNull();
        metric.EstimatedSeconds.Should().BeNull();
    }

    [Fact]
    public async Task ReadingMetric_ReturnsNull_WhenNoRowExists()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(DbName, MetricSchema);

        var metric = await NewService(storage).GetReadingMetricAsync(404);

        metric.Should().BeNull();
    }

    [Fact]
    public async Task ReadingMetric_ReturnsNull_WhenThePackPredatesTheTable()
    {
        await using var storage = new TestStorage();
        // A pre-#2607 pack: base schema only, no metric tables.
        await storage.CreateDatabaseAsync(DbName, PerekDataServiceTests.Schema);

        var metric = await NewService(storage).GetReadingMetricAsync(1);

        metric.Should().BeNull();
    }

    [Fact]
    public async Task ReadingMetric_DefaultsSourceHash_WhenTheStoredValueIsNull()
    {
        await using var storage = new TestStorage();
        // A pack generation whose source_hash column is nullable can persist
        // NULL — the model falls back to empty rather than surfacing null.
        var schema = MetricSchema
            .Select(s => s.Replace("source_hash TEXT NOT NULL", "source_hash TEXT"))
            .ToArray();
        var db = await storage.CreateDatabaseAsync(DbName, schema);
        await db.ExecuteAsync(
            "INSERT INTO tanah_perek_metric (perek_id, word_count, estimated_seconds, words_per_minute, calc_version, source_hash) " +
            "VALUES (1, 361, 99, 220, 1, NULL)");

        var metric = await NewService(storage).GetReadingMetricAsync(1);

        metric.Should().NotBeNull();
        metric!.SourceHash.Should().BeEmpty();
    }

    [Fact]
    public async Task PasukProgressUnits_ReturnOrderedWordCounts()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, MetricSchema);
        await db.ExecuteAsync(
            "INSERT INTO tanah_perek_pasuk_metric VALUES " +
            "(1, 2, 18, 48, 1, 'h2'),(1, 1, 30, 30, 1, 'h1'),(1, 3, 22, 70, 1, 'h3')," +
            "(9, 1, 5, 5, 1, 'other-perek')");

        var units = await NewService(storage).GetPasukProgressUnitsAsync(1);

        units.Should().HaveCount(3);
        units.Select(u => u.Key).Should().Equal("1", "2", "3");
        units.Select(u => u.WordCount).Should().Equal(30, 18, 22);
        units.Select(u => u.CumulativeWords).Should().Equal(30, 48, 70);
    }

    [Fact]
    public async Task PasukProgressUnits_ReturnEmpty_WhenThePackPredatesTheTable()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(DbName, PerekDataServiceTests.Schema);

        var units = await NewService(storage).GetPasukProgressUnitsAsync(1);

        units.Should().BeEmpty();
    }
}
