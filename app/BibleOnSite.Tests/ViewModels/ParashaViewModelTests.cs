using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// פרשה על הפרק reader view-model: canonical selection keyed by
/// (perekId, pasuk), deep links and resume resolution over Torah ranges,
/// bounded perushim, deduplicated articles and recitation availability
/// across multi-perek units.
/// </summary>
public class ParashaViewModelTests
{
    private sealed class Fixture : IAsyncDisposable
    {
        public TestStorage Storage { get; } = new();
        public InMemoryPreferencesStorage Prefs { get; } = new();
        public PreferencesService Preferences { get; }
        public ParashaViewModel Model { get; }
        public ParashaDataService Parasha { get; }
        public PerushimNotesService Notes { get; }
        private readonly bool _includeCatalog;
        private readonly bool _includeNotes;

        public Fixture(List<Article>? articles = null, int? lastLearntPerek = null,
            bool includeCatalog = true, bool includeNotes = true, bool nullArticlesLoader = false,
            Func<int, Task<List<Article>>>? articlesLoader = null,
            Func<int, bool>? hasPerekAudio = null)
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
            Notes = notes;
            Preferences = PreferencesService.CreateForTesting(Prefs);
            Preferences.Load();
            var localDb = new LocalDatabaseService(Storage.FileSystem.Object);
            Parasha = new ParashaDataService(localDb);
            Model = new ParashaViewModel(
                Parasha,
                new PerekDataService(localDb),
                Preferences,
                catalog,
                notes,
                nullArticlesLoader ? null
                    : articlesLoader ?? (_ => Task.FromResult(articles ?? new List<Article>())),
                // Never touch RecitationService.Instance — its lazy filesystem
                // singleton has no host in a unit-test process.
                hasPerekAudio ?? (_ => false));
        }

