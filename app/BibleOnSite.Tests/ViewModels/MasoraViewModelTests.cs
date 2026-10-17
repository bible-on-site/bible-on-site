using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using SQLite;

namespace BibleOnSite.Tests.ViewModels;

public class MasoraViewModelTests
{
    private const string BibleDb = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    private sealed class Fixture : IAsyncDisposable
    {
        public TestStorage Storage { get; } = new();
        public InMemoryPreferencesStorage Prefs { get; } = new();
        public MasoraDataService MasoraService { get; }
        public MasoraViewModel Model { get; }
        private readonly bool _includeCatalog;
        private readonly bool _includeNotes;

        public Fixture(List<Article>? articles = null, int? lastLearntPerek = null,
            bool includeCatalog = true, bool includeNotes = true, bool nullArticlesLoader = false,
            Func<int, Task<List<Article>>>? articlesLoader = null,
            Func<LocalDatabaseService, PerekDataService>? perekDataServiceFactory = null)
        {
            _includeCatalog = includeCatalog;
            _includeNotes = includeNotes;
            if (lastLearntPerek is int lastLearnt)
            {
                // PreferencesService caches LastLearntPerek at construction — set first.
                Prefs.Set("lastLearntPerek", lastLearnt);
            }
            var catalog = new PerushimCatalogService(Storage.FileSystem.Object);
            var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, Storage.FileSystem.Object);
            var preferences = PreferencesService.CreateForTesting(Prefs);
            preferences.Load();
            MasoraService = new MasoraDataService(new LocalDatabaseService(Storage.FileSystem.Object));
            var localDb = new LocalDatabaseService(Storage.FileSystem.Object);
            Model = new MasoraViewModel(
                MasoraService,
                perekDataServiceFactory?.Invoke(localDb) ?? new PerekDataService(localDb),
                preferences,
                catalog,
                notes,
                nullArticlesLoader ? null
                    : articlesLoader ?? (_ => Task.FromResult(articles ?? new List<Article>())));
        }

