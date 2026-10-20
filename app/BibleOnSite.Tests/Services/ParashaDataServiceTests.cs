using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using System.Reflection;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// פרשה על הפרק export consumption: units, ordered Haftarah auxiliaries,
/// and canonical range clipping against the shared contract tables.
/// </summary>
public class ParashaDataServiceTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    internal static readonly string[] Schema =
    [
        "CREATE TABLE tanah_sefer (id INTEGER, name TEXT, tanach_us_name TEXT, perek_id_from INTEGER, perek_id_to INTEGER)",
        "CREATE TABLE tanah_perek (id INTEGER, perek INTEGER, header TEXT)",
        "CREATE TABLE tanah_additional (id INTEGER, sefer_id INTEGER, perek_from INTEGER, perek_to INTEGER, letter TEXT, tanach_us_name TEXT)",
        "CREATE TABLE tanah_perek_date (perek_id INTEGER, cycle INTEGER, date TEXT, hebdate TEXT, star_rise TEXT)",
        "CREATE TABLE tanah_pasuk_segment (id INTEGER, perek_id INTEGER, pasuk_id INTEGER, segment_type TEXT)",
        "CREATE TABLE tanah_pasuk_segment_value (id INTEGER, value TEXT)",
        "CREATE TABLE tanah_pasuk_segment_qri_ktiv_offset (id INTEGER, qri_ktiv_offset INTEGER)",
        "CREATE TABLE tanah_reading_division (id TEXT PRIMARY KEY, contract_version INTEGER, root_path TEXT, menu_label TEXT)",
        "CREATE TABLE tanah_reading_unit (division_id TEXT, unit_id INTEGER, slug TEXT, sefer_id INTEGER, unit_order INTEGER, heading TEXT, closing_break TEXT)",
        "CREATE TABLE tanah_reading_unit_range (id INTEGER PRIMARY KEY AUTOINCREMENT, division_id TEXT, unit_id INTEGER, range_index INTEGER, auxiliary_ordinal INTEGER, auxiliary_id TEXT, auxiliary_label TEXT, start_perek_id INTEGER, start_pasuk INTEGER, start_segment_index INTEGER, end_perek_id INTEGER, end_pasuk INTEGER, end_segment_index INTEGER)"
    ];

    /// <summary>
    /// Seeds two sefarim (בראשית perakim 1-3, ישעיהו perakim 4-5) with
    /// five pesukim each, plus two parasha units: unit 1 reads בראשית
    /// א ב - ג ד with an ordered אשכנזים two-range Haftarah (a perek
    /// jump) and a תימנים variant; unit 2 follows it.
    /// </summary>
    internal static async Task<TestStorage> SeedAsync(TestStorage storage)
    {
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,3),(16,'ישעיהו','Isaiah',4,5)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,'h1'),(2,2,'h2'),(3,3,'h3'),(4,40,'h40'),(5,41,'h41')");
        var segmentId = 0;
        for (var perekId = 1; perekId <= 5; perekId++)
        {
            for (var pasukId = 1; pasukId <= 5; pasukId++)
            {
                segmentId++;
                await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (?,?,?,'qri')", segmentId, perekId, pasukId);
                await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (?,?)", segmentId, $"word{perekId}-{pasukId}");
            }
        }

        await db.ExecuteAsync("INSERT INTO tanah_reading_division VALUES ('parasha',1,'/פרשה','פרשה על הפרק')");
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit VALUES " +
            "('parasha',1,'1',1,1,'בראשית',NULL)," +
            "('parasha',2,'2',1,2,'נח',NULL)");
        // Unit 1: primary Torah range בראשית א ב - ג ד.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',1,0,NULL,NULL,NULL,1,2,NULL,3,4,NULL)");
        // Unit 1 auxiliaries in source order: אשכנזים (two ranges with a
        // perek jump), then תימנים (single range).
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',1,0,0,'haftara-ashkenazi','אשכנזים',4,1,NULL,4,3,NULL)," +
            "('parasha',1,1,0,'haftara-ashkenazi','אשכנזים',5,1,NULL,5,1,NULL)," +
            "('parasha',1,0,1,'haftara-temani','תימנים',4,2,NULL,5,2,NULL)");
        // Unit 2: a plain unit with one variant.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',2,0,NULL,NULL,NULL,3,5,NULL,3,5,NULL)," +
            "('parasha',2,0,0,'haftara-sefaradi','ספרדים',4,1,NULL,4,1,NULL)");
        return storage;
    }

    /// <summary>
    /// Edge fixtures for the reader's label and guard paths: a
    /// single-perek multi-pasuk unit, a cross-sefer range, ranges whose
    /// start or end perek is absent from the catalog, a same-sefer
    /// additional split (שמואל א/ב), a unit with no range rows at all
    /// (the LEFT JOIN null row), and degenerate rows exercising the
    /// guard's remaining operands plus NULL auxiliary labels.
    /// </summary>
    private static async Task<TestStorage> SeedEdgeAsync(TestStorage storage)
    {
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES " +
            "(1,'בראשית','Genesis',1,3),(9,'שמואל','Samuel',6,7),(16,'ישעיהו','Isaiah',4,5)");
        // שמואל splits into two additionals over perakim 6-7.
        await db.ExecuteAsync("INSERT INTO tanah_additional VALUES " +
            "(1,9,6,6,'א','Samuel I'),(2,9,7,7,'ב','Samuel II')");
        // Perek 5 stays inside ישעיהו's span but gets no tanah_perek row.
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES " +
            "(1,1,'h1'),(2,2,'h2'),(3,3,'h3'),(4,40,'h40'),(6,1,'sh-a'),(7,1,'sh-b')");
        var segmentId = 0;
        for (var perekId = 1; perekId <= 7; perekId++)
        {
            for (var pasukId = 1; pasukId <= 5; pasukId++)
            {
                segmentId++;
                await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (?,?,?,'qri')", segmentId, perekId, pasukId);
                await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (?,?)", segmentId, $"word{perekId}-{pasukId}");
            }
        }

        await db.ExecuteAsync("INSERT INTO tanah_reading_division VALUES ('parasha',1,'/פרשה','פרשה על הפרק')");
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit VALUES " +
            "('parasha',1,'1',1,1,'מקוצרת',NULL)," +
            "('parasha',2,'2',1,2,'חוצה',NULL)," +
            "('parasha',3,'3',1,3,'מבט',NULL)," +
            "('parasha',4,'4',1,4,'פתיחה',NULL)," +
            "('parasha',5,'5',9,1,'מחולקת',NULL)," +
            "('parasha',6,'6',9,2,'ריקה',NULL)," +
            "('parasha',7,'7',9,3,'שומר',NULL)");

        // Unit 1: one perek, several pesukim — "בראשית ב ב-ד".
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',1,0,NULL,NULL,NULL,2,2,NULL,2,4,NULL)");
        // Unit 2: a sefer jump — בראשית ג to ישעיהו מ.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',2,0,NULL,NULL,NULL,3,1,NULL,4,2,NULL)");
        // Unit 3: ends on perek 8, which the catalog does not carry.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',3,0,NULL,NULL,NULL,3,1,NULL,8,2,NULL)");
        // Unit 4: starts on perek 5 — inside ישעיהו's span but with no
        // tanah_perek row, so the catalog never materializes it. (A
        // start_perek_id of 0 would be indistinguishable from the LEFT
        // JOIN null row the guard intentionally skips.)
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',4,0,NULL,NULL,NULL,5,1,NULL,6,1,NULL)");
        // Unit 5: same sefer, different additionals — שמואל א to שמואל ב.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',5,0,NULL,NULL,NULL,6,1,NULL,7,1,NULL)");
        // Unit 6: no range rows — the LEFT JOIN emits one NULL-range row.
        // Unit 7: a normal primary range plus degenerate rows that hit the
        // guard's remaining operands, and an auxiliary with NULL columns.
        await db.ExecuteAsync("INSERT INTO tanah_reading_unit_range " +
            "(division_id,unit_id,range_index,auxiliary_ordinal,auxiliary_id,auxiliary_label," +
            "start_perek_id,start_pasuk,start_segment_index,end_perek_id,end_pasuk,end_segment_index) VALUES " +
            "('parasha',7,0,NULL,NULL,NULL,1,1,NULL,1,1,NULL)," +
            "('parasha',7,5,NULL,NULL,NULL,0,1,NULL,0,1,NULL)," +
            "('parasha',7,0,0,'haftara-x','מנהג',0,1,NULL,0,1,NULL)," +
            "('parasha',7,1,1,NULL,NULL,4,1,NULL,4,1,NULL)");
        return storage;
    }

    private static (ParashaDataService Parasha, PerekDataService Perakim) Services(TestStorage storage)
    {
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        return (new ParashaDataService(localDb), new PerekDataService(localDb));
    }

    [Fact]
    public async Task Load_MapsUnits_PrimaryRange_AndOrderedAuxiliaries()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, _) = Services(storage);

        parasha.IsLoaded.Should().BeFalse();
        await parasha.LoadAsync();

        parasha.IsLoaded.Should().BeTrue();
        parasha.Parashiot.Should().HaveCount(2);

        var first = parasha.GetParasha(1)!;
        first.Heading.Should().Be("בראשית");
        first.SeferId.Should().Be(1);
        first.Order.Should().Be(1);
        first.Slug.Should().Be("1");
        first.TorahRange.StartPerekId.Should().Be(1);
        first.TorahRange.StartPasuk.Should().Be(2);
        first.TorahRange.EndPerekId.Should().Be(3);
        first.TorahRange.EndPasuk.Should().Be(4);

        // Both variants kept, in source order, with their own ordered
        // ranges — never flattened into one default reading.
        first.Haftarot.Should().HaveCount(2);
        first.Haftarot[0].Id.Should().Be("haftara-ashkenazi");
        first.Haftarot[0].Label.Should().Be("אשכנזים");
        first.Haftarot[0].Ranges.Should().HaveCount(2);
        first.Haftarot[0].Ranges[0].EndPerekId.Should().Be(4);
        first.Haftarot[0].Ranges[0].EndPasuk.Should().Be(3);
        first.Haftarot[0].Ranges[1].StartPerekId.Should().Be(5);
        first.Haftarot[1].Id.Should().Be("haftara-temani");
        first.Haftarot[1].Ranges.Should().ContainSingle();
        first.Haftarot[1].Ranges[0].EndPerekId.Should().Be(5);
        first.Haftarot[1].Ranges[0].EndPasuk.Should().Be(2);

        var second = parasha.GetParasha(2)!;
        second.Heading.Should().Be("נח");
        second.Haftarot.Should().ContainSingle();
        parasha.GetParasha(99).Should().BeNull();
    }

    /// <summary>
    /// Builds a reader view-model against the seeded storage — injects the
    /// perush services so the singletons never touch a real filesystem.
    /// </summary>
    private static BibleOnSite.ViewModels.ParashaViewModel Reader(
        ParashaDataService parasha, PerekDataService perakim, TestStorage storage)
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        preferences.Load();
        return new BibleOnSite.ViewModels.ParashaViewModel(
            parasha, perakim, preferences,
            new PerushimCatalogService(storage.FileSystem.Object),
            new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object),
            _ => Task.FromResult(new List<Article>()));
    }

    [Fact]
    public async Task ViewModel_BuildsTorahAndHaftarahSections_WithClippedPesukim()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var viewModel = Reader(parasha, perakim, storage);

        await viewModel.LoadByUnitIdAsync(1);

        viewModel.Title.Should().Be("פרשת בראשית");
        viewModel.Source.Should().Be("בראשית א ב - ג ד"); // same-sefer span: end keeps perek letters only
        viewModel.CanGoToNextUnit.Should().BeTrue();
        viewModel.CanGoToPreviousUnit.Should().BeFalse();
        viewModel.CarouselUnits.Should().HaveCount(2);

        var items = viewModel.Unit!.Rows;
        items[0].IsSectionHeader.Should().BeTrue();
        items[0].Text.Should().Be("תורה");

        // Perek subheaders carry the canonical source labels.
        items[1].IsPerekHeader.Should().BeTrue();
        items[1].Text.Should().Be("בראשית א");

        // The Torah range is clipped: בראשית א contributes pesukim 2-5,
        // בראשית ב all five, בראשית ג pesukim 1-4.
        var torahPesukim = items
            .TakeWhile(item => !item.IsSectionHeader || item == items[0])
            .Where(item => item.Pasuk is not null)
            .Select(item => item.Pasuk!.PasukNum)
            .ToList();
        torahPesukim.Should().Equal(2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4);

        // Canonical perek ids stay on every row — the reader keys selection,
        // perushim and recitation by (perekId, pasukNum).
        items.Where(item => item.Pasuk is not null).Select(item => item.PerekId)
            .Should().Equal(1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3,
                4, 4, 4, 5, 4, 4, 4, 4, 5, 5);

        // Haftarah variants appear after the Torah section, each labeled
        // and rendering its own ordered ranges — the אשכנזים jump from
        // perek 4 to perek 5 keeps range order without filling gaps.
        var ashkenaziHeaderIndex = items.FindIndex(item => item.Text == "הפטרה - אשכנזים");
        ashkenaziHeaderIndex.Should().BeGreaterThan(0);
        var temaniHeaderIndex = items.FindIndex(item => item.Text == "הפטרה - תימנים");
        temaniHeaderIndex.Should().BeGreaterThan(ashkenaziHeaderIndex);

        var ashkenaziSection = items.Skip(ashkenaziHeaderIndex + 1).Take(temaniHeaderIndex - ashkenaziHeaderIndex - 1).ToList();
        ashkenaziSection.Where(i => i.IsPerekHeader).Select(i => i.Text)
            .Should().Equal("ישעיהו א", "ישעיהו ב");
        ashkenaziSection.Where(i => i.Pasuk is not null).Select(i => i.Pasuk!.PasukNum)
            .Should().Equal(1, 2, 3, 1);

        var temaniSection = items.Skip(temaniHeaderIndex + 1).ToList();
        temaniSection.Where(i => i.Pasuk is not null).Select(i => i.Pasuk!.PasukNum)
            .Should().Equal(2, 3, 4, 5, 1, 2);
    }

    [Fact]
    public async Task ViewModel_NextAndPrevious_NavigateUnitIdentities()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var viewModel = Reader(parasha, perakim, storage);

        await viewModel.LoadByUnitIdAsync(1);
        await viewModel.LoadNextCommand.ExecuteAsync(null);

        viewModel.Title.Should().Be("פרשת נח");
        viewModel.UnitId.Should().Be(2);
        viewModel.CanGoToNextUnit.Should().BeFalse();
        viewModel.CanGoToPreviousUnit.Should().BeTrue();
        viewModel.Unit!.Rows.Should().NotBeEmpty();

        await viewModel.LoadPreviousCommand.ExecuteAsync(null);
        viewModel.Title.Should().Be("פרשת בראשית");
        viewModel.UnitId.Should().Be(1);
    }

    [Fact]
    public async Task ListViewModel_GroupsUnitsByTorahSefer()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var navigator = new Moq.Mock<IAppNavigator>();
        var viewModel = new BibleOnSite.ViewModels.ParashaListViewModel(parasha, perakim, navigator.Object);

        await viewModel.LoadAsync();

        viewModel.Groups.Should().ContainSingle();
        viewModel.Groups[0].SeferName.Should().Be("בראשית");
        viewModel.Groups[0].Select(unit => unit.Heading).Should().Equal("בראשית", "נח");

        await viewModel.OpenParashaCommand.ExecuteAsync(viewModel.Groups[0][1]);
        navigator.Verify(n => n.GoToAsync("ParashaPage?unitId=2"), Moq.Times.Once);
    }

    [Fact]
    public void PasukBoundsForPerek_ClipsOnlyBoundaryPerakim()
    {
        var range = new ScriptureRange { StartPerekId = 1, StartPasuk = 2, EndPerekId = 3, EndPasuk = 4 };

        ParashaDataService.PasukBoundsForPerek(range, 0).Should().BeNull();
        ParashaDataService.PasukBoundsForPerek(range, 4).Should().BeNull();
        ParashaDataService.PasukBoundsForPerek(range, 1).Should().Be((2, int.MaxValue));
        ParashaDataService.PasukBoundsForPerek(range, 2).Should().Be((1, int.MaxValue));
        ParashaDataService.PasukBoundsForPerek(range, 3).Should().Be((1, 4));
    }

    [Fact]
    public void ClipPasukim_ReturnsEmpty_WhenPerekOutsideRange()
    {
        var range = new ScriptureRange { StartPerekId = 1, StartPasuk = 2, EndPerekId = 3, EndPasuk = 4 };
        var pasukim = new List<Pasuk> { new() { PasukNum = 1, Text = "word" } };

        ParashaDataService.ClipPasukim(pasukim, range, 0).Should().BeEmpty();
        ParashaDataService.ClipPasukim(pasukim, range, 4).Should().BeEmpty();
        ParashaDataService.ClipPasukim(pasukim, range, 2).Should().ContainSingle();
    }

    [Fact]
    public async Task GetParasha_BeforeLoad_ReturnsNull()
    {
        await using var storage = new TestStorage();
        var (parasha, _) = Services(storage);

        parasha.GetParasha(1).Should().BeNull();
        parasha.Parashiot.Should().BeNull();
    }

    [Fact]
    public async Task Load_SecondCallerBehindLock_ReturnsWithoutReloading()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, _) = Services(storage);

        // Hold the load lock so a second caller reaches the inner
        // double-checked `_isLoaded` instead of the fast path.
        var loadLock = (SemaphoreSlim)typeof(ParashaDataService)
            .GetField("_loadLock", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(parasha)!;
        var isLoadedField = typeof(ParashaDataService)
            .GetField("_isLoaded", BindingFlags.NonPublic | BindingFlags.Instance)!;
        await loadLock.WaitAsync(TestContext.Current.CancellationToken);
        var pending = parasha.LoadAsync(); // passes the outer check, parks on the lock
        isLoadedField.SetValue(parasha, true);
        loadLock.Release();

        await pending;
        parasha.IsLoaded.Should().BeTrue();
        // The inner return skips the query — the catalog stays unpublished.
        parasha.Parashiot.Should().BeNull();
    }

    [Fact]
    public void ViewModels_ParameterlessCtors_ResolveSingletons()
    {
        // The parameterless ctor resolves the singletons — preferences must
        // be initialized the way app startup does.
        PreferencesService.Initialize(new InMemoryPreferencesStorage());
        new BibleOnSite.ViewModels.ParashaViewModel().Should().NotBeNull();
        new BibleOnSite.ViewModels.ParashaListViewModel().Should().NotBeNull();
        ParashaDataService.Instance.Should().BeSameAs(ParashaDataService.Instance);
    }

    [Fact]
    public async Task ViewModel_UnknownUnit_KeepsReaderState()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var viewModel = Reader(parasha, perakim, storage);

        // An unknown unit id is a navigation no-op — the reader keeps the
        // unit on screen instead of blanking it.
        await viewModel.LoadByUnitIdAsync(999);
        viewModel.Unit.Should().BeNull();
        viewModel.Title.Should().BeEmpty();
        viewModel.Source.Should().BeEmpty();

        await viewModel.LoadByUnitIdAsync(1);
        await viewModel.LoadByUnitIdAsync(999);

        viewModel.UnitId.Should().Be(1);
        viewModel.Title.Should().Be("פרשת בראשית");
        viewModel.Source.Should().Be("בראשית א ב - ג ד");
        viewModel.Unit!.Rows.Should().NotBeEmpty();
        viewModel.CanGoToNextUnit.Should().BeTrue();
        viewModel.CanGoToPreviousUnit.Should().BeFalse();
    }

    [Fact]
    public async Task ListViewModel_SecondLoad_KeepsLoadedGroups()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, perakim) = Services(storage);
        var navigator = new Moq.Mock<IAppNavigator>();
        var viewModel = new BibleOnSite.ViewModels.ParashaListViewModel(parasha, perakim, navigator.Object);

        await viewModel.LoadAsync();
        var loaded = viewModel.Groups;
        await viewModel.LoadAsync();

        viewModel.Groups.Should().BeSameAs(loaded);
    }

    [Fact]
    public async Task ListViewModel_UnloadedCatalog_YieldsNoGroups()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var parasha = new ParashaDataService(localDb);
        // A concurrent caller that sees _isLoaded under the lock exits
        // without publishing — Parashiot stays null for later readers.
        typeof(ParashaDataService)
            .GetField("_isLoaded", BindingFlags.NonPublic | BindingFlags.Instance)!
            .SetValue(parasha, true);
        var viewModel = new BibleOnSite.ViewModels.ParashaListViewModel(
            parasha, new PerekDataService(localDb), new Moq.Mock<IAppNavigator>().Object);

        await viewModel.LoadAsync();

        parasha.Parashiot.Should().BeNull();
        viewModel.Groups.Should().BeEmpty();
    }

    [Fact]
    public async Task Load_UnitWithoutRanges_OrDegenerateRows_StillMaterializes()
    {
        await using var storage = new TestStorage();
        await SeedEdgeAsync(storage);
        var (parasha, _) = Services(storage);

        await parasha.LoadAsync();

        // The LEFT JOIN null row yields the unit shell without a range.
        var shell = parasha.GetParasha(6)!;
        shell.Heading.Should().Be("ריקה");
        shell.TorahRange.StartPerekId.Should().Be(0);
        shell.Haftarot.Should().BeEmpty();

        // Degenerate start_perek_id=0 rows that survive the guard flow
        // through as regular primary/auxiliary data.
        var guarded = parasha.GetParasha(7)!;
        guarded.TorahRange.StartPerekId.Should().Be(0);
        guarded.Haftarot.Should().HaveCount(2);
        guarded.Haftarot[0].Id.Should().Be("haftara-x");
        guarded.Haftarot[0].Ranges.Should().ContainSingle();
        // NULL auxiliary columns fall back to empty strings.
        guarded.Haftarot[1].Id.Should().BeEmpty();
        guarded.Haftarot[1].Label.Should().BeEmpty();
        guarded.Haftarot[1].Ranges[0].StartPerekId.Should().Be(4);
    }

    [Fact]
    public async Task ViewModel_RangeLabel_FormatsEveryBoundaryShape()
    {
        await using var storage = new TestStorage();
        await SeedEdgeAsync(storage);
        var (parasha, perakim) = Services(storage);
        var viewModel = Reader(parasha, perakim, storage);

        // Same perek, several pesukim.
        await viewModel.LoadByUnitIdAsync(1);
        viewModel.Source.Should().Be("בראשית ב ב-ד");

        // Sefer jump — the end keeps its full source.
        await viewModel.LoadByUnitIdAsync(2);
        viewModel.Source.Should().Be("בראשית ג א - ישעיהו א ב");

        // End perek missing from the catalog — the end ref stays empty.
        await viewModel.LoadByUnitIdAsync(3);
        viewModel.Source.Should().Be("בראשית ג א -  ב");
        viewModel.Unit!.Rows.Where(item => item.IsPerekHeader).Select(item => item.Text)
            .Should().Contain(string.Empty);

        // Start perek missing — the start ref stays empty while the end resolves.
        await viewModel.LoadByUnitIdAsync(4);
        viewModel.Source.Should().Be(" א - שמואל א א א");

        // Same sefer but different additionals — שמואל א to שמואל ב.
        await viewModel.LoadByUnitIdAsync(5);
        viewModel.Source.Should().Be("שמואל א א א - שמואל ב א א");
    }

    [Fact]
    public async Task ListViewModel_MissingStartPerek_GroupsUnderEmptySefer()
    {
        await using var storage = new TestStorage();
        await SeedEdgeAsync(storage);
        var (parasha, perakim) = Services(storage);
        var viewModel = new BibleOnSite.ViewModels.ParashaListViewModel(
            parasha, perakim, new Moq.Mock<IAppNavigator>().Object);

        await viewModel.LoadAsync();

        // Units 4, 6, and 7 start on perakim the catalog does not carry.
        viewModel.Groups.Select(group => group.SeferName).Should()
            .Equal("בראשית", string.Empty, "שמואל", string.Empty);
        var unnamed = viewModel.Groups.Where(group => group.SeferName == string.Empty).ToList();
        unnamed[0].Select(unit => unit.UnitId).Should().Equal(4);
        unnamed[1].Select(unit => unit.UnitId).Should().Equal(6, 7);
    }

    [Fact]
    public void BeforeLoad_NavigationSurfaceStaysInert()
    {
        var parasha = new ParashaDataService(new LocalDatabaseService(new TestStorage().FileSystem.Object));

        parasha.IsLoaded.Should().BeFalse();
        parasha.IsAvailable.Should().BeFalse();
        parasha.UnitCount.Should().Be(0);
        parasha.GetUnitIndex(1).Should().Be(-1);
        parasha.GetAdjacentUnits(1).Should().Be((null, null));
        parasha.GetParashaContainingPasuk(1, 1).Should().BeNull();
    }

    [Fact]
    public async Task Load_AvailabilityCountersAndAdjacency_FollowTheCatalog()
    {
        await using var storage = new TestStorage();
        await SeedAsync(storage);
        var (parasha, _) = Services(storage);

        await parasha.LoadAsync();

        parasha.IsAvailable.Should().BeTrue();
        parasha.UnitCount.Should().Be(2);
        var (prev, next) = parasha.GetAdjacentUnits(1);
        prev.Should().BeNull();
        next!.UnitId.Should().Be(2);
        parasha.GetAdjacentUnits(2).Prev!.UnitId.Should().Be(1);
        parasha.GetAdjacentUnits(2).Next.Should().BeNull();
        // A unit id outside the catalog resolves to no adjacency at all.
        parasha.GetAdjacentUnits(99).Should().Be((null, null));
        parasha.GetUnitIndex(99).Should().Be(-1);
    }

    [Fact]
    public async Task Load_DatabaseWithoutReadingUnitTables_ReportsUnavailable()
    {
        await using var storage = new TestStorage();
        // A pre-export database carries perek content but no contract tables.
        await storage.CreateDatabaseAsync(DbName,
            "CREATE TABLE tanah_sefer (id INTEGER, name TEXT, tanach_us_name TEXT, perek_id_from INTEGER, perek_id_to INTEGER)");
        var (parasha, _) = Services(storage);

        await parasha.LoadAsync();

        parasha.IsLoaded.Should().BeTrue();
        parasha.IsAvailable.Should().BeFalse();
        parasha.Parashiot.Should().BeEmpty();
    }

    [Fact]
    public void RangeContainsPasuk_IncludesOnlyInclusiveWholePasukBounds()
    {
        var range = new ScriptureRange { StartPerekId = 1, StartPasuk = 2, EndPerekId = 3, EndPasuk = 4 };

        ParashaDataService.RangeContainsPasuk(range, 1, 1).Should().BeFalse();
        ParashaDataService.RangeContainsPasuk(range, 1, 2).Should().BeTrue();
        ParashaDataService.RangeContainsPasuk(range, 2, 1).Should().BeTrue();
        ParashaDataService.RangeContainsPasuk(range, 3, 4).Should().BeTrue();
        ParashaDataService.RangeContainsPasuk(range, 3, 5).Should().BeFalse();
        ParashaDataService.RangeContainsPasuk(range, 0, 9).Should().BeFalse();
        ParashaDataService.RangeContainsPasuk(range, 4, 1).Should().BeFalse();
    }

    [Fact]
    public void PerekIdsForRange_EnumeratesEveryCoveredPerekInOrder()
    {
        var range = new ScriptureRange { StartPerekId = 4, EndPerekId = 6 };

        ParashaDataService.PerekIdsForRange(range).Should().Equal(4, 5, 6);
    }
}