        public async Task Initialize()
        {
            await ParashaDataServiceTests.SeedAsync(Storage);

            if (_includeCatalog)
            {
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
                    "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)",
                    "INSERT INTO perush VALUES (1,'Rashi',1),(2,'Ramban',2)",
                    "CREATE TABLE _metadata (key TEXT,value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','100')");
            }
            if (_includeNotes)
            {
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
                    [.. NotesDbV2.Statements(
                        (1, 1, 2, 0, "inside"),
                        (2, 1, 2, 0, "ramban-inside"),
                        (1, 3, 5, 0, "unit2-note"),
                        (1, 1, 1, 0, "outside")),
                        "INSERT INTO _metadata VALUES ('build_timestamp','100')"]);
            }
        }

        public ValueTask DisposeAsync() => Storage.DisposeAsync();
    }

    [Fact]
    public async Task LoadByUnitId_InitializesCarouselPositionAndOffscreenFlags()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.CarouselUnits.Should().HaveCount(2);
        fixture.Model.UnitPositionText.Should().Be("פרשה 1 מתוך 2");
        fixture.Model.UnitOrder.Should().Be(1);
        fixture.Model.SeferId.Should().Be(1);
        fixture.Model.CurrentCarouselUnit.Should().BeSameAs(fixture.Model.Unit);
        // The live page stays in the accessibility tree; every other
        // carousel unit is excluded.
        fixture.Model.Unit!.IsOffscreenCarouselPage.Should().BeFalse();
        fixture.Model.CarouselUnits[1].IsOffscreenCarouselPage.Should().BeTrue();
    }

    [Fact]
    public async Task NavigateToUnit_FiresCarouselIndexAndLoadsRows()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var requested = new List<int>();
        fixture.Model.NavigationRequested += (_, index) => requested.Add(index);

        await fixture.Model.NavigateToUnitAsync(2);

        fixture.Model.UnitId.Should().Be(2);
        requested.Should().Equal(1); // index of unit 2 in the carousel
        fixture.Model.Unit!.Rows.Should().NotBeEmpty();
    }

    [Fact]
    public async Task NavigateToUnit_BeforeCarouselInit_DoesFullLoad()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        // With no unit on screen the carousel initializer is a no-op.
        await fixture.Model.InitializeCarouselAsync();
        fixture.Model.CarouselUnits.Should().BeEmpty();

        await fixture.Model.NavigateToUnitAsync(2);

        fixture.Model.UnitId.Should().Be(2);
        fixture.Model.CarouselUnits.Should().HaveCount(2);
    }

    [Fact]
    public async Task ToggleSelectedPasuk_KeysByCanonicalPerekAndPasuk()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        // The same pasuk number exists in different covered perakim and in
        // the Haftarah sections — canonical keys keep them distinct.
        fixture.Model.ToggleSelectedPasuk(1, 2);
        fixture.Model.ToggleSelectedPasuk(2, 2);

        fixture.Model.SelectedPasukCount.Should().Be(2);
        fixture.Model.IsPasukSelected(1, 2).Should().BeTrue();
        fixture.Model.IsPasukSelected(2, 2).Should().BeTrue();
        fixture.Model.IsPasukSelected(4, 2).Should().BeFalse();

        // Every rendered copy of the canonical pasuk reflects the selection
        // (the Haftarah section of unit 1 does not repeat perek 2, but the
        // flag contract is per (perekId, pasuk) row).
        fixture.Model.Unit!.Rows
            .Where(r => r.Display is not null && r.PerekId == 1 && r.PasukNum == 2)
            .Should().OnlyContain(r => r.Display!.Pasuk.IsSelected);

        // Selected pesukim come back in reader order for copy/share.
        var pesukim = fixture.Model.GetSelectedPesukim();
        pesukim.Select(p => p.PerekId).Should().Equal(1, 2);
        pesukim.Select(p => p.Pasuk.PasukNum).Should().Equal(2, 2);

        // Toggling again removes just that canonical position.
        fixture.Model.ToggleSelectedPasuk(1, 2);
        fixture.Model.IsPasukSelected(1, 2).Should().BeFalse();
        fixture.Model.IsPasukSelected(2, 2).Should().BeTrue();

        fixture.Model.ClearSelected();
        fixture.Model.SelectedPasukCount.Should().Be(0);
        fixture.Model.Unit!.Rows.Should().OnlyContain(r => r.Display == null || !r.Display.Pasuk.IsSelected);
    }

    [Fact]
    public async Task Selection_WithoutUnit_StaysEmpty()
    {
        await using var fixture = new Fixture();
        fixture.Model.ToggleSelectedPasuk(1, 1);
        fixture.Model.SelectedPasukCount.Should().Be(1);
        fixture.Model.GetSelectedPesukim().Should().BeEmpty();
        fixture.Model.ClearSelected();
        fixture.Model.SelectedPasukCount.Should().Be(0);
    }

    [Fact]
    public async Task GetInitialUnitId_ResolvesLastLearntPerekInsideTorahRange()
    {
        // בראשית ג sits inside unit 1's Torah range (perek 1-3).
        await using var inside = new Fixture(lastLearntPerek: 3);
        await inside.Initialize();
        (await inside.Model.GetInitialUnitIdAsync()).Should().Be(1);

        // A perek outside every Torah range falls back to the first unit.
        await using var outside = new Fixture(lastLearntPerek: 5);
        await outside.Initialize();
        (await outside.Model.GetInitialUnitIdAsync()).Should().Be(1);
    }

    [Fact]
    public async Task GetUnitIdForPerek_MatchesTorahRangesOnly()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        // Perek 3 is inside both units' Torah ranges — first candidate wins.
        (await fixture.Model.GetUnitIdForPerekAsync(3)).Should().Be(1);
        // Haftarah perakim resolve to null so hits open the perek reader.
        (await fixture.Model.GetUnitIdForPerekAsync(4)).Should().BeNull();
        (await fixture.Model.GetUnitIdForPerekAsync(9)).Should().BeNull();

        // The sync surface serves callers that already hold a loaded service.
        fixture.Model.GetUnitIdForPerek(3).Should().Be(1);
        fixture.Model.GetUnitIdForPerek(4).Should().BeNull();
    }

    [Fact]
    public async Task GetUnitIdForPasuk_UsesExactCanonicalBounds()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        (await fixture.Model.GetUnitIdForPasukAsync(3, 5)).Should().Be(2);
        (await fixture.Model.GetUnitIdForPasukAsync(3, 4)).Should().Be(1);
        // Unit 1's Torah range starts at בראשית א ב — pasuk 1 is uncovered.
        (await fixture.Model.GetUnitIdForPasukAsync(1, 1)).Should().BeNull();
        (await fixture.Model.GetUnitIdForPasukAsync(4, 1)).Should().BeNull();
    }

    [Fact]
    public async Task UnitContainsPasuk_RespectsTorahAndHaftarahBounds()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var unit = fixture.Model.Unit!;

        fixture.Model.UnitContainsPasuk(unit, 1, 2).Should().BeTrue();
        fixture.Model.UnitContainsPasuk(unit, 1, 1).Should().BeFalse(); // before the range start
        fixture.Model.UnitContainsPasuk(unit, 3, 4).Should().BeTrue();
        fixture.Model.UnitContainsPasuk(unit, 3, 5).Should().BeFalse(); // past the range end
        fixture.Model.UnitContainsPasuk(unit, 4, 1).Should().BeTrue();  // Haftarah rows count too
        fixture.Model.UnitContainsPasuk(unit, 5, 5).Should().BeFalse();
        fixture.Model.GetParashaContainingPasuk(3, 5)!.UnitId.Should().Be(2);
        fixture.Model.GetParashaContainingPasuk(4, 1).Should().BeNull();
    }

    [Fact]
    public async Task EnsureRowsLoaded_IsIdempotent()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var other = fixture.Model.CarouselUnits[1];
        other.Rows.Should().BeEmpty();

        await fixture.Model.EnsureRowsLoadedAsync(other);
        other.Rows.Should().NotBeEmpty();
        other.TikkunPasukim.Should().NotBeEmpty();
        var first = other.Rows;
        await fixture.Model.EnsureRowsLoadedAsync(other);
        other.Rows.Should().BeSameAs(first);
    }

    [Fact]
    public async Task RebuildLoadedRows_RebuildsLoadedUnitsOnly()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var torahPesukim = fixture.Model.Unit!.Rows.Count(r => r.Pasuk is not null && r.PerekId <= 3);

        fixture.Model.IsShnayimMikraEnabled = true;
        await fixture.Model.RebuildLoadedRowsAsync();

        // שניים מקרא doubles the Torah section's pasuk rows.
        fixture.Model.Unit!.Rows.Count(r => r.Pasuk is not null && r.PerekId <= 3)
            .Should().Be(torahPesukim * 2);
        // Unloaded carousel units stay lightweight.
        fixture.Model.CarouselUnits[1].Rows.Should().BeEmpty();
    }

    [Fact]
    public async Task PreferenceChange_RefreshesFontAndMaskingState()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        async Task ApplyPreferenceAsync(Action change)
        {
            var rowsUpdated = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var unit = fixture.Model.Unit!;
            void OnRowsChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs args)
            {
                if (args.PropertyName == nameof(ParashaUnit.Rows))
                {
                    rowsUpdated.TrySetResult();
                }
            }

            unit.PropertyChanged += OnRowsChanged;
            try
            {
                change();
                // Preference refreshes read SQLite asynchronously. Let the
                // resulting rows arrive before the next change or teardown.
                await rowsUpdated.Task.WaitAsync(TestContext.Current.CancellationToken);
            }
            finally
            {
                unit.PropertyChanged -= OnRowsChanged;
            }
        }

        // A preference change reaches the view-model through the weak
        // subscription and refreshes reader state.
        await ApplyPreferenceAsync(() => fixture.Preferences.FontFactor = 1.5);
        fixture.Model.FontFactor.Should().Be(1.5);

        await ApplyPreferenceAsync(() => fixture.Model.DivineNameMaskingEnabled = false);
        fixture.Model.DivineNameMaskingEnabled.Should().BeFalse();
        fixture.Prefs.Get("divineNameMaskingEnabled", true).Should().BeFalse();
    }

    [Fact]
    public async Task LoadPerushim_FiltersNotesToUnitBounds()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.Perushim.Select(p => p.Name).Should().BeEquivalentTo("Rashi", "Ramban");
        fixture.Model.HasPerushim.Should().BeTrue();
        fixture.Model.FilteredPerushim.Should().NotBeEmpty();

        // The selection-menu search narrows the list without hiding entries.
        fixture.Model.PerushNameFilter = "Ramb";
        fixture.Model.FilteredPerushim.Select(p => p.Name).Should().Equal("Ramban");
        fixture.Model.PerushimEmptyMessage.Should().Be("לא נמצאו פירושים תואמים");
        fixture.Model.PerushNameFilter = string.Empty;

        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.IsPerushChecked(1).Should().BeTrue();

        // Inside the Torah range both perush notes attach to the row —
        // GetPerushimForRow reports availability independent of check state.
        var rowNotes = fixture.Model.GetPerushimForRow(1, 2);
        rowNotes.Should().HaveCount(2);
        (await rowNotes[0].ContentLoader!())[0].Should().Be("inside");
        // Checking Rashi fills exactly its display on the rendered row.
        fixture.Model.Unit!.Rows
            .Single(r => r.Display is not null && r.PerekId == 1 && r.PasukNum == 2)
            .Display!.Pasuk.PerushNotes.Should().ContainSingle();

        // Pesukim outside the unit's rendered rows never leak notes.
        fixture.Model.GetPerushimForRow(1, 1).Should().BeEmpty();
        fixture.Model.GetPerushimForRow(3, 5).Should().BeEmpty();

        // A perush still available in the next unit stays checked across
        // navigation; a fresh model with no unit reports no notes.
        await fixture.Model.NavigateToUnitAsync(2);
        fixture.Model.IsPerushChecked(1).Should().BeTrue();
        fixture.Model.GetPerushimForRow(3, 5).Should().ContainSingle();
        await using var bare = new Fixture();
        bare.Model.GetPerushimForRow(1, 1).Should().BeEmpty();
    }

    [Fact]
    public async Task ToggleCheckedPerush_UncheckClearsInlineNotes()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.InlineCommentaryLimit.Should().Be(5);
        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.ToggleCheckedPerush(2);
        fixture.Model.Unit!.Rows
            .Single(r => r.Display != null && r.PerekId == 1 && r.PasukNum == 2)
            .Display!.Pasuk.PerushNotes.Should().HaveCount(2);

        // Unchecking the last perush clears every row's notes entirely.
        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.ToggleCheckedPerush(2);
        fixture.Model.Unit!.Rows.Should().OnlyContain(r =>
            r.Display == null || r.Display.Pasuk.PerushNotes.Count == 0);

        // Toggling an id outside the catalog still registers — the picker
        // only ever sends catalog ids, but the API itself does not gate.
        fixture.Model.ToggleCheckedPerush(9);
        fixture.Model.IsPerushChecked(9).Should().BeTrue();
    }

    [Fact]
    public async Task InlineCommentaryLimitShrink_TrimsCheckedPerushim()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.ToggleCheckedPerush(2);

        fixture.Preferences.InlineCommentaryLimit = 1;

        fixture.Model.CheckedPerushim.Should().BeEquivalentTo(new[] { 1 });
    }

    [Fact]
    public async Task PerushimSelectionStatus_ReflectsCheckedCountOutOfConfiguredLimit()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.PerushimSelectionStatus.Should().Be("נבחרו 0 מתוך 5");
        fixture.Model.PerushimLimitReached.Should().BeFalse();

        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.ToggleCheckedPerush(2);

        fixture.Model.PerushimSelectionStatus.Should().Be("נבחרו 2 מתוך 5");
        fixture.Model.PerushimLimitReached.Should().BeFalse();

        fixture.Preferences.InlineCommentaryLimit = 2;

        fixture.Model.PerushimLimitReached.Should().BeTrue();
    }

    [Fact]
    public async Task LoadPerushim_UnitWithoutNotes_EmptiesTheCatalog()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        // A unit whose covered perakim carry no notes at all clears the
        // catalog rather than keeping the previous unit's list.
        var empty = new ParashaUnit
        {
            UnitId = 9, Slug = "9", SeferId = 1, SeferName = "בראשית",
            Order = 9, Heading = "ריקה",
            TorahRange = new ScriptureRange { StartPerekId = 9, StartPasuk = 1, EndPerekId = 9, EndPasuk = 5 }
        };
        fixture.Model.Unit = empty;
        await fixture.Model.LoadPerushimAsync(empty);

        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.HasPerushim.Should().BeFalse();
    }

    [Fact]
    public async Task LoadPerushim_StaleUnit_IsDropped()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        // A load resolving for a unit that is no longer current is dropped.
        var stale = fixture.Model.CarouselUnits[1];
        await fixture.Model.LoadPerushimAsync(stale);

        fixture.Model.Perushim.Select(p => p.Name).Should().BeEquivalentTo("Rashi", "Ramban");
    }

    [Fact]
    public async Task ShowPerushForSearch_KeepsSearchedPerushWithinLimit()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.ShowPerushForSearch(2);

        fixture.Model.IsPerushChecked(2).Should().BeTrue();
        fixture.Model.InlineCommentaryLimitMessage.Should().Contain("5");
    }

    [Fact]
    public async Task PerushimEmptyMessage_AndDownloadButton_FollowAvailability()
    {
        await using var noNotes = new Fixture(includeNotes: false);
        await noNotes.Initialize();
        await noNotes.Model.LoadByUnitIdAsync(1);

        // First-launch notes materialization is kicked, not awaited — see #2430.
        // The page reloads perushim once the operation settles; emulate that here.
        await noNotes.Notes.InitializeAsync();
        await noNotes.Model.LoadPerushimAsync(noNotes.Model.Unit!);

        noNotes.Model.PerushimCatalogAvailable.Should().BeTrue();
        noNotes.Model.PerushimNotesAvailable.Should().BeFalse();
        noNotes.Model.ShowDownloadPerushimButton.Should().BeTrue();
        noNotes.Model.PerushimEmptyMessage.Should().NotBeEmpty();

        await using var noCatalog = new Fixture(includeCatalog: false, includeNotes: false);
        await noCatalog.Initialize();
        await noCatalog.Model.LoadByUnitIdAsync(1);

        await noCatalog.Notes.InitializeAsync();
        await noCatalog.Model.LoadPerushimAsync(noCatalog.Model.Unit!);

        noCatalog.Model.PerushimCatalogAvailable.Should().BeFalse();
        noCatalog.Model.ShowDownloadPerushimButton.Should().BeFalse();
        noCatalog.Model.PerushimEmptyMessage.Should().Be("אין קטלוג פירושים");
    }

    [Fact]
    public async Task LoadArticles_UnionsAndDeduplicatesAcrossCoveredPerakim()
    {
        var articles = new List<Article>
        {
            new() { Id = 7, Abstract = "a", AuthorId = 1, PerekId = 1 },
            new() { Id = 9, Abstract = "b", AuthorId = 1, PerekId = 2 },
        };
        await using var fixture = new Fixture(articles);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        // Every covered perek (Torah + Haftarah) returns the same list
        // so dedup by id keeps each article once.
        await fixture.Model.LoadArticlesAsync(fixture.Model.Unit!);

        fixture.Model.Articles.Select(a => a.Id).Should().BeEquivalentTo(new[] { 7, 9 });
        fixture.Model.ArticlesCount.Should().Be(2);
        fixture.Model.HasArticles.Should().BeTrue();
        fixture.Model.Unit!.ArticlesCount.Should().Be(2);
    }

    [Fact]
    public async Task LoadArticles_StaleUnitIsIgnored()
    {
        var articles = new List<Article> { new() { Id = 7, Abstract = "a", AuthorId = 1, PerekId = 1 } };
        await using var fixture = new Fixture(articles);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var stale = fixture.Model.CarouselUnits[1];

        // A load resolving for a unit that is no longer current is dropped.
        await fixture.Model.LoadArticlesAsync(stale);

        fixture.Model.Articles.Should().BeEmpty();
    }

    [Fact]
    public async Task LoadArticles_NullLoaderClearsArticles()
    {
        await using var fixture = new Fixture(nullArticlesLoader: true);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        await fixture.Model.LoadArticlesAsync(fixture.Model.Unit!);

        fixture.Model.Articles.Should().BeEmpty();
        fixture.Model.Unit!.ArticlesCount.Should().Be(0);
    }

    [Fact]
    public async Task RecitationAvailability_AnyCoveredPerekTrackEnablesPlayback()
    {
        // Audio installed only on a Haftarah perek still counts — the reader
        // plays whatever slices of the unit have tracks.
        await using var fixture = new Fixture(hasPerekAudio: perekId => perekId == 4);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.HasCurrentUnitRecitation.Should().BeTrue();
        // קריינות ships on globally (#2472), so downloaded audio surfaces the
        // header button immediately; turning the preference off hides it.
        fixture.Model.IsQriynotEnabled.Should().BeTrue();
        fixture.Model.ShowHeaderPlayButton.Should().BeTrue();
        fixture.Model.IsQriynotEnabled = false;
        fixture.Model.ShowHeaderPlayButton.Should().BeFalse();

        await fixture.Model.NavigateToUnitAsync(2);
        fixture.Model.HasCurrentUnitRecitation.Should().BeTrue(); // unit 2's ספרדים covers perek 4
    }

    [Fact]
    public async Task RecitationAvailability_NoAudio_DisablesPlayback()
    {
        await using var fixture = new Fixture(hasPerekAudio: _ => false);
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.HasCurrentUnitRecitation.Should().BeFalse();
        fixture.Model.IsQriynotEnabled = true;
        fixture.Model.ShowHeaderPlayButton.Should().BeFalse();

        fixture.Model.RefreshRecitationAvailability();
        fixture.Model.ShowHeaderPlayButton.Should().BeFalse();
    }

    [Fact]
    public async Task RangeLabel_PublicSurfaceMatchesUnitLabel()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        var range = fixture.Model.Unit!.TorahRange;
        fixture.Model.RangeLabelOf(range).Should().Be(fixture.Model.Unit!.RangeLabel);
        fixture.Model.Unit!.RangeLabel.Should().Be("בראשית א ב - ג ד");
    }

    [Fact]
    public async Task TikkunFlow_HasNoHeadersAndNoRepeatedCopies()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        var tikkun = fixture.Model.Unit!.TikkunPasukim;
        // Tikkun is canonical pesukim only: תורה (13) + אשכנזים (4) + תימנים (6).
        tikkun.Should().HaveCount(23);
        tikkun.Should().OnlyContain(p => p != null);
    }

    [Fact]
    public async Task LoadNextAndPrevious_WalkCanonicalUnitOrder()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.Title.Should().Be("פרשת בראשית");
        fixture.Model.NextUnitId.Should().Be(2);
        fixture.Model.PreviousUnitId.Should().Be(0);
        fixture.Model.CanGoToNextUnit.Should().BeTrue();
        fixture.Model.CanGoToPreviousUnit.Should().BeFalse();

        await fixture.Model.LoadPreviousAsync(); // no previous unit — a no-op
        fixture.Model.UnitId.Should().Be(1);

        await fixture.Model.LoadNextAsync();
        fixture.Model.UnitId.Should().Be(2);
        fixture.Model.Title.Should().Be("פרשת נח");
        fixture.Model.CanGoToNextUnit.Should().BeFalse();
        fixture.Model.CanGoToPreviousUnit.Should().BeTrue();

        await fixture.Model.LoadNextAsync(); // no next unit — a no-op
        fixture.Model.UnitId.Should().Be(2);

        await fixture.Model.LoadPreviousAsync();
        fixture.Model.UnitId.Should().Be(1);
    }

    [Fact]
    public async Task Unit_ExposesOnlyTheDisplayedPageToAccessibility()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        var first = fixture.Model.Unit!;
        first.IsOffscreenCarouselPage.Should().BeFalse();

        await fixture.Model.LoadByUnitIdAsync(2);
        first.IsOffscreenCarouselPage.Should().BeTrue();
        fixture.Model.Unit!.IsOffscreenCarouselPage.Should().BeFalse();

        // A stale CurrentItem pushback must not re-hide the displayed page
        // (the carousel does not push CurrentItem on programmatic ScrollTo).
        var stale = fixture.Model.CarouselUnits[0];
        fixture.Model.CurrentCarouselUnit = stale;
        fixture.Model.Unit!.IsOffscreenCarouselPage.Should().BeFalse();
        stale.IsOffscreenCarouselPage.Should().BeTrue();
    }

    [Fact]
    public async Task PreloadAdjacentRows_FillsUnitsInsideTheBuffer()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        var other = fixture.Model.CarouselUnits[1];
        other.Rows.Should().BeEmpty();

        await fixture.Model.PreloadAdjacentRowsAsync(1);
        other.Rows.Should().NotBeEmpty();

        // A second pass finds everything already loaded — nothing to do.
        await fixture.Model.PreloadAdjacentRowsAsync(1);

        // Unknown center ids and a catalog that never loaded are both no-ops.
        await fixture.Model.PreloadAdjacentRowsAsync(999);
        await using var unloaded = new Fixture();
        await unloaded.Model.PreloadAdjacentRowsAsync(1); // service not loaded
    }

    [Fact]
    public async Task TikkunMode_RestoresMarksWhenDisabled()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        fixture.Model.Heading.Should().Be("בראשית");
        fixture.Model.IsTikkunKorimEnabled = true;
        fixture.Model.TikkunMarksHidden = true;
        fixture.Model.IsTikkunKorimEnabled = false;

        fixture.Model.TikkunMarksHidden.Should().BeFalse();
    }

    [Fact]
    public async Task LoadByUnitId_UnknownUnit_KeepsReaderState()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadByUnitIdAsync(999);
        fixture.Model.Unit.Should().BeNull();

        await fixture.Model.LoadByUnitIdAsync(1);
        await fixture.Model.LoadByUnitIdAsync(999);
        fixture.Model.UnitId.Should().Be(1);
    }

    [Fact]
    public async Task UnloadedModel_ExposesEmptyUnitSurface()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        fixture.Model.UnitId.Should().Be(0);
        fixture.Model.Heading.Should().BeEmpty();
        fixture.Model.Title.Should().BeEmpty();
        fixture.Model.SeferId.Should().Be(0);
        fixture.Model.UnitOrder.Should().Be(0);
        fixture.Model.UnitPositionText.Should().BeEmpty();
    }

    [Fact]
    public async Task LoadPerushim_WithoutACurrentUnit_IsDropped()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        // Services are available but no unit is on screen — the stale-load
        // guard treats the resolved catalog as belonging to no one.
        var orphan = new ParashaUnit
        {
            UnitId = 1, Slug = "1", SeferId = 1, SeferName = "בראשית",
            Order = 1, Heading = "בראשית",
            TorahRange = new ScriptureRange { StartPerekId = 1, StartPasuk = 2, EndPerekId = 3, EndPasuk = 4 }
        };

        await fixture.Model.LoadPerushimAsync(orphan);

        fixture.Model.Perushim.Should().BeEmpty();
    }

    [Fact]
    public async Task ShowPerushForSearch_AlreadyChecked_IsANoOp()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        fixture.Model.ToggleCheckedPerush(2);

        // Re-showing the same perush must not evict it from the list.
        fixture.Model.ShowPerushForSearch(2);

        fixture.Model.CheckedPerushim.Should().Equal(2);
    }

    [Fact]
    public async Task ToggleCheckedPerush_AtTheLimit_RejectsNewPerushim()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);
        fixture.Preferences.InlineCommentaryLimit = 1;

        fixture.Model.ToggleCheckedPerush(1);
        fixture.Model.ToggleCheckedPerush(2);

        fixture.Model.CheckedPerushim.Should().Equal(1);
    }

    [Fact]
    public async Task ToggleCheckedPerush_WithoutUnit_StillTracksChecks()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        // With no unit on screen the toggle updates the checked list and
        // skips the per-row refill entirely.
        fixture.Model.ToggleCheckedPerush(1);

        fixture.Model.CheckedPerushim.Should().Equal(1);
    }

    [Fact]
    public async Task GetPerushimForRow_CoveredPerekWithoutChapter_YieldsEmpty()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByUnitIdAsync(1);

        // Perek 4 is rendered by the Haftarah section but its chapter never
        // loaded — the lookup falls back to an empty list.
        fixture.Model.GetPerushimForRow(4, 1).Should().BeEmpty();
    }

    [Fact]
    public async Task RecitationAvailability_NoUnit_StaysDisabled()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        // No unit on screen — nothing can have audio.
        fixture.Model.RefreshRecitationAvailability();
        fixture.Model.HasCurrentUnitRecitation.Should().BeFalse();
    }

    [Fact]
    public async Task LoadArticles_WithoutACurrentUnit_IsDropped()
    {
        var articles = new List<Article> { new() { Id = 7, Abstract = "a", AuthorId = 1, PerekId = 1 } };
        await using var fixture = new Fixture(articles);
        await fixture.Initialize();
        var orphan = new ParashaUnit
        {
            UnitId = 1, Slug = "1", SeferId = 1, SeferName = "בראשית",
            Order = 1, Heading = "בראשית",
            TorahRange = new ScriptureRange { StartPerekId = 1, StartPasuk = 2, EndPerekId = 3, EndPasuk = 4 }
        };

        await fixture.Model.LoadArticlesAsync(orphan);

        fixture.Model.Articles.Should().BeEmpty();
    }

    [Fact]
    public async Task CommentaryLimitShrink_WithoutUnit_SkipsTheRowRefill()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        fixture.Model.CheckedPerushim = [1, 2];

        // The preference listener trims the checked list even while no unit
        // is loaded — the per-row refill is skipped instead of crashing.
        fixture.Preferences.InlineCommentaryLimit = 1;

        fixture.Model.CheckedPerushim.Should().Equal(1);
    }

    [Fact]
    public async Task DefaultArticlesLoader_ReadsTheStarterSnapshot()
    {
        // The production loader reads StarterService's in-memory snapshot —
        // an unloaded snapshot just yields an empty list.
        var loader = (Func<int, Task<List<Article>>>)typeof(ParashaViewModel)
            .GetProperty("DefaultArticlesLoader", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static)!
            .GetValue(null)!;

        (await loader(1)).Should().BeEmpty();
    }
}
