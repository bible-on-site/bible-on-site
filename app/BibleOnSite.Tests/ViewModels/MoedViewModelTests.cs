using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// MoedViewModel (#3261): slug/id loading against the canonical corpus, the
/// catalogue's unavailable surface, adjacent-moed navigation, article union
/// joins, selection, and the moed → recitation planner mapping.
/// </summary>
public class MoedViewModelTests
{
    private const string BibleDb = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    private const string Catalogue = """
        {"data":{"moadim":[
            {"id":1,"slug":"first","name":"מועד ראשון","summary":"תקציר","hebrewMonth":"תשרי",
             "dateLabel":"א' בתשרי","annualOrder":1,"published":true,
             "sections":[{"id":11,"label":"קריאה","position":1,"ranges":[
                {"id":21,"position":1,"perekIdStart":1,"pasukStart":1,"perekIdEnd":1,"pasukEnd":2},
                {"id":22,"position":2,"perekIdStart":2,"pasukStart":1,"perekIdEnd":2,"pasukEnd":2}
             ]}],
             "explicitArticleIds":[],"articles":[{"id":7},{"id":9},{"id":7}]},
            {"id":2,"slug":"second","name":"מועד שני","summary":null,"hebrewMonth":"חשוון",
             "dateLabel":null,"annualOrder":2,"published":true,
             "sections":[{"id":12,"label":"מפטיר","position":1,"ranges":[
                {"id":23,"position":1,"perekIdStart":2,"pasukStart":2,"perekIdEnd":2,"pasukEnd":2}
             ]}],
             "explicitArticleIds":[],"articles":[{"id":8}]}
        ]}}
        """;

    private sealed class Fixture : IAsyncDisposable
    {
        public TestStorage Storage { get; } = new();
        public InMemoryPreferencesStorage Prefs { get; } = new();
        public GraphQLTransport Http { get; }
        public MoedService MoedService { get; }
        public MoedViewModel Model { get; }
        public PreferencesService Preferences { get; }
        private readonly Func<int, bool>? _hasPerekAudio;
        private readonly Func<int, RecitationTrack?>? _getTrack;

        public Fixture(List<Article>? articles = null,
            Func<int, bool>? hasPerekAudio = null,
            Func<int, RecitationTrack?>? getTrack = null,
            string catalogue = Catalogue)
        {
            _hasPerekAudio = hasPerekAudio;
            _getTrack = getTrack;
            var catalog = new PerushimCatalogService(Storage.FileSystem.Object);
            var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, Storage.FileSystem.Object);
            var preferences = PreferencesService.CreateForTesting(Prefs);
            Preferences = preferences;
            preferences.Load();
            Http = new GraphQLTransport(catalogue);
            MoedService = new MoedService(Http.Client, Storage.FileSystem.Object);
            var localDb = new LocalDatabaseService(Storage.FileSystem.Object);
            Model = new MoedViewModel(
                MoedService,
                new PerekDataService(localDb),
                preferences,
                catalog,
                notes,
                () => articles ?? new List<Article>(),
                // Never touch RecitationService.Instance — its lazy filesystem
                // singleton has no host in a unit-test process.
                hasPerekAudio ?? (_ => false),
                getTrack ?? (_ => null));
        }

        public async Task Initialize()
        {
            var db = await Storage.CreateDatabaseAsync(BibleDb, PerekDataServiceTests.Schema);
            await db.ExecuteAsync(
                "INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,50)");
            await db.ExecuteAsync(
                "INSERT INTO tanah_perek VALUES (1,1,'א'),(2,2,'ב'),(3,3,'ג')");
            // perek 1: two pesukim of two ktiv words; perek 2: the same, so
            // range boundaries exercise both books.
            await db.ExecuteAsync(
                "INSERT INTO tanah_pasuk_segment VALUES " +
                "(1,1,1,'ktiv'),(2,1,1,'ktiv'),(3,1,2,'ktiv'),(4,1,2,'ktiv')," +
                "(5,2,1,'ktiv'),(6,2,1,'ktiv'),(7,2,2,'ktiv'),(8,2,2,'ktiv')," +
                "(9,3,1,'ktiv'),(10,3,2,'ktiv')");
            await db.ExecuteAsync(
                "INSERT INTO tanah_pasuk_segment_value VALUES " +
                "(1,'א'),(2,'ב'),(3,'ג'),(4,'ד'),(5,'ה'),(6,'ו'),(7,'ז'),(8,'ח'),(9,'ט'),(10,'י')");
        }