        public async Task Initialize()
        {
            var schema = PerekDataServiceTests.Schema.Concat(MasoraDataServiceTests.Schema.Skip(1)).ToArray();
            var db = await Storage.CreateDatabaseAsync(BibleDb, schema);
            await db.ExecuteAsync(
                "INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,50),(8,'שמואל','{}',51,55)");
            await db.ExecuteAsync(
                "WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n < 4) " +
                "INSERT INTO tanah_perek SELECT n,n,'Header' FROM ids");
            // perek 1: pasuk 1 ends with a stuma break after word 2 (mid-pasuk).
            await db.ExecuteAsync(
                "INSERT INTO tanah_pasuk_segment VALUES " +
                "(1,1,1,'ktiv'),(2,1,1,'ktiv'),(3,1,1,'stuma'),(4,1,1,'ktiv')," +
                "(5,1,2,'ktiv'),(6,2,1,'ktiv'),(7,51,1,'ktiv'),(8,51,2,'ktiv')");
            await db.ExecuteAsync(
                "INSERT INTO tanah_pasuk_segment_value VALUES " +
                "(1,'א'),(2,'ב'),(3,'ס'),(4,'ג'),(5,'ד'),(6,'ה'),(7,'ו'),(8,'ז')");
            await db.ExecuteAsync(
                "INSERT INTO tanah_reading_division VALUES ('masora',1,'/מסורה','מסורה על הפרק')");
            await db.ExecuteAsync(
                "INSERT INTO tanah_reading_unit VALUES " +
                "('masora',1,'1',1,1,'בראשית פרשה א','stuma')," +
                "('masora',2,'2',1,2,'בראשית פרשה ב','ptuha')," +
                "('masora',3,'3',8,1,'שמואל פרשה א',NULL)");
            await db.ExecuteAsync(
                "INSERT INTO tanah_reading_unit_range VALUES " +
                "('masora',1,0,NULL,1,1,NULL,1,1,2)," +
                "('masora',2,0,NULL,1,1,3,2,1,NULL)," +
                "('masora',3,0,NULL,51,1,NULL,51,2,NULL)");
            // Perushim: one note inside unit 1's clipped span + one outside it.
            if (_includeCatalog)
            {
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
                    "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)",
                    "INSERT INTO perush VALUES (1,'Rashi',1)",
                    "CREATE TABLE _metadata (key TEXT,value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','100')");
            }
            if (_includeNotes)
            {
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
                    [.. NotesDbV2.Statements(
                        (1, 1, 1, 0, "inside"), (1, 1, 2, 0, "outside")),
                        "INSERT INTO _metadata VALUES ('build_timestamp','100')"]);
            }
        }

        public ValueTask DisposeAsync() => Storage.DisposeAsync();
    }

    [Fact]
    public async Task LoadByUnitId_ClipsRowsToUnitBoundsAndInitializesCarousel()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadByUnitIdAsync(1);

        var unit = fixture.Model.Unit!;
        unit.UnitId.Should().Be(1);
        unit.Rows.Should().ContainSingle();
        // Unit 1 ends at pasuk 1 segment index 2 → only 'א ב ס' rendered.
        unit.Rows[0].Pasuk.Segments.Select(s => s.Value).Should().Equal("א", "ב", "ס");
        unit.Rows[0].Pasuk.Text.Should().Be("א ב");
        fixture.Model.Heading.Should().Be("בראשית פרשה א");
        fixture.Model.ClosingBreakLabel.Should().Be("פרשה סתומה");
        fixture.Model.CarouselUnits.Should().HaveCount(3);
        fixture.Model.UnitPositionText.Should().Be("פרשה 1 מתוך 3");
        fixture.Model.CanGoToNextUnit.Should().BeTrue();
        fixture.Model.CanGoToPreviousUnit.Should().BeFalse();
    }

    [Fact]
    public async Task CrossPerekUnit_ProducesRowsFromBothPerakim()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadByUnitIdAsync(2);

        var unit = fixture.Model.Unit!;
        // Unit 2: {perek 1, pasuk 1, segment 3} → {perek 2, pasuk 1} — clips the
        // stuma break opener, keeps the tail word plus the rest of perek 1,
        // then continues into perek 2.
        unit.Rows.Should().HaveCount(3);
        unit.Rows[0].PerekId.Should().Be(1);
        unit.Rows[0].Pasuk.Segments.Select(s => s.Value).Should().Equal("ג");
        unit.Rows[1].PerekId.Should().Be(1);
        unit.Rows[1].Pasuk.Segments.Select(s => s.Value).Should().Equal("ד");
        unit.Rows[2].PerekId.Should().Be(2);
        unit.Rows[2].Pasuk.Segments.Select(s => s.Value).Should().Equal("ה");
    }

    [Fact]
    public async Task NavigateToUnit_UpdatesUnitAndFiresNavigationRequest()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var requested = new List<int>();
        fixture.Model.NavigationRequested += (_, index) => requested.Add(index);

        await fixture.Model.NavigateToUnitAsync(3);

        fixture.Model.UnitId.Should().Be(3);
        fixture.Model.SeferName.Should().Be("שמואל");
        requested.Should().Equal(2); // index of unit 3 inside the 3-unit carousel
        fixture.Model.CanGoToPreviousUnit.Should().BeTrue();
        fixture.Model.CanGoToNextUnit.Should().BeFalse();
    }

    [Fact]
    public async Task GetInitialUnitId_UsesLastLearntPerek()
    {
        await using var fixture = new Fixture(lastLearntPerek: 51); // שמואל א א → unit 3
        await fixture.Initialize();

        var unitId = await fixture.Model.GetInitialUnitIdAsync();

        unitId.Should().Be(3);
    }

    [Fact]
    public async Task LoadPerushim_FiltersNotesToUnitCoveredPasukim()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.Perushim.Should().ContainSingle(p => p.Name == "Rashi");
        fixture.Model.ToggleCheckedPerush(1);

        // Unit 1 covers pasuk 1 only (it ends mid-pasuk 1); the pasuk-2 note is out of bounds.
        var row = fixture.Model.Unit!.Rows[0];
        row.Pasuk.PerushNotes.Should().ContainSingle().Which.NoteContents.Should().BeEmpty();
        (await row.Pasuk.PerushNotes[0].ContentLoader!()).Should().Equal("inside");
    }

    [Fact]
    public async Task LoadArticles_UnionsAndDeduplicatesAcrossPerakim()
    {
        var articles = new List<Article>
        {
            new() { Id = 7, Abstract = "a", AuthorId = 1, PerekId = 1 },
            new() { Id = 9, Abstract = "b", AuthorId = 1, PerekId = 2 },
        };
        await using var fixture = new Fixture(articles);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(2);

        // Unit 2 spans perakim 1-2; the same list is returned per perek and deduped by id.
        await fixture.Model.LoadArticlesAsync(fixture.Model.Unit!);

        fixture.Model.Articles.Select(a => a.Id).Should().BeEquivalentTo(new[] { 7, 9 });
        fixture.Model.ArticlesCount.Should().Be(2);
        fixture.Model.HasArticles.Should().BeTrue();
    }

    [Fact]
    public async Task LoadArticles_InvokesPerekLoadersConcurrently()
    {
        // The gate releases only once every perek loader has started — a
        // serialized loop would await the first call forever and hit the
        // WaitAsync timeout instead of completing.
        var started = 0;
        var allStarted = new TaskCompletionSource();
        Func<int, Task<List<Article>>> gatedLoader = async perekId =>
        {
            if (Interlocked.Increment(ref started) == 2)
            {
                allStarted.TrySetResult();
            }
            await allStarted.Task;
            return [new Article { Id = perekId, PerekId = perekId, AuthorId = 1, Abstract = string.Empty }];
        };
        await using var fixture = new Fixture(articlesLoader: gatedLoader);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(2); // unit 2 spans perakim 1-2

        await fixture.Model.LoadArticlesAsync(fixture.Model.Unit!)
            .WaitAsync(TimeSpan.FromSeconds(10));

        started.Should().Be(2);
        fixture.Model.Articles.Select(a => a.Id).Should().BeEquivalentTo(new[] { 1, 2 });
    }

    [Fact]
    public async Task GetUnitIdForPerek_MapsPerekToContainingUnit()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.GetUnitIdForPerek(2).Should().Be(2);
        fixture.Model.GetUnitIdForPerek(51).Should().Be(3);
        fixture.Model.GetUnitIdForPerek(99).Should().BeNull();
    }

    [Fact]
    public async Task GetUnitIdForPerekAsync_LoadsServiceLazily()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        fixture.MasoraService.IsLoaded.Should().BeFalse();
        (await fixture.Model.GetUnitIdForPerekAsync(51)).Should().Be(3);
        fixture.MasoraService.IsLoaded.Should().BeTrue();
        (await fixture.Model.GetUnitIdForPerekAsync(999)).Should().BeNull();
    }

    [Fact]
    public async Task GetInitialUnitId_UnknownStoredPerek_FallsBackToFirstUnit()
    {
        await using var fixture = new Fixture(lastLearntPerek: 999);
        await fixture.Initialize();

        (await fixture.Model.GetInitialUnitIdAsync()).Should().Be(1);
    }

    [Fact]
    public async Task UnitGetters_ExposeLoadedUnitState()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(2);

        var model = fixture.Model;
        model.UnitId.Should().Be(2);
        model.Heading.Should().Be("בראשית פרשה ב");
        model.SeferId.Should().Be(1);
        model.SeferName.Should().Be("בראשית");
        model.UnitOrder.Should().Be(2);
        model.ClosingBreakLabel.Should().Be("פרשה פתוחה");
        model.HasClosingBreak.Should().BeTrue();
        model.UnitPositionText.Should().Be("פרשה 2 מתוך 3");
        model.NextUnitId.Should().Be(3);
        model.PreviousUnitId.Should().Be(1);
        model.CanGoToNextUnit.Should().BeTrue();
        model.CanGoToPreviousUnit.Should().BeTrue();
        model.PerushimCount.Should().BeGreaterThan(0);
        model.HasPerushim.Should().BeTrue();
        model.PerushimEmptyMessage.Should().Be("אין פרשנות לפרשה זו");
        model.ShowDownloadPerushimButton.Should().BeFalse();
    }

    [Fact]
    public async Task SeferFinalUnit_HasNoClosingBreakLabel()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(3); // closing_break IS NULL (sefer-end unit)

        fixture.Model.ClosingBreakLabel.Should().BeEmpty();
        fixture.Model.HasClosingBreak.Should().BeFalse();
        fixture.Model.Unit!.ClosingBreakLabel.Should().BeEmpty();
        fixture.Model.Unit.HasClosingBreak.Should().BeFalse();
    }

    [Fact]
    public async Task LoadByUnitId_UnknownId_LeavesUnitUnset()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(999);

        fixture.Model.Unit.Should().BeNull();
        fixture.Model.CarouselUnits.Should().BeEmpty();
    }

    [Fact]
    public async Task NavigateToUnit_FullLoadsWhenCarouselEmpty_ThenIgnoresUnknownId()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        // Carousel not yet initialized → full load path.
        await fixture.Model.NavigateToUnitAsync(2);
        fixture.Model.UnitId.Should().Be(2);
        fixture.Model.CarouselUnits.Should().HaveCount(3);

        // Unknown unit id → index lookup fails → full load also returns early.
        await fixture.Model.NavigateToUnitAsync(999);
        fixture.Model.UnitId.Should().Be(2);
    }

    [Fact]
    public async Task LoadNextPrevious_NavigateWithinCanonicalBounds()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        fixture.Model.CanGoToPreviousUnit.Should().BeFalse();

        await fixture.Model.LoadNextAsync();
        fixture.Model.UnitId.Should().Be(2);
        await fixture.Model.LoadNextAsync();
        fixture.Model.UnitId.Should().Be(3);
        // At the canonical end the guard short-circuits — the unit stays put.
        fixture.Model.CanGoToNextUnit.Should().BeFalse();
        await fixture.Model.LoadNextAsync();
        fixture.Model.UnitId.Should().Be(3);

        await fixture.Model.LoadPreviousAsync();
        fixture.Model.UnitId.Should().Be(2);
        await fixture.Model.LoadPreviousAsync();
        fixture.Model.UnitId.Should().Be(1);
        await fixture.Model.LoadPreviousAsync();
        fixture.Model.UnitId.Should().Be(1);
    }

    [Fact]
    public async Task InitializeCarousel_WithoutUnit_IsNoOp()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.InitializeCarouselAsync();

        fixture.Model.CarouselUnits.Should().BeEmpty();
    }

    [Fact]
    public async Task EnsureRowsLoaded_IsIdempotent()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var rows = fixture.Model.Unit!.Rows;

        await fixture.Model.EnsureRowsLoadedAsync(fixture.Model.Unit);

        fixture.Model.Unit.Rows.Should().BeSameAs(rows);
    }

    [Fact]
    public async Task PreloadAdjacentRows_LoadsNeighborRowsAndHandlesEarlyReturns()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        // Service not yet loaded → Units is null → early return.
        await fixture.Model.PreloadAdjacentRowsAsync(1);

        await fixture.Model.LoadByUnitIdAsync(1);

        // Unknown center id → index lookup fails → early return.
        await fixture.Model.PreloadAdjacentRowsAsync(999);

        var unit2 = fixture.MasoraService.GetUnit(2)!;
        var unit3 = fixture.MasoraService.GetUnit(3)!;
        unit2.Rows.Should().BeEmpty();
        await fixture.Model.PreloadAdjacentRowsAsync(1);
        unit2.Rows.Should().NotBeEmpty();
        unit3.Rows.Should().NotBeEmpty();

        // Everything already loaded → nothing left to do.
        await fixture.Model.PreloadAdjacentRowsAsync(1);
    }

    /// <summary>Counts pasukim loads so preload cache behavior is observable.</summary>
    private sealed class CountingPerekDataService : PerekDataService
    {
        public List<int> RequestedPerekIds { get; } = new();

        public CountingPerekDataService(LocalDatabaseService databaseService) : base(databaseService) { }

        public override Task<List<Pasuk>> LoadPasukimAsync(int perekId)
        {
            RequestedPerekIds.Add(perekId);
            return base.LoadPasukimAsync(perekId);
        }
    }

    [Fact]
    public async Task PreloadAdjacentRows_LoadsSharedBoundaryPerekOnce()
    {
        CountingPerekDataService? counting = null;
        await using var fixture = new Fixture(
            perekDataServiceFactory: db => counting = new CountingPerekDataService(db));
        await fixture.Initialize();
        await fixture.MasoraService.LoadAsync();

        // Units 1 and 2 both touch perek 1 — one preload batch, one fetch.
        await fixture.Model.PreloadAdjacentRowsAsync(2);

        counting!.RequestedPerekIds.Should().Equal(1, 2, 51);
        fixture.MasoraService.GetUnit(1)!.Rows.Should().NotBeEmpty();
        fixture.MasoraService.GetUnit(2)!.Rows.Should().NotBeEmpty();
        fixture.MasoraService.GetUnit(3)!.Rows.Should().NotBeEmpty();
    }

    [Fact]
    public async Task LoadArticles_WithoutLoader_SetsEmptyArticles()
    {
        await using var fixture = new Fixture(nullArticlesLoader: true);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        await fixture.Model.LoadArticlesAsync(fixture.Model.Unit!);

        fixture.Model.Articles.Should().BeEmpty();
        fixture.Model.ArticlesCount.Should().Be(0);
        fixture.Model.HasArticles.Should().BeFalse();
        fixture.Model.Unit!.ArticlesCount.Should().Be(0);
    }

    [Fact]
    public async Task LoadArticles_ForStaleUnit_IsIgnored()
    {
        var articles = new List<Article> { new() { Id = 7, Abstract = "a", AuthorId = 1, PerekId = 51 } };
        await using var fixture = new Fixture(articles);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        var stale = fixture.MasoraService.GetUnit(3)!;
        await fixture.Model.LoadArticlesAsync(stale);

        // A newer unit is already on screen — the stale result is discarded.
        fixture.Model.Articles.Should().BeEmpty();
        stale.ArticlesCount.Should().Be(0);
    }

    [Fact]
    public async Task LoadPerushim_WithoutCatalog_ReportsMissingCatalog()
    {
        await using var fixture = new Fixture(includeCatalog: false);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.PerushimCatalogAvailable.Should().BeFalse();
        fixture.Model.PerushimNotesAvailable.Should().BeTrue();
        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.PerushimEmptyMessage.Should().Be("אין קטלוג פירושים");
        fixture.Model.ShowDownloadPerushimButton.Should().BeFalse();
    }

    [Fact]
    public async Task LoadPerushim_WithoutNotes_OffersDownloadButton()
    {
        await using var fixture = new Fixture(includeNotes: false);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.PerushimCatalogAvailable.Should().BeTrue();
        fixture.Model.PerushimNotesAvailable.Should().BeFalse();
        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.PerushimEmptyMessage.Should().Be("להוריד פירושים");
        fixture.Model.ShowDownloadPerushimButton.Should().BeTrue();
    }

    [Fact]
    public async Task LoadPerushim_ForStaleUnit_IsIgnored()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var before = fixture.Model.Perushim;

        var stale = fixture.MasoraService.GetUnit(2)!;
        await fixture.Model.LoadPerushimAsync(stale);

        fixture.Model.Perushim.Should().BeSameAs(before);
    }

    [Fact]
    public async Task LoadPerushim_UnitCoveringPerekWithoutNotes_ClearsPerushim()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        fixture.Model.Perushim.Should().NotBeEmpty();

        var emptyUnit = new MasoraUnit
        {
            UnitId = 1, // Same id as the loaded unit so the stale check passes.
            Slug = "x",
            SeferName = "x",
            Heading = "h",
            Ranges = { new MasoraUnitRange { StartPerekId = 2, StartPasuk = 1, EndPerekId = 2, EndPasuk = 1 } }
        };
        await fixture.Model.LoadPerushimAsync(emptyUnit);

        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.HasPerushim.Should().BeFalse();
    }

    [Fact]
    public async Task ToggleCheckedPerush_TogglesInlineNotesAndQueries()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.IsPerushChecked(1).Should().BeFalse();
        // GetPerushimForRow exposes all unit notes regardless of the inline filter.
        fixture.Model.GetPerushimForRow(1, 1).Should().ContainSingle(n => n.PerushName == "Rashi");
        fixture.Model.GetPerushimForRow(1, 2).Should().BeEmpty();
        fixture.Model.GetPerushimForRow(51, 1).Should().BeEmpty();

        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.IsPerushChecked(1).Should().BeTrue();
        fixture.Model.Unit!.Rows[0].Pasuk.PerushNotes.Should().ContainSingle();

        // Unchecking clears the inline notes from the unit's rows.
        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.IsPerushChecked(1).Should().BeFalse();
        fixture.Model.Unit.Rows[0].Pasuk.PerushNotes.Should().BeEmpty();
    }

    [Fact]
    public async Task ToggleCheckedPerush_MultiPerekUnit_LeavesNotelessRowsUntouched()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(2); // Spans perakim 1-2.
        fixture.Model.ToggleCheckedPerush(1);

        var rows = fixture.Model.Unit!.Rows;
        // Rows whose pasuk carries notes get them; the perek-2 row has none and
        // keeps its empty note list (no pointless reassignment).
        rows.First(r => r is { PerekId: 1, PasukNum: 1 }).Pasuk.PerushNotes.Should().ContainSingle();
        rows.First(r => r is { PerekId: 1, PasukNum: 2 }).Pasuk.PerushNotes.Should().ContainSingle();
        rows.First(r => r.PerekId == 2).Pasuk.PerushNotes.Should().BeEmpty();
    }

    [Fact]
    public async Task LoadArticles_WithoutLoadedUnit_IsIgnoredAsStale()
    {
        var articles = new List<Article> { new() { Id = 7, Abstract = "a", AuthorId = 1, PerekId = 1 } };
        await using var fixture = new Fixture(articles);
        await fixture.Initialize();
        await fixture.MasoraService.LoadAsync();
        var unit = fixture.MasoraService.GetUnit(2)!;

        await fixture.Model.LoadArticlesAsync(unit);

        fixture.Model.Articles.Should().BeEmpty();
    }

    [Fact]
    public async Task LoadPerushim_WithoutLoadedUnit_IsIgnoredAsStale()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.MasoraService.LoadAsync();
        var unit = fixture.MasoraService.GetUnit(2)!;

        // No unit on screen yet — the async result is stale by definition.
        await fixture.Model.LoadPerushimAsync(unit);

        fixture.Model.Perushim.Should().BeEmpty();
    }
}
