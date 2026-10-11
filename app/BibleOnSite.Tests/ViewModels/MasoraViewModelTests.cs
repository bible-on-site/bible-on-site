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
        public MasoraViewModel Model { get; }

        public Fixture(List<Article>? articles = null, int? lastLearntPerek = null)
        {
            if (lastLearntPerek is int lastLearnt)
            {
                // PreferencesService caches LastLearntPerek at construction — set first.
                Prefs.Set("lastLearntPerek", lastLearnt);
            }
            var catalog = new PerushimCatalogService(Storage.FileSystem.Object);
            var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, Storage.FileSystem.Object);
            var preferences = PreferencesService.CreateForTesting(Prefs);
            preferences.Load();
            Model = new MasoraViewModel(
                new MasoraDataService(new LocalDatabaseService(Storage.FileSystem.Object)),
                new PerekDataService(new LocalDatabaseService(Storage.FileSystem.Object)),
                preferences,
                catalog,
                notes,
                _ => Task.FromResult(articles ?? new List<Article>()));
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
                "('masora',1,'1',1,1,'בראשית א א','stuma')," +
                "('masora',2,'2',1,2,'בראשית א א - ב א','ptuha')," +
                "('masora',3,'3',8,1,'שמואל א א-ב',NULL)");
            await db.ExecuteAsync(
                "INSERT INTO tanah_reading_unit_range VALUES " +
                "('masora',1,0,NULL,1,1,NULL,1,1,2)," +
                "('masora',2,0,NULL,1,1,3,2,1,NULL)," +
                "('masora',3,0,NULL,51,1,NULL,51,2,NULL)");
            // Perushim: one note inside unit 1's clipped span + one outside it.
            await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
                "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)",
                "INSERT INTO perush VALUES (1,'Rashi',1)",
                "CREATE TABLE _metadata (key TEXT,value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','100')");
            await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
                "CREATE TABLE _metadata (key TEXT,value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','100')",
                "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
                "INSERT INTO note VALUES (1,1,1,0,'inside'),(1,1,2,0,'outside')");
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
        fixture.Model.Heading.Should().Be("בראשית א א");
        fixture.Model.ClosingBreakLabel.Should().Be("פרשה סתומה");
        fixture.Model.CarouselUnits.Should().HaveCount(3);
        fixture.Model.UnitPositionText.Should().Be("יחידה 1 מתוך 3");
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
        unit.Rows[0].PerekLabel.Should().Be("בראשית א");
        unit.Rows[1].PerekId.Should().Be(1);
        unit.Rows[1].PerekLabel.Should().BeNull();
        unit.Rows[1].Pasuk.Segments.Select(s => s.Value).Should().Equal("ד");
        unit.Rows[2].PerekId.Should().Be(2);
        unit.Rows[2].PerekLabel.Should().Be("בראשית ב");
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
        row.Pasuk.PerushNotes.Should().ContainSingle()
            .Which.NoteContents.Should().Equal("inside");
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
    public async Task GetUnitIdForPerek_MapsPerekToContainingUnit()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.GetUnitIdForPerek(2).Should().Be(2);
        fixture.Model.GetUnitIdForPerek(51).Should().Be(3);
        fixture.Model.GetUnitIdForPerek(99).Should().BeNull();
    }
}