        public async ValueTask DisposeAsync()
        {
            Http.Dispose();
            await Storage.DisposeAsync();
        }
    }

    [Fact]
    public async Task LoadBySlug_BuildsSectionRows_FromCanonicalCorpus()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadBySlugAsync("first");

        var unit = fixture.Model.Unit!;
        unit.Name.Should().Be("מועד ראשון");
        fixture.Model.Heading.Should().Be("מועד ראשון");
        fixture.Model.ContextText.Should().Be("א' בתשרי");
        fixture.Model.UnitPositionText.Should().Be("מועד 1 מתוך 2");
        fixture.Model.IsUnavailable.Should().BeFalse();

        var rows = fixture.Model.Rows;
        rows[0].IsSectionHeader.Should().BeTrue();
        rows[0].Text.Should().Be("קריאה");
        rows[0].RefsText.Should().Contain("בראשית");
        rows[1].IsPerekHeader.Should().BeTrue();
        // Range 1:1..1:2 then 2:1..2:2 — canonical pesukim, no copied corpus.
        rows.Where(r => r.Pasuk != null).Select(r => (r.PerekId, r.PasukNum, r.Pasuk!.Text))
            .Should().Equal((1, 1, "א ב"), (1, 2, "ג ד"), (2, 1, "ה ו"), (2, 2, "ז ח"));
    }

    [Fact]
    public async Task LoadBySlug_UnknownSlug_SurfacesUnavailable()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadBySlugAsync("not-a-moed");

        fixture.Model.Unit.Should().BeNull();
        fixture.Model.IsUnavailable.Should().BeTrue();
        // The slug miss queried the detail endpoint once (a moed could have
        // been published after the cached catalogue), then stayed null.
        fixture.Http.Requests.Should().Contain(r => r.Contains("GetMoed"));
    }

    [Fact]
    public async Task LoadInitial_SelectsTheFirstPublishedMoed()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadInitialAsync();

        fixture.Model.Unit!.Slug.Should().Be("first");
        fixture.Model.CanGoToNextUnit.Should().BeTrue();
        fixture.Model.CanGoToPreviousUnit.Should().BeFalse();
    }

    [Fact]
    public async Task NavigateToUnit_SwapsTheMoed_AndRaisesNavigation()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");
        var navigated = -1;
        fixture.Model.NavigationRequested += (_, id) => navigated = id;

        await fixture.Model.NavigateToUnitAsync(2);

        navigated.Should().Be(2);
        fixture.Model.Heading.Should().Be("מועד שני");
        fixture.Model.CanGoToPreviousUnit.Should().BeTrue();
        fixture.Model.CanGoToNextUnit.Should().BeFalse();
        // The new moed's own rows — not the previous one's.
        fixture.Model.Rows.Where(r => r.Pasuk != null)
            .Select(r => (r.PerekId, r.PasukNum)).Should().Equal((2, 2));
    }

    [Fact]
    public async Task LoadArticles_JoinsTheUnionOrder_AndDedupes()
    {
        var articles = new List<Article>
        {
            new() { Id = 7, Abstract = "", Name = "שבע" },
            new() { Id = 8, Abstract = "", Name = "שמונה" },
            new() { Id = 9, Abstract = "", Name = "תשע" },
        };
        await using var fixture = new Fixture(articles: articles);
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        // The server union order is kept; ids the starter cache lacks are skipped.
        fixture.Model.Articles.Select(a => a.Id).Should().Equal(7, 9);
        fixture.Model.ArticlesCount.Should().Be(2);
        fixture.Model.HasArticles.Should().BeTrue();
    }

    [Fact]
    public async Task Selection_TogglesByCanonicalKey_AcrossRepeatedRows()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        fixture.Model.ToggleSelectedPasuk(1, 2);
        fixture.Model.SelectedPasukCount.Should().Be(1);
        fixture.Model.IsPasukSelected(1, 2).Should().BeTrue();
        fixture.Model.GetSelectedPesukim().Should().ContainSingle()
            .Which.Pasuk.Text.Should().Be("ג ד");

        fixture.Model.ClearSelected();
        fixture.Model.SelectedPasukCount.Should().Be(0);
        fixture.Model.Rows.Where(r => r.Pasuk != null)
            .Should().OnlyContain(r => r.Pasuk!.IsSelected == false);
    }

    [Fact]
    public async Task PlanSegments_PartitionedPerSection_AndWholeMoed()
    {
        // perek 1 and 2 carry audio through unaligned tracks — the moed's
        // ranges cover whole perakim, which unaligned tracks can play
        // unbounded. The aligned-clip path is covered by
        // RecitationRangePlannerTests.
        RecitationTrack Pending(int perek) => new(perek, $"u{perek}", "h", "t", 5000, "pending", []);
        var tracks = new Dictionary<int, RecitationTrack> { [1] = Pending(1), [2] = Pending(2) };

        await using var fixture = new Fixture(
            hasPerekAudio: id => tracks.ContainsKey(id),
            getTrack: id => tracks.GetValueOrDefault(id));
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        var unit = fixture.Model.Unit!;
        var unitSegments = fixture.Model.PlanSegmentsForUnit(unit);
        unitSegments.Select(s => s.PerekId).Should().Equal(1, 2);
        // Whole-moed clips keep their section so a repeated reading's
        // highlight maps to the playing occurrence (#3261 review).
        unitSegments.Should().OnlyContain(s => s.SectionId == unit.Sections[0].Id);
        var section = unit.Sections[0];
        var sectionSegments = fixture.Model.PlanSegmentsForSection(section);
        sectionSegments.Select(s => s.PerekId).Should().Equal(1, 2);
        sectionSegments.Should().OnlyContain(s => s.SectionId == section.Id);
        // The unit setter already ran the availability refresh — the header
        // affordance and each section header's play button mirror the plan.
        fixture.Model.HasCurrentUnitRecitation.Should().BeTrue();
        fixture.Model.Rows[0].ShowPlayButton.Should().BeTrue();
    }

    [Fact]
    public async Task PlanSegments_WholeMoed_FollowsPositionOrder_WhenSectionsArriveUnsorted()
    {
        // The wire lists the position-2 section before position-1 — whole-moed
        // audio must follow the display's position ordering, not the DTO order
        // (#3261 review). Each range covers its whole perek so the unaligned
        // pending tracks can play it.
        const string unsortedCatalogue = """
            {"data":{"moadim":[
                {"id":3,"slug":"shuffled","name":"מועד הפוך","summary":null,"hebrewMonth":"אלול",
                 "dateLabel":null,"annualOrder":1,"published":true,
                 "sections":[
                    {"id":32,"label":"שני","position":2,"ranges":[
                        {"id":42,"position":1,"perekIdStart":2,"pasukStart":1,"perekIdEnd":2,"pasukEnd":2}
                    ]},
                    {"id":31,"label":"ראשון","position":1,"ranges":[
                        {"id":41,"position":1,"perekIdStart":1,"pasukStart":1,"perekIdEnd":1,"pasukEnd":2}
                    ]}
                 ],
                 "explicitArticleIds":[],"articles":[]}
            ]}}
            """;
        RecitationTrack Pending(int perek) => new(perek, $"u{perek}", "h", "t", 5000, "pending", []);
        var tracks = new Dictionary<int, RecitationTrack> { [1] = Pending(1), [2] = Pending(2) };

        await using var fixture = new Fixture(
            hasPerekAudio: id => tracks.ContainsKey(id),
            getTrack: id => tracks.GetValueOrDefault(id),
            catalogue: unsortedCatalogue);
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("shuffled");

        fixture.Model.PlanSegmentsForUnit(fixture.Model.Unit!)
            .Select(s => (s.SectionId, s.PerekId)).Should().Equal((31, 1), (32, 2));
    }

    [Fact]
    public async Task PlanSegments_NoAudio_YieldsNoPlan()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        fixture.Model.PlanSegmentsForUnit(fixture.Model.Unit!).Should().BeEmpty();
        fixture.Model.RefreshRecitationAvailability();
        fixture.Model.HasCurrentUnitRecitation.Should().BeFalse();
    }
}
