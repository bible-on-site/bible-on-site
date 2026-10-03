using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

public class PerekLoadingTests
{
    private sealed class Fixture : IAsyncDisposable
    {
        public TestStorage Storage { get; } = new();
        public Mock<IAppNavigator> Navigator { get; } = new();
        public PerekDataService Data { get; }
        public PerekViewModel Model { get; }
        public SQLite.SQLiteAsyncConnection Bible { get; private set; } = null!;

        public Fixture()
        {
            Data = new PerekDataService(new LocalDatabaseService(Storage.FileSystem.Object));
            Model = new PerekViewModel(PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()), null,
                Data, new PerushimCatalogService(Storage.FileSystem.Object),
                new PerushimNotesService(NotesDeliveryTests.Pad().Object, Storage.FileSystem.Object), Navigator.Object,
                Storage.FileSystem.Object, null);
        }

        public async Task Initialize(bool notes = true, bool allChapters = false)
        {
            Bible = await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
            await Bible.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
            await Bible.ExecuteAsync("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n < ?) INSERT INTO tanah_perek SELECT n,n,'Header' FROM ids", allChapters ? 929 : 4);
            await Bible.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (1,1,1,'qri'),(2,2,1,'qri'),(3,3,1,'qri')");
            await Bible.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (1,'בראשית'),(2,'שני'),(3,'שלישי')");
            if (notes)
            {
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
                    "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)", "INSERT INTO perush VALUES (1,'Rashi',2),(2,'Targum',1)");
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
                    "CREATE TABLE note (perush_id INTEGER,perek_id INTEGER,pasuk INTEGER,note_idx INTEGER,note_content TEXT)",
                    "INSERT INTO note VALUES (1,1,1,0,'first'),(2,1,1,0,'second'),(1,2,1,0,'next'),(99,2,1,0,'unknown')");
            }
        }

        public ValueTask DisposeAsync() => Storage.DisposeAsync();
    }

    [Fact]
    public async Task ChapterLoad_LoadsVersesAndCommentaries_AndPreservesOnlyAvailableSelections()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        var vm = fixture.Model;
        await vm.LoadByPerekIdAsync(1);
        vm.PerekId.Should().Be(1);
        vm.Perek!.Pasukim.Single().Text.Should().Be("בראשית");
        vm.Perushim.Select(p => p.Id).Should().Equal(2, 1);
        vm.PerushimCount.Should().Be(2);
        vm.HasPerushim.Should().BeTrue();
        vm.PerushimNotesAvailable.Should().BeTrue();
        vm.PerushimCatalogAvailable.Should().BeTrue();
        vm.PerushimEmptyMessage.Should().Be("אין פרשנות לפרק זה");
        vm.ShowDownloadPerushimButton.Should().BeFalse();
        vm.CheckedPerushim = [1, 2];
        await vm.LoadNextCommand.ExecuteAsync(null);
        vm.PerekId.Should().Be(2);
        vm.CheckedPerushim.Should().Equal(1);
        vm.Perushim.Select(p => p.Id).Should().Equal(1);
        vm.Perek!.Pasukim.Single().PerushNotes.Single().NoteContents.Should().Equal("next");
        await vm.LoadPreviousCommand.ExecuteAsync(null);
        vm.PerekId.Should().Be(1);
        await vm.LoadPreviousAsync();
        vm.PerekId.Should().Be(1, "the first chapter has no previous chapter");
        await vm.LoadByPerekIdAsync(99);
        vm.PerekId.Should().Be(1, "unknown chapter IDs preserve the current view");
        await vm.LoadByPerekIdAsync(4);
        vm.Perushim.Should().BeEmpty();
        vm.HasPerushim.Should().BeFalse();
        vm.CheckedPerushim.Should().BeEmpty();
    }

    [Fact]
    public async Task Carousel_PreloadsAdjacentData_AndNavigatesWithoutRebuildingCollection()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(allChapters: true);
        var vm = fixture.Model;
        await vm.InitializeCarouselAsync();
        await vm.LoadByPerekIdAsync(1);
        vm.CarouselPerakim.Should().HaveCount(929);
        vm.CurrentCarouselPerek.Should().BeSameAs(vm.Perek);
        var collection = vm.CarouselPerakim;
        await vm.NavigateToPerekAsync(2);
        vm.PerekId.Should().Be(2, "navigation also works before a page subscribes to carousel requests");
        await vm.NavigateToPerekAsync(1);
        var requests = new List<int>();
        vm.NavigationRequested += (_, id) => requests.Add(id);
        await vm.LoadNextAsync();
        vm.PerekId.Should().Be(2);
        requests.Should().Equal(2);
        vm.CarouselPerakim.Should().BeSameAs(collection);
        await vm.NavigateToPerekAsync(99);
        vm.PerekId.Should().Be(99);
        vm.Perushim.Should().BeEmpty();
        await vm.NavigateToPerekAsync(1000);
        vm.PerekId.Should().Be(99);
        await vm.NavigateToPerekAsync(929);
        await vm.LoadNextAsync();
        vm.PerekId.Should().Be(929);
        await vm.PreloadAdjacentPasukimAsync(1);
        await vm.PreloadAdjacentPasukimAsync(929);
        await vm.EnsurePasukimLoadedAsync(fixture.Data.GetPerek(3)!);
        fixture.Data.GetPerek(3)!.Pasukim.Single().Text.Should().Be("שלישי");
    }

    [Fact]
    public void SavingUnloadedChapterMetadata_DoesNotReplaceLastLearntChapter()
    {
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        preferences.LastLearntPerek = 12;
        var model = new PerekViewModel(preferences, null)
        {
            Perek = new BibleOnSite.Models.Perek
            {
                PerekId = 0, Date = "", HebDate = "", SeferName = "", SeferTanahUsName = "", Tseit = ""
            }
        };
        model.SaveLastLearntPerek();
        preferences.LastLearntPerek.Should().Be(12);
    }

    [Fact]
    public async Task Commentary_WhenPackagesMissing_ClearsPreviousNotesAndShowsDownloadState()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        await fixture.Model.LoadByPerekIdAsync(1);
        fixture.Model.PerushimEmptyMessage.Should().Be("אין קטלוג פירושים");
        fixture.Model.PerushimCatalogAvailable = true;
        fixture.Model.PerushimEmptyMessage.Should().Be("להוריד פירושים");
        fixture.Model.ShowDownloadPerushimButton.Should().BeTrue();
        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.Perek!.Pasukim.Single().PerushNotes.Should().BeEmpty();
        await fixture.Model.PreloadAdjacentPasukimAsync(2);
    }

    [Fact]
    public async Task Today_LoadsDataBeforeSelectingChapter_AndAvoidsRedundantNavigation()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        await fixture.Model.LoadTodayCommand.ExecuteAsync(null);
        fixture.Model.PerekId.Should().Be(fixture.Data.GetTodaysPerekId());
        var current = fixture.Model.Perek;
        await fixture.Model.LoadTodayAsync();
        fixture.Model.Perek.Should().BeSameAs(current);
    }

    [Fact]
    public async Task Preload_WhenNotesQueryFails_StillLoadsAdjacentVerses()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        await fixture.Model.LoadByPerekIdAsync(1);
        // Chapter 20 is outside the initial preload buffer.
        var notes = new SQLite.SQLiteAsyncConnection(Path.Combine(fixture.Storage.Root, "sefaria-dump-5784-sivan-4.perushim_notes.sqlite"));
        await notes.ExecuteAsync("DROP TABLE note");
        await fixture.Model.PreloadAdjacentPasukimAsync(20);
        fixture.Model.PerekId.Should().Be(1);
        fixture.Model.CarouselPerakim.Should().HaveCount(4);
    }

    [Fact]
    public async Task StalePerushimLoad_ForAPerekAlreadyLeft_DoesNotOverwriteCurrentPerek()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        var vm = fixture.Model;
        await vm.LoadByPerekIdAsync(2);
        vm.CheckedPerushim = [1];
        await vm.LoadPerushimAsync(2);

        // A swipe away from perek 1 left its load in flight; it completes after perek 2 is on screen.
        await vm.LoadPerushimAsync(1);

        vm.Perushim.Select(p => p.Id).Should().Equal(1);
        vm.Perek!.Pasukim.Single().PerushNotes.Single().NoteContents.Should().Equal("next");
    }

    private sealed class UiContext : SynchronizationContext
    {
        public override void Post(SendOrPostCallback d, object? state) => ThreadPool.QueueUserWorkItem(_ =>
        {
            SetSynchronizationContext(this);
            d(state);
        });
    }

    [Fact]
    public async Task PreloadAdjacentPasukim_AssignsBoundPasukimOnTheCallersContext()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(allChapters: true);
        await fixture.Data.LoadAsync();
        var adjacent = fixture.Data.GetPerek(3)!;
        SynchronizationContext? assignedOn = null;
        adjacent.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Perek.Pasukim)) assignedOn = SynchronizationContext.Current;
        };

        var previous = SynchronizationContext.Current;
        var ui = new UiContext();
        SynchronizationContext.SetSynchronizationContext(ui);
        try
        {
            await fixture.Model.PreloadAdjacentPasukimAsync(2);
        }
        finally
        {
            SynchronizationContext.SetSynchronizationContext(previous);
        }

        adjacent.Pasukim.Single().Text.Should().Be("שלישי");
        assignedOn.Should().BeSameAs(ui, "carousel cells bind Pasukim, so it must not change on a background thread");
    }
}
