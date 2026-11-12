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
        public PerushimCatalogService Catalog { get; }
        public PerushimNotesService Notes { get; }
        private readonly Func<int, bool>? _hasPerekAudio;
        private readonly Func<int, RecitationTrack?>? _getTrack;
        private readonly bool _includeCatalog;
        private readonly bool _includeNotes;

        public Fixture(List<Article>? articles = null,
            Func<int, bool>? hasPerekAudio = null,
            Func<int, RecitationTrack?>? getTrack = null,
            string catalogue = Catalogue,
            bool includeCatalog = true, bool includeNotes = true,
            bool nullArticlesProvider = false,
            IAppNavigator? navigator = null, IFileSystem? fileSystem = null, IShare? share = null)
        {
            _hasPerekAudio = hasPerekAudio;
            _getTrack = getTrack;
            _includeCatalog = includeCatalog;
            _includeNotes = includeNotes;
            var catalog = new PerushimCatalogService(Storage.FileSystem.Object);
            var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, Storage.FileSystem.Object);
            Catalog = catalog;
            Notes = notes;
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
                nullArticlesProvider ? null : (() => articles ?? new List<Article>()),
                // Never touch RecitationService.Instance — its lazy filesystem
                // singleton has no host in a unit-test process.
                hasPerekAudio ?? (_ => false),
                getTrack ?? (_ => null),
                navigator, fileSystem, share);
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
            if (_includeCatalog)
            {
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
                    ["CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)",
                     "INSERT INTO perush VALUES (1,'רש\"י',1),(2,'רמב\"ן',2)",
                     "CREATE TABLE _metadata (key TEXT,value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','100')"]);
            }
            if (_includeNotes)
            {
                // Perush 1 on perek 1 pasuk 1; perush 2 on perek 2 pasuk 2 —
                // matching the moed's two range-covered perakim.
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
                    [.. NotesDbV2.Statements(
                        (1, 1, 1, 0, "inside-one"), (2, 2, 2, 0, "inside-two")),
                        "INSERT INTO _metadata VALUES ('build_timestamp','100')"]);
            }
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
        // The catalogue load caches the covered perakim's pasukim — the unit
        // itself is built directly so the planner receives genuinely
        // wire-reversed sections (ToModel already position-sorts its output,
        // which would mask a missing planner ordering).
        await fixture.Model.LoadBySlugAsync("shuffled");
        var direct = new MoedUnit
        {
            Id = 3,
            Slug = "shuffled",
            Name = "מועד הפוך",
            Sections =
            [
                new MoedSection
                {
                    Id = 32, Label = "שני", Position = 2,
                    Ranges = [new MoedRange { Id = 42, Position = 1, StartPerekId = 2, StartPasuk = 1, EndPerekId = 2, EndPasuk = 2 }],
                },
                new MoedSection
                {
                    Id = 31, Label = "ראשון", Position = 1,
                    Ranges = [new MoedRange { Id = 41, Position = 1, StartPerekId = 1, StartPasuk = 1, EndPerekId = 1, EndPasuk = 2 }],
                },
            ],
        };

        fixture.Model.PlanSegmentsForUnit(direct)
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

    [Fact]
    public async Task PlanSegments_TagsEachClipWithSectionAndRange()
    {
        // A section that deliberately repeats one reading must keep the two
        // occurrences distinct: each clip carries its section AND its range
        // row id so the highlight maps to the playing copy (#3261 review).
        const string repeatedCatalogue = """
            {"data":{"moadim":[
                {"id":4,"slug":"repeated","name":"מועד כפול","summary":null,"hebrewMonth":"אב",
                 "dateLabel":null,"annualOrder":1,"published":true,
                 "sections":[{"id":41,"label":"מפטיר","position":1,"ranges":[
                    {"id":51,"position":1,"perekIdStart":1,"pasukStart":1,"perekIdEnd":1,"pasukEnd":2},
                    {"id":52,"position":2,"perekIdStart":1,"pasukStart":1,"perekIdEnd":1,"pasukEnd":2}
                 ]}],
                 "explicitArticleIds":[],"articles":[]}
            ]}}
            """;
        RecitationTrack Pending(int perek) => new(perek, $"u{perek}", "h", "t", 5000, "pending", []);
        var tracks = new Dictionary<int, RecitationTrack> { [1] = Pending(1) };
        await using var fixture = new Fixture(
            hasPerekAudio: id => tracks.ContainsKey(id),
            getTrack: id => tracks.GetValueOrDefault(id),
            catalogue: repeatedCatalogue);
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("repeated");

        var section = fixture.Model.Unit!.Sections[0];
        var segments = fixture.Model.PlanSegmentsForSection(section);

        segments.Should().HaveCount(2);
        // Each clip points at the range row it reads, so the second
        // occurrence highlights its own rows.
        segments.Select(s => s.RangeId).Should().Equal(51, 52);
        segments.Should().OnlyContain(s => s.SectionId == 41);
        // The rows the word lookup filters by carry the same range ids.
        fixture.Model.Rows.Where(r => r.Pasuk != null).Select(r => r.RangeId)
            .Should().Equal(51, 51, 52, 52);
    }

    [Fact]
    public async Task UnloadedUnit_ReportsEmptySurface()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        var model = fixture.Model;
        model.UnitId.Should().Be(0);
        model.Heading.Should().BeEmpty();
        model.ContextText.Should().BeEmpty();
        model.HasContext.Should().BeFalse();
        model.SummaryText.Should().BeEmpty();
        model.HasSummary.Should().BeFalse();
        model.UnitPositionText.Should().BeEmpty();
        model.HasUnit.Should().BeFalse();
        model.IsUnavailable.Should().BeFalse();
        model.NextUnitId.Should().Be(0);
        model.PreviousUnitId.Should().Be(0);
        model.CanGoToNextUnit.Should().BeFalse();
        model.CanGoToPreviousUnit.Should().BeFalse();
        model.ArticlesCount.Should().Be(0);
        model.HasArticles.Should().BeFalse();
        model.PerushimCount.Should().Be(0);
        model.HasPerushim.Should().BeFalse();
        model.Rows.Should().BeEmpty();
        model.SelectedPasukCount.Should().Be(0);
        model.GetSelectedPesukim().Should().BeEmpty();
        model.IsPasukSelected(1, 1).Should().BeFalse();
        model.GetPerushimForRow(1, 1).Should().BeEmpty();
        model.GetLoadedPasukim(1).Should().BeNull();
        model.HasCurrentUnitRecitation.Should().BeFalse();
        model.ShowHeaderPlayButton.Should().BeFalse();
        model.PerushimEmptyMessage.Should().Be("אין קטלוג פירושים",
            "before any load the catalog is not yet available");
        model.FilteredPerushim.Should().BeEmpty();
        model.InlineCommentaryLimit.Should().BeGreaterThan(0);
        model.InlineCommentaryLimitMessage.Should().Contain("פירושים");
        model.PerushimSelectionStatus.Should().Be("נבחרו 0 מתוך " + model.InlineCommentaryLimit);
        model.PerushimLimitReached.Should().BeFalse();
    }

    [Fact]
    public async Task UnitDisplay_ReflectsMoedMetadata()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        var model = fixture.Model;
        model.ContextText.Should().Be("א' בתשרי", "the curated date label wins over the month");
        model.HasContext.Should().BeTrue();
        model.SummaryText.Should().Be("תקציר");
        model.HasSummary.Should().BeTrue();
        model.UnitPositionText.Should().Be("מועד 1 מתוך 2");

        await model.NavigateToUnitAsync(2);

        model.ContextText.Should().Be("חשוון", "no date label falls back to the month anchor");
        model.SummaryText.Should().BeEmpty();
        model.HasSummary.Should().BeFalse();
        model.UnitPositionText.Should().Be("מועד 2 מתוך 2");
    }

    [Fact]
    public async Task LoadById_LoadsMoed_AndBoundsPrevNextNavigation()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadByIdAsync(1);
        fixture.Model.UnitId.Should().Be(1);
        // Unknown ids leave the loaded moed in place.
        await fixture.Model.LoadByIdAsync(999);
        fixture.Model.UnitId.Should().Be(1);
        fixture.Model.IsUnavailable.Should().BeFalse(
            "a loaded moed keeps the reader available after a bad id");

        await fixture.Model.LoadNextAsync();
        fixture.Model.UnitId.Should().Be(2);
        await fixture.Model.LoadNextAsync();
        fixture.Model.UnitId.Should().Be(2, "the last moed cannot advance");
        await fixture.Model.LoadPreviousAsync();
        fixture.Model.UnitId.Should().Be(1);
        await fixture.Model.LoadPreviousAsync();
        fixture.Model.UnitId.Should().Be(1, "the first moed cannot go back");
    }

    [Fact]
    public async Task NavigateToUnit_SameOrUnknownMoed_ShortCircuits()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");
        var navigations = 0;
        fixture.Model.NavigationRequested += (_, _) => navigations++;

        await fixture.Model.NavigateToUnitAsync(fixture.Model.UnitId); // same moed
        await fixture.Model.NavigateToUnitAsync(999);                  // unknown id

        navigations.Should().Be(0);
        fixture.Model.UnitId.Should().Be(1);
    }

    [Fact]
    public async Task EnsureRowsLoaded_SkipsAlreadyBuiltRows()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");
        var rows = fixture.Model.Unit!.Rows;

        await fixture.Model.EnsureRowsLoadedAsync(fixture.Model.Unit);

        fixture.Model.Unit.Rows.Should().BeSameAs(rows);
        fixture.Model.GetLoadedPasukim(1).Should().HaveCount(2);
        fixture.Model.GetLoadedPasukim(2).Should().HaveCount(2);
        fixture.Model.GetLoadedPasukim(99).Should().BeNull();
    }

    [Fact]
    public async Task LoadArticles_NullProvider_YieldsEmptyArticles()
    {
        await using var fixture = new Fixture(nullArticlesProvider: true);
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        fixture.Model.Articles.Should().BeEmpty();
        fixture.Model.ArticlesCount.Should().Be(0);
        fixture.Model.HasArticles.Should().BeFalse();
        fixture.Model.Unit!.ArticlesCount.Should().Be(0);
    }

    [Fact]
    public async Task LoadArticles_StaleUnit_IsIgnored()
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

        var stale = fixture.MoedService.GetMoed(2)!;
        await fixture.Model.LoadArticlesAsync(stale);

        // A newer moed is already on screen — the stale result is discarded.
        fixture.Model.Articles.Select(a => a.Id).Should().Equal(7, 9);
        stale.ArticlesCount.Should().Be(0);
    }

    [Fact]
    public async Task LoadArticles_NotifiesCountAndAvailability()
    {
        var articles = new List<Article>
        {
            new() { Id = 7, Abstract = "", Name = "שבע" },
            new() { Id = 9, Abstract = "", Name = "תשע" },
        };
        await using var fixture = new Fixture(articles: articles);
        await fixture.Initialize();
        var notified = new List<string?>();
        fixture.Model.PropertyChanged += (_, e) => notified.Add(e.PropertyName);

        await fixture.Model.LoadBySlugAsync("first");

        // The badge binds ArticlesCount/HasArticles — they must re-notify when
        // the articles arrive after the unit swap, not only on Unit change.
        notified.Should().Contain(nameof(fixture.Model.ArticlesCount));
        notified.Should().Contain(nameof(fixture.Model.HasArticles));
        fixture.Model.ArticlesCount.Should().Be(2);
        fixture.Model.HasArticles.Should().BeTrue();
        fixture.Model.Unit!.ArticlesCount.Should().Be(2);
    }

    [Fact]
    public async Task GetSelectedPesukim_ReturnsReaderOrder_NotSelectionOrder()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        fixture.Model.ToggleSelectedPasuk(2, 2);
        fixture.Model.ToggleSelectedPasuk(1, 1);
        fixture.Model.ToggleSelectedPasuk(1, 2);

        fixture.Model.GetSelectedPesukim()
            .Select(p => (p.PerekId, p.Pasuk.PasukNum))
            .Should().Equal((1, 1), (1, 2), (2, 2));
        fixture.Model.SelectedPasukCount.Should().Be(3);
        fixture.Model.ToggleSelectedPasuk(1, 2); // untoggle
        fixture.Model.GetSelectedPesukim().Should().HaveCount(2);
    }

    [Fact]
    public async Task IsQriynotEnabled_Toggles_AndMirrorsPlayAffordances()
    {
        RecitationTrack Pending(int perek) => new(perek, $"u{perek}", "h", "t", 5000, "pending", []);
        var tracks = new Dictionary<int, RecitationTrack> { [1] = Pending(1), [2] = Pending(2) };
        await using var fixture = new Fixture(
            hasPerekAudio: id => tracks.ContainsKey(id),
            getTrack: id => tracks.GetValueOrDefault(id));
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        var model = fixture.Model;
        model.IsQriynotEnabled.Should().BeTrue();
        model.ShowHeaderPlayButton.Should().BeTrue();
        model.Rows[0].ShowPlayButton.Should().BeTrue();

        // Setting the current value is a no-op.
        model.IsQriynotEnabled = true;
        model.ShowHeaderPlayButton.Should().BeTrue();

        model.IsQriynotEnabled = false;
        fixture.Preferences.QriynotEnabled.Should().BeFalse();
        model.ShowHeaderPlayButton.Should().BeFalse();
        model.Rows[0].ShowPlayButton.Should().BeFalse();

        model.IsQriynotEnabled = true;
        model.ShowHeaderPlayButton.Should().BeTrue();
        model.Rows[0].ShowPlayButton.Should().BeTrue();
    }

    [Fact]
    public async Task LoadPerushim_UnionsAcrossRanges_AndFillsRowNotes()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        var model = fixture.Model;
        // The perushim union is priority-ordered across the moed's perakim.
        model.Perushim.Select(p => p.Name).Should().Equal("רש\"י", "רמב\"ן");
        model.PerushimCount.Should().Be(2);
        model.HasPerushim.Should().BeTrue();
        model.PerushimCatalogAvailable.Should().BeTrue();
        model.PerushimNotesAvailable.Should().BeTrue();
        model.PerushimEmptyMessage.Should().Be("אין פרשנות למועד זה");
        model.ShowDownloadPerushimButton.Should().BeFalse();

        // Checking a perush fills only the rows whose pasuk carries its note.
        model.ToggleCheckedPerush(1);
        model.IsPerushChecked(1).Should().BeTrue();
        var row = model.Rows.First(r => r.PerekId == 1 && r.PasukNum == 1);
        row.Pasuk!.PerushNotes.Should().ContainSingle(d => d.PerushName == "רש\"י");
        (await row.Pasuk.PerushNotes[0].ContentLoader!()).Should().Equal("inside-one");

        model.ToggleCheckedPerush(2);
        var second = model.Rows.First(r => r.PerekId == 2 && r.PasukNum == 2);
        second.Pasuk!.PerushNotes.Should().ContainSingle(d => d.PerushName == "רמב\"ן");

        // The row lookup is independent of the checked filter; unknown
        // positions return empty.
        model.GetPerushimForRow(1, 1).Select(d => d.PerushId).Should().Equal(1);
        model.GetPerushimForRow(2, 2).Select(d => d.PerushId).Should().Equal(2);
        model.GetPerushimForRow(1, 2).Should().BeEmpty();
        model.GetPerushimForRow(99, 99).Should().BeEmpty();

        // Unchecking clears that row's inline notes again.
        model.ToggleCheckedPerush(1);
        model.IsPerushChecked(1).Should().BeFalse();
        row.Pasuk.PerushNotes.Should().BeEmpty();

        // Unchecking the last perush clears every row's notes in one sweep.
        model.ToggleCheckedPerush(2);
        second.Pasuk.PerushNotes.Should().BeEmpty();
        model.CheckedPerushim.Should().BeEmpty();
    }

    [Fact]
    public async Task LoadPerushim_PreservesCheckedIds_StillAvailableInNewMoed()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");
        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.ToggleCheckedPerush(2);

        await fixture.Model.NavigateToUnitAsync(2); // covers only perek 2

        // Perush 1 has no notes inside the new moed's ranges, so it drops.
        fixture.Model.CheckedPerushim.Should().Equal(2);
        fixture.Model.Perushim.Select(p => p.Id).Should().Equal(2);
    }

    [Fact]
    public async Task LoadPerushim_MoedWithoutNotes_ClearsSelection()
    {
        const string emptyCatalogue = """
            {"data":{"moadim":[
                {"id":5,"slug":"bare","name":"מועד ריק","summary":null,"hebrewMonth":"סיוון",
                 "dateLabel":null,"annualOrder":1,"published":true,
                 "sections":[{"id":51,"label":"קריאה","position":1,"ranges":[
                    {"id":61,"position":1,"perekIdStart":3,"pasukStart":1,"perekIdEnd":3,"pasukEnd":2}
                 ]}],
                 "explicitArticleIds":[],"articles":[]}
            ]}}
            """;
        await using var fixture = new Fixture(catalogue: emptyCatalogue);
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("bare");

        var model = fixture.Model;
        model.Perushim.Should().BeEmpty(
            "no perush has notes inside the moed's ranges");
        model.CheckedPerushim.Should().BeEmpty();
        model.PerushimEmptyMessage.Should().Be("אין פרשנות למועד זה");
        // The pasuk row still loads — only commentary is absent.
        model.Rows.Where(r => r.Pasuk != null).Should().NotBeEmpty();
    }

    [Fact]
    public async Task ToggleCheckedPerush_StopsAtTheInlineLimit()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        fixture.Preferences.InlineCommentaryLimit = 1;
        await fixture.Model.LoadBySlugAsync("first");

        var model = fixture.Model;
        model.ToggleCheckedPerush(1);
        model.ToggleCheckedPerush(2); // at the cap — ignored

        model.CheckedPerushim.Should().Equal(1);
        model.PerushimLimitReached.Should().BeTrue();
        model.PerushimSelectionStatus.Should().Be("נבחרו 1 מתוך 1");
    }

    [Fact]
    public async Task PerushNameFilter_NarrowsTheSelectorList()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        fixture.Model.PerushNameFilter = "מב";

        fixture.Model.FilteredPerushim.Select(p => p.Name).Should().Equal("רמב\"ן");
        // A checked perush keeps the whole list visible even while filtered.
        fixture.Model.Perushim.Should().HaveCount(2);
        // The filter is non-empty while the list still has entries.
        fixture.Model.PerushimEmptyMessage.Should().Be("לא נמצאו פירושים תואמים");
    }

    [Fact]
    public async Task RefreshPreferences_AppliesFontFactor_AndTrimsCheckedPerushim()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");
        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.ToggleCheckedPerush(2);
        fixture.Model.FontFactor.Should().Be(1.0);

        fixture.Preferences.PasukFontPercent = 140;

        fixture.Model.FontFactor.Should().Be(1.4);

        fixture.Preferences.InlineCommentaryLimit = 1;

        fixture.Model.CheckedPerushim.Should().HaveCount(1,
            "shrinking the inline limit trims the checked set");
    }

    [Fact]
    public async Task ConvenienceCtors_DelegateToTheFullSeam()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        // The five-argument ctor wires the platform default articles
        // provider (null off-MAUI) and singleton seams.
        var fiveArg = new MoedViewModel(fixture.MoedService,
            new PerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object)),
            fixture.Preferences, fixture.Catalog, fixture.Notes);
        fiveArg.Unit.Should().BeNull();

        // The eight-argument ctor adds the test seams on top.
        var eightArg = new MoedViewModel(fixture.MoedService,
            new PerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object)),
            fixture.Preferences, fixture.Catalog, fixture.Notes,
            () => [], _ => false, _ => null);
        eightArg.Unit.Should().BeNull();
    }

    [Fact]
    public void DefaultCtor_UninitializedPreferencesService_Throws()
    {
        // PreferencesService.Instance throws before its Initialize — the
        // parameterless ctor surfaces that rather than hiding it.
        var act = () => new MoedViewModel();

        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void DefaultCtor_WithInitializedPreferencesService_Constructs()
    {
        // On the test host every singleton ctor only stores platform handles
        // (FileSystem.Current exists; only its paths are unimplemented), so
        // the parameterless ctor delegates cleanly once preferences resolve.
        PreferencesService.Initialize(new InMemoryPreferencesStorage());
        try
        {
            var vm = new MoedViewModel();

            vm.Unit.Should().BeNull();
        }
        finally
        {
            PreferencesService.ResetForTesting();
        }
    }

    [Fact]
    public async Task CrossPerekRange_ResolvesRefsThroughPerekInfo()
    {
        const string spanningCatalogue = """
            {"data":{"moadim":[
                {"id":7,"slug":"spanning","name":"מועד רוחב","summary":null,"hebrewMonth":"אלול",
                 "dateLabel":null,"annualOrder":1,"published":true,
                 "sections":[{"id":71,"label":"קריאה","position":1,"ranges":[
                    {"id":81,"position":1,"perekIdStart":1,"pasukStart":1,"perekIdEnd":2,"pasukEnd":1},
                    {"id":82,"position":2,"perekIdStart":2,"pasukStart":2,"perekIdEnd":99,"pasukEnd":3}
                 ]}],
                 "explicitArticleIds":[],"articles":[]}
            ]}}
            """;
        await using var fixture = new Fixture(catalogue: spanningCatalogue);
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("spanning");

        var header = fixture.Model.Rows.First(r => r.IsSectionHeader);
        // Same-sefer cross-perek ranges collapse the end ref to the perek
        // letter; an end perek missing from the DB falls back to its source.
        header.RefsText.Should().Contain("בראשית א א - ב א")
            .And.Contain("בראשית ב ב -  ג");
    }

    [Fact]
    public async Task LoadPerushim_StaleMoed_IsDiscarded()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        var other = fixture.MoedService.GetMoed(2)!;
        await fixture.Model.LoadPerushimAsync(other);

        // The loaded moed kept its perushim — the stale load returned early.
        fixture.Model.Unit!.Id.Should().Be(1);
        fixture.Model.Perushim.Should().HaveCount(2);
    }

    [Fact]
    public async Task LoadPerushim_UnbuiltRows_SkipsTheNoteFill()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        var unbuilt = fixture.MoedService.GetMoed(2)!;
        fixture.Model.Unit = unbuilt; // still no rows — the fill early-returns
        await fixture.Model.LoadPerushimAsync(unbuilt);

        // Perushim still resolve for the displayed moed even before its rows
        // exist — the fill just has nothing to attach to yet.
        fixture.Model.Perushim.Select(p => p.Id).Should().Equal(2);
        unbuilt.Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task LoadPerushim_WithoutNotesDb_SurfacesTheUnavailableState()
    {
        await using var fixture = new Fixture(includeNotes: false);
        await fixture.Initialize();
        await fixture.Model.LoadBySlugAsync("first");

        // No local notes file → materialization kicks, availability stays
        // false, and the selector surfaces its empty state instead of rows.
        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.HasPerushim.Should().BeFalse();
    }

    private static PerushimNotesService ExportableNotes(TestStorage storage) =>
        // Diagnostics strings reach device/app info — mock both so the report
        // builds on the unit-test host (same convention as DiagnosticsExportTests).
        new(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object,
            new Moq.Mock<IDeviceInfo>().Object, new Moq.Mock<IAppInfo>().Object);

    [Fact]
    public async Task ExportPerushimLogs_WritesReport_AndOpensShare()
    {
        var share = new Moq.Mock<IShare>();
        await using var fixture = new Fixture();
        await fixture.Initialize();
        // Rebuild the model with the injected seams (the fixture wires the
        // singleton defaults so an export failure cannot reach them).
        var model = new MoedViewModel(fixture.MoedService,
            new PerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object)),
            fixture.Preferences, fixture.Catalog, ExportableNotes(fixture.Storage),
            null, _ => false, _ => null,
            null, fixture.Storage.FileSystem.Object, share.Object);
        await model.LoadBySlugAsync("first");

        await model.ExportPerushimLogsAsync();

        share.Verify(s => s.RequestAsync(Moq.It.Is<ShareFileRequest>(r => r.File != null)), Moq.Times.Once);
        Directory.GetFiles(fixture.Storage.Root, "perushim_diagnostics_*.txt")
            .Should().NotBeEmpty("the diagnostics report lands in the cache dir");
    }

    [Fact]
    public async Task ExportPerushimLogs_WriteFailure_AlertsTheUser()
    {
        var share = new Moq.Mock<IShare>();
        var navigator = new Moq.Mock<IAppNavigator>();
        var fileSystem = new Moq.Mock<IFileSystem>();
        fileSystem.SetupGet(f => f.CacheDirectory).Throws(new IOException("denied"));
        await using var fixture = new Fixture();
        await fixture.Initialize();
        var model = new MoedViewModel(fixture.MoedService,
            new PerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object)),
            fixture.Preferences, fixture.Catalog, ExportableNotes(fixture.Storage),
            null, _ => false, _ => null,
            navigator.Object, fileSystem.Object, share.Object);
        await model.LoadBySlugAsync("first");

        await model.ExportPerushimLogsAsync();

        navigator.Verify(n => n.DisplayAlertAsync(
            "שגיאה", Moq.It.Is<string>(m => m.Contains("denied")), "אישור"), Moq.Times.Once);
        share.Verify(s => s.RequestAsync(Moq.It.IsAny<ShareFileRequest>()), Moq.Times.Never);
    }
}
