using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using SQLite;

namespace BibleOnSite.Tests.Services;

public class MasoraDataServiceTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    internal static readonly string[] Schema =
    [
        "CREATE TABLE tanah_sefer (id INTEGER, name TEXT, tanach_us_name TEXT, perek_id_from INTEGER, perek_id_to INTEGER)",
        "CREATE TABLE tanah_reading_division (division_id TEXT, contract_version INTEGER, root_path TEXT, label TEXT)",
        "CREATE TABLE tanah_reading_unit (division_id TEXT, unit_id INTEGER, slug TEXT, sefer_id INTEGER, unit_order INTEGER, heading TEXT, closing_break TEXT)",
        "CREATE TABLE tanah_reading_unit_range (division_id TEXT, unit_id INTEGER, range_index INTEGER, auxiliary_ordinal INTEGER, " +
            "start_perek_id INTEGER, start_pasuk INTEGER, start_segment_index INTEGER, " +
            "end_perek_id INTEGER, end_pasuk INTEGER, end_segment_index INTEGER)"
    ];

    private const string Seed = """
        INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,50),(8,'שמואל','{}',51,55);
        INSERT INTO tanah_reading_division VALUES ('masora',1,'/מסורה','מסורה על הפרק');
        INSERT INTO tanah_reading_unit VALUES
            ('masora',1,'1',1,1,'בראשית פרשה א','ptuha'),
            ('masora',2,'2',1,2,'בראשית פרשה ב','stuma'),
            ('masora',3,'3',1,3,'בראשית פרשה ג','stuma'),
            ('masora',9,'9',8,1,'שמואל פרשה א','ptuha');
        INSERT INTO tanah_reading_unit_range VALUES
            ('masora',1,0,NULL,1,1,NULL,1,5,3),
            ('masora',2,0,NULL,1,5,4,2,3,NULL),
            ('masora',3,0,NULL,2,4,NULL,2,8,NULL),
            ('masora',9,0,NULL,51,1,NULL,51,10,NULL);
        """;

    private static async Task<MasoraDataService> LoadedServiceAsync(TestStorage storage, string seed)
    {
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        foreach (var statement in seed.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await db.ExecuteAsync(statement);
        }
        var service = new MasoraDataService(new LocalDatabaseService(storage.FileSystem.Object));
        await service.LoadAsync();
        return service;
    }

    [Fact]
    public async Task UnloadedService_ReturnsEmptyDefaults()
    {
        await using var storage = new TestStorage();
        var service = new MasoraDataService(new LocalDatabaseService(storage.FileSystem.Object));

        service.IsLoaded.Should().BeFalse();
        service.IsAvailable.Should().BeFalse();
        service.Units.Should().BeNull();
        service.UnitCount.Should().Be(0);
        service.GetUnit(1).Should().BeNull();
        service.GetFirstUnitsBySefer().Should().BeEmpty();
        service.GetUnitIndex(1).Should().Be(-1);
        service.GetAdjacentUnits(1).Should().Be((null, null));
        service.GetUnitContainingPasuk(1).Should().BeNull();
        service.GetUnitContainingPasuk(1, 1).Should().BeNull();
    }

    [Fact]
    public void Instance_ReturnsSharedSingleton()
    {
        MasoraDataService.Instance.Should().BeSameAs(MasoraDataService.Instance);
    }

    [Fact]
    public async Task LoadAsync_ConcurrentAndRepeatCalls_LoadOnlyOnce()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        foreach (var statement in Seed.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            await db.ExecuteAsync(statement);
        }
        var service = new MasoraDataService(new LocalDatabaseService(storage.FileSystem.Object));

        // Concurrent callers funnel through the load lock — the second one
        // re-checks _isLoaded inside the lock and returns without reloading.
        await Task.WhenAll(service.LoadAsync(), service.LoadAsync());
        // Already loaded → fast-path early return.
        await service.LoadAsync();

        service.IsLoaded.Should().BeTrue();
        service.UnitCount.Should().Be(4);
    }

    [Fact]
    public async Task GetUnitContainingPasuk_SingleArg_UsesFirstPasuk()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed);

        service.GetUnitContainingPasuk(1)!.UnitId.Should().Be(1);
        service.GetUnitContainingPasuk(2)!.UnitId.Should().Be(2);
        service.GetUnitContainingPasuk(51)!.UnitId.Should().Be(9);
    }

    [Fact]
    public async Task Load_MultiRangeUnit_GroupsAllRangesOnOneUnit()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed + """
            INSERT INTO tanah_sefer VALUES (9,NULL,'x',60,61);
            INSERT INTO tanah_reading_unit VALUES
                ('masora',5,'5',1,4,'range span',NULL),
                ('masora',6,'6',9,1,'nameless sefer unit',NULL);
            INSERT INTO tanah_reading_unit_range VALUES
                ('masora',5,0,NULL,4,1,NULL,4,2,NULL),
                ('masora',5,1,NULL,4,4,NULL,4,6,NULL),
                ('masora',6,0,NULL,60,1,NULL,60,1,NULL);
            """);

        var unit = service.GetUnit(5)!;
        unit.Ranges.Should().HaveCount(2);
        // Containment checks every range of the unit.
        service.GetUnitContainingPasuk(4, 1)!.UnitId.Should().Be(5);
        service.GetUnitContainingPasuk(4, 5)!.UnitId.Should().Be(5);
        service.GetUnitContainingPasuk(4, 3).Should().BeNull();
        // A sefer row with a NULL name maps to an empty display name.
        service.GetUnit(6)!.SeferName.Should().BeEmpty();
    }

    [Fact]
    public async Task Load_MapsUnitsWithRangesAndSeferNames()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed);

        service.IsLoaded.Should().BeTrue();
        service.IsAvailable.Should().BeTrue();
        service.UnitCount.Should().Be(4);

        var unit = service.GetUnit(2)!;
        unit.Slug.Should().Be("2");
        unit.SeferName.Should().Be("בראשית");
        unit.UnitOrder.Should().Be(2);
        unit.Heading.Should().Be("בראשית פרשה ב");
        unit.ClosingBreak.Should().Be("stuma");
        unit.ClosingBreakLabel.Should().Be("פרשה סתומה");
        unit.HasClosingBreak.Should().BeTrue();
        unit.Ranges.Should().ContainSingle();
        unit.Ranges[0].StartPerekId.Should().Be(1);
        unit.Ranges[0].StartPasuk.Should().Be(5);
        unit.Ranges[0].StartSegmentIndex.Should().Be(4);
        unit.Ranges[0].EndPerekId.Should().Be(2);
        unit.Ranges[0].EndPasuk.Should().Be(3);
        unit.Ranges[0].EndSegmentIndex.Should().BeNull();
    }

    [Fact]
    public async Task Load_MissingTables_LeavesServiceUnavailable()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(DbName, "CREATE TABLE tanah_sefer (id INTEGER, name TEXT)");
        var service = new MasoraDataService(new LocalDatabaseService(storage.FileSystem.Object));

        // An older packaged database without reading-unit tables must not crash the app.
        await service.LoadAsync();

        service.IsLoaded.Should().BeTrue();
        service.IsAvailable.Should().BeFalse();
        service.UnitCount.Should().Be(0);
    }

    [Fact]
    public async Task Load_EmptyDivision_MarksUnavailable()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage,
            "INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,50)");

        service.IsLoaded.Should().BeTrue();
        service.IsAvailable.Should().BeFalse();
        service.UnitCount.Should().Be(0);
        service.GetUnit(1).Should().BeNull();
        service.GetFirstUnitsBySefer().Should().BeEmpty();
        service.GetUnitIndex(1).Should().Be(-1);
        service.GetAdjacentUnits(1).Should().Be((null, null));
        service.GetUnitContainingPasuk(1, 1).Should().BeNull();
    }

    [Fact]
    public async Task GetUnitIndex_ReturnsCanonicalPositionInUnitsList()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed);

        // Seed order is unit_id order: 1, 2, 3, 9 — gaps don't shift indexes.
        service.GetUnitIndex(1).Should().Be(0);
        service.GetUnitIndex(3).Should().Be(2);
        service.GetUnitIndex(9).Should().Be(3);
        service.GetUnitIndex(77).Should().Be(-1);
    }

    [Fact]
    public async Task GetAdjacentUnits_ReturnsCanonicalNeighbors()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed);

        var (prev, next) = service.GetAdjacentUnits(2);
        prev!.UnitId.Should().Be(1);
        next!.UnitId.Should().Be(3);

        service.GetAdjacentUnits(1).Prev.Should().BeNull();
        service.GetAdjacentUnits(9).Next.Should().BeNull();
        service.GetAdjacentUnits(77).Should().Be((null, null));
    }

    [Fact]
    public async Task GetFirstUnitsBySefer_ReturnsOpeningUnits()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed);

        service.GetFirstUnitsBySefer().Select(u => u.UnitId).Should().Equal(1, 9);
    }

    [Fact]
    public async Task GetUnitContainingPasuk_ResolvesBothIntraPasukAndWholePasukBounds()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed);

        // Pasuk 5's first segments close unit 1 (ends at segment 3 mid-pasuk).
        service.GetUnitContainingPasuk(1, 5)!.UnitId.Should().Be(1);
        // Pasuk 6 is wholly inside unit 2.
        service.GetUnitContainingPasuk(1, 6)!.UnitId.Should().Be(2);
        // Cross-perek: perek 2 pasuk 2 sits inside unit 2's range.
        service.GetUnitContainingPasuk(2, 2)!.UnitId.Should().Be(2);
        // Unit 3 starts at perek 2 pasuk 4.
        service.GetUnitContainingPasuk(2, 4)!.UnitId.Should().Be(3);
        service.GetUnitContainingPasuk(9, 1).Should().BeNull();
    }

    [Fact]
    public async Task GetUnitContainingPasuk_OverlappingRanges_FirstCanonicalUnitWins()
    {
        await using var storage = new TestStorage();
        var service = await LoadedServiceAsync(storage, Seed + """
            INSERT INTO tanah_reading_unit VALUES ('masora',10,'10',8,2,'overlap',NULL);
            INSERT INTO tanah_reading_unit_range VALUES ('masora',10,0,NULL,51,5,NULL,51,8,NULL);
            """);

        // Unit 9 covers (51,1)-(51,10); overlapping unit 10 sits later in
        // canonical order, so unit 9 keeps the shared pesukim — identical
        // precedence to the previous linear FirstOrDefault over Units.
        service.GetUnitContainingPasuk(51, 6)!.UnitId.Should().Be(9);
        service.GetUnitContainingPasuk(51, 5)!.UnitId.Should().Be(9);
        service.GetUnitContainingPasuk(51, 9)!.UnitId.Should().Be(9);
    }

    [Fact]
    public void RangeContainsPasuk_SegmentBoundsKeepPasukLevelPrecision()
    {
        // Range ending mid-pasuk claims the boundary pasuk (pasuk-level
        // commentary attaches to every touched pasuk).
        var endsMidPasuk = new MasoraUnitRange
        {
            StartPerekId = 1, StartPasuk = 1,
            EndPerekId = 1, EndPasuk = 5, EndSegmentIndex = 3
        };
        MasoraDataService.RangeContainsPasuk(endsMidPasuk, 1, 5).Should().BeTrue();
        MasoraDataService.RangeContainsPasuk(endsMidPasuk, 1, 6).Should().BeFalse();

        // A range starting mid-pasuk does not claim that pasuk's leading
        // segments — the pasuk counts as contained only in the earlier unit.
        var startsMidPasuk = new MasoraUnitRange
        {
            StartPerekId = 1, StartPasuk = 5, StartSegmentIndex = 4,
            EndPerekId = 1, EndPasuk = 9
        };
        MasoraDataService.RangeContainsPasuk(startsMidPasuk, 1, 5).Should().BeFalse();
        MasoraDataService.RangeContainsPasuk(startsMidPasuk, 1, 6).Should().BeTrue();
    }

    /// <summary>
    /// Locates the tracked packaged tanah_view database under
    /// BibleOnSite/Resources/Raw (same project-root walk as
    /// LocalDatabaseServiceTests).
    /// </summary>
    private static string? FindPackagedDbPath()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir != null && !Directory.Exists(Path.Join(dir.FullName, "BibleOnSite")))
        {
            dir = dir.Parent;
        }

        return dir == null
            ? null
            : Path.Join(dir.FullName, "BibleOnSite", "Resources", "Raw", DbName);
    }

    [Fact]
    public async Task PackagedAsset_MasoraHeadings_CarryParashaIdentity()
    {
        // The app reads `heading` verbatim from the packaged tanah_view
        // database, so the tracked asset itself must carry parasha-identity
        // headings — fresh test fixtures cannot catch a stale package.
        // Regenerate with `cd data && cargo make generate-tanah-view-sqlite-from-json`.
        var dbPath = FindPackagedDbPath();
        Assert.SkipUnless(dbPath != null && File.Exists(dbPath), "Packaged tanah_view database not present");

        var db = new SQLiteAsyncConnection(dbPath, SQLiteOpenFlags.ReadOnly);
        try
        {
            var unitCount = await db.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM tanah_reading_unit WHERE division_id = 'masora'");
            unitCount.Should().Be(3197);

            // Every heading is the parasha identity "<sefer name> פרשה <ordinal>" —
            // a scripture-reference span (e.g. "בראשית א א-ה") fails this check.
            var nonParashaHeadings = await db.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM tanah_reading_unit u " +
                "JOIN tanah_sefer s ON s.id = u.sefer_id " +
                "WHERE u.division_id = 'masora' AND u.heading NOT LIKE s.name || ' פרשה %'");
            nonParashaHeadings.Should().Be(0);

            var firstHeading = await db.ExecuteScalarAsync<string>(
                "SELECT heading FROM tanah_reading_unit WHERE division_id = 'masora' AND unit_id = 1");
            firstHeading.Should().Be("בראשית פרשה א");
        }
        finally
        {
            await db.CloseAsync();
        }
    }
}
