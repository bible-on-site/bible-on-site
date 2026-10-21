using System.Runtime.ExceptionServices;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

[Collection("Process environment")]
public class PerekLoadingTests
{
    private sealed class Fixture : IAsyncDisposable
    {
        public TestStorage Storage { get; } = new();
        public Mock<IPadDeliveryService> Pad { get; } = NotesDeliveryTests.Pad();
        public Mock<IAppNavigator> Navigator { get; } = new();
        public PerekDataService Data { get; }
        public PerushimNotesService Notes { get; }
        public PerekViewModel Model { get; }
        public SQLite.SQLiteAsyncConnection Bible { get; private set; } = null!;

        public Fixture()
        {
            Data = new PerekDataService(new LocalDatabaseService(Storage.FileSystem.Object));
            Notes = new PerushimNotesService(Pad.Object, Storage.FileSystem.Object);
            Model = new PerekViewModel(PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()), null,
                Data, new PerushimCatalogService(Storage.FileSystem.Object),
                Notes, Navigator.Object,
                Storage.FileSystem.Object, null);
        }

        public async Task Initialize(bool notes = true, bool allChapters = false, bool corruptAdjacentBlob = false)
        {
            Bible = await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
            await Bible.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
            await Bible.ExecuteAsync("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n < ?) INSERT INTO tanah_perek SELECT n,n,'Header' FROM ids", allChapters ? 929 : 4);
            await Bible.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (1,1,1,'qri'),(2,2,1,'qri'),(3,3,1,'qri')");
            await Bible.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (1,'בראשית'),(2,'שני'),(3,'שלישי')");
            if (notes)
            {
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
                    "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)", "INSERT INTO perush VALUES (1,'Rashi',2),(2,'Targum',1)",
                    "CREATE TABLE _metadata (key TEXT,value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','100')");
                await Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
                    [.. NotesDbV2.Statements(
                        (1, 1, 1, 0, "first"), (2, 1, 1, 0, "second"), (1, 2, 1, 0, "next"), (99, 2, 1, 0, "unknown")),
                    // Perek 2 keeps its perush index rows but its chapter blob is
                    // not PNB1 — init only checks schema, so the parse throws the
                    // first time the adjacent-perek preload touches it.
                    .. (corruptAdjacentBlob
                        ? new[] { "UPDATE note_blob SET data = X'DEADBEEF' WHERE perek_id = 2" }
                        : Array.Empty<string>()),
                    "INSERT INTO _metadata VALUES ('build_timestamp','100')"]);
            }
        }

        public async ValueTask DisposeAsync()
        {
            // LoadPerushimAsync may leave a kicked notes init in flight — let
            // it settle before the temp storage is deleted underneath it. A
            // faulted init is a defect, not teardown noise: record it, still
            // clean the storage, then surface it as a test failure. When both
            // legs fault, keep both diagnostics.
            var initError = await Notes.InitializeAsync().ContinueWith(task => task.Exception);
            var storageError = await Storage.DisposeAsync().AsTask().ContinueWith(task => task.Exception);
            var failures = new[] { initError, storageError }
                .Where(error => error is not null)
                .SelectMany(error => error!.InnerExceptions)
                .ToList();
            if (failures.Count == 1)
            {
                ExceptionDispatchInfo.Capture(failures[0]).Throw();
            }
            else if (failures.Count > 1)
            {
                throw new AggregateException("Fixture teardown failed.", failures);
            }
        }
    }

    [Fact]
    public async Task Teardown_WhenNotesInitFaults_StillDeletesStorage_AndSurfacesTheFailure()
    {
        var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        fixture.Pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("delivery probe exploded"));
        await fixture.Model.LoadByPerekIdAsync(1); // kicks the notes init that now faults

        var dispose = () => fixture.DisposeAsync().AsTask();
        await dispose.Should().ThrowAsync<InvalidOperationException>();
        Directory.Exists(fixture.Storage.Root).Should().BeFalse("storage cleanup must still run when init fails");
    }

    [Fact]
    public async Task Teardown_WhenInitAndStorageBothFault_KeepsBothFailures()
    {
        var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        fixture.Pad.Setup(p => p.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("delivery probe exploded"));
        await fixture.Model.LoadByPerekIdAsync(1);
        Directory.Delete(fixture.Storage.Root, true);

        var dispose = () => fixture.DisposeAsync().AsTask();
        var thrown = await dispose.Should().ThrowAsync<AggregateException>();
        thrown.Which.InnerExceptions.Select(e => e.GetType())
            .Should().BeEquivalentTo([typeof(InvalidOperationException), typeof(DirectoryNotFoundException)]);
    }

    [Fact]
    public async Task OpeningAnotherReader_PreservesThePreviousReadersCommentariesAndSelection()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        var original = fixture.Model;
        await original.LoadByPerekIdAsync(1);
        original.ToggleCheckedPerush(1);
        original.Perek!.Pasukim.Single().IsSelected = true;
        var next = new PerekViewModel(PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()), null,
            fixture.Data, new PerushimCatalogService(fixture.Storage.FileSystem.Object),
            new PerushimNotesService(NotesDeliveryTests.Pad().Object, fixture.Storage.FileSystem.Object),
            fixture.Navigator.Object, fixture.Storage.FileSystem.Object, null);
        await next.LoadByPerekIdAsync(1);
        next.ToggleCheckedPerush(2);

        next.Perek.Should().NotBeSameAs(original.Perek);
        next.Perek!.Pasukim.Single().PerushNotes.Single().PerushName.Should().Be("Targum");
        original.Perek.Pasukim.Single().PerushNotes.Single().PerushName.Should().Be("Rashi");
        original.Perek.Pasukim.Single().IsSelected.Should().BeTrue();
        next.Perek.Pasukim.Single().IsSelected.Should().BeFalse();
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
        vm.Perek!.Pasukim.Single().PerushNotes.Single().NoteContents.Should().BeEmpty("text belongs to realized cells");
        (await vm.Perek.Pasukim.Single().PerushNotes.Single().ContentLoader!()).Should().Equal("next");
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
    public async Task OpeningReader_LoadsOnlyTheRequestedChapterBeforePublishingCarousel()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(allChapters: true);
        await fixture.Model.LoadByPerekIdAsync(2);

        fixture.Model.CarouselPerakim.Should().HaveCount(929);
        fixture.Model.CarouselPerakim.Where(perek => perek.Pasukim.Count > 0)
            .Select(perek => perek.PerekId).Should().Equal([2],
                "speculative neighbor loading must not delay opening a search result");

        await fixture.Model.PreloadAdjacentPasukimAsync(2);
        fixture.Model.CarouselPerakim.Single(perek => perek.PerekId == 1).Pasukim.Should().NotBeEmpty();
        fixture.Model.CarouselPerakim.Single(perek => perek.PerekId == 3).Pasukim.Should().NotBeEmpty();
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
        // The public (ungated) init path also rebuilds around the shown perek.
        await vm.InitializeCarouselAsync();
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
    public async Task Carousel_WhenAdjacentChapterBlobIsCorrupt_SwallowsPreloadFailure()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(allChapters: true, corruptAdjacentBlob: true);
        var vm = fixture.Model;
        await vm.LoadByPerekIdAsync(1);

        // The per-perek preload wraps each neighbor in its own try — a corrupt
        // chapter blob for perek 2 must be logged away, never fail the sweep.
        await vm.PreloadAdjacentPasukimAsync(1);

        vm.PerekId.Should().Be(1);
    }

    [Fact]
    public async Task ShowPerushForSearch_WhenPerushAlreadyChecked_KeepsTheSelection()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        var vm = fixture.Model;
        await vm.LoadByPerekIdAsync(1);
        vm.ToggleCheckedPerush(1);

        vm.ShowPerushForSearch(1);

        // A perush that is already on screen must not be re-added or disturb
        // the existing inline selection.
        vm.CheckedPerushim.Should().Equal(1);
        vm.InlineCommentaryLimitMessage.Should().Contain("פירושים");
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
        // The reader kicked notes init instead of awaiting it — let it settle
        // (nothing is deliverable), then re-check like the page's hook does.
        await fixture.Notes.InitializeAsync();
        await fixture.Model.LoadPerushimAsync(1);
        fixture.Model.PerushimNotesPending.Should().BeFalse();
        fixture.Model.PerushimCatalogAvailable = true;
        fixture.Model.PerushimEmptyMessage.Should().Be("להוריד פירושים");
        fixture.Model.ShowDownloadPerushimButton.Should().BeTrue();
        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.Perek!.Pasukim.Single().PerushNotes.Should().BeEmpty();
        await fixture.Model.PreloadAdjacentPasukimAsync(2);
    }

    [Fact]
    public async Task ChapterLoad_WhileNotesPackMaterializes_ShowsPendingAndLoadsWhenItLands()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        await fixture.Storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite",
            "CREATE TABLE perush (id INTEGER, name TEXT, priority INTEGER)", "INSERT INTO perush VALUES (1,'Rashi',2),(2,'Targum',1)",
            "CREATE TABLE _metadata (key TEXT,value TEXT)", "INSERT INTO _metadata VALUES ('build_timestamp','100')");
        // The delivered pack is bundled but not copied locally yet — awaiting
        // its materialization on the reader path was the #2430 startup stall.
        await fixture.Storage.BundleDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite",
            [.. NotesDbV2.Statements((1, 1, 1, 0, "first"), (2, 1, 1, 0, "second")),
            "INSERT INTO _metadata VALUES ('build_timestamp','100')"]);

        await fixture.Model.LoadByPerekIdAsync(1);

        fixture.Model.PerushimNotesPending.Should().BeTrue();
        fixture.Model.PerushimNotesAvailable.Should().BeFalse();
        fixture.Model.Perushim.Should().BeEmpty();
        fixture.Model.ShowDownloadPerushimButton.Should().BeFalse();
        fixture.Model.PerushimEmptyMessage.Should().Be("טוען פירושים...");
        fixture.Model.Perek!.Pasukim.Single().PerushNotes.Should().BeEmpty();

        // The kicked materialization settles; the availability re-check (the
        // page's OperationCompleted hook) then loads the landed perushim.
        await fixture.Notes.InitializeAsync();
        await fixture.Model.LoadPerushimAsync(1);

        fixture.Model.PerushimNotesPending.Should().BeFalse();
        fixture.Model.PerushimNotesAvailable.Should().BeTrue();
        fixture.Model.Perushim.Select(p => p.Name).Should().Equal("Targum", "Rashi");
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
        await notes.ExecuteAsync("DROP TABLE note_blob");
        await fixture.Model.PreloadAdjacentPasukimAsync(20);
        fixture.Model.PerekId.Should().Be(1);
        fixture.Model.CarouselPerakim.Should().HaveCount(4);
    }

    [Fact]
    public async Task LoadPerushimAsync_WhenSyntheticPerushimEnabled_UsesSyntheticDataAndSkipsServices()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();
        var vm = fixture.Model;
        await vm.LoadByPerekIdAsync(1);
        var previous = Environment.GetEnvironmentVariable("BIBLE_E2E_PERUSHIM");
        Environment.SetEnvironmentVariable("BIBLE_E2E_PERUSHIM", "1");
        try
        {
            await vm.LoadPerushimAsync(1);

            vm.Perushim.Select(p => p.Id).Should().OnlyContain(id => id < 0);
            vm.PerushimCatalogAvailable.Should().BeTrue();
            vm.PerushimNotesAvailable.Should().BeTrue();
        }
        finally
        {
            Environment.SetEnvironmentVariable("BIBLE_E2E_PERUSHIM", previous);
        }
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
        vm.Perek!.Pasukim.Single().PerushNotes.Single().NoteContents.Should().BeEmpty("text belongs to realized cells");
        (await vm.Perek.Pasukim.Single().PerushNotes.Single().ContentLoader!()).Should().Equal("next");
    }

    [Fact]
    public async Task LoadPerushim_BeforeAnyPerekIsShown_IsNotTreatedAsStale()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadPerushimAsync(1);

        fixture.Model.Perushim.Select(p => p.Name).Should().Equal("Targum", "Rashi");
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
        await fixture.Model.LoadByPerekIdAsync(1);
        var adjacent = fixture.Model.CarouselPerakim.Single(perek => perek.PerekId == 3);
        adjacent.Pasukim = [];
        SynchronizationContext? assignedOn = null;
        adjacent.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(Perek.Pasukim))
            {
                assignedOn = SynchronizationContext.Current;
            }
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
        fixture.Data.GetPerek(3)!.Pasukim.Should().BeEmpty("each navigation-stack reader owns its bound verse state");
        assignedOn.Should().BeSameAs(ui, "carousel cells bind Pasukim, so it must not change on a background thread");
    }

    /// <summary>
    /// A data service whose stages can be made to never complete — the same
    /// shape as the wedged resource probe / queued query behind the iOS
    /// reader hang (issue #2084).
    /// </summary>
    private sealed class StallingPerekDataService : PerekDataService
    {
        private readonly TaskCompletionSource<List<Pasuk>> _neverPasukim = new();
        private readonly TaskCompletionSource<bool> _neverLoad = new();
        public int PasukimCalls { get; private set; }
        public int StallPasukimCalls { get; set; } = int.MaxValue;
        public int StallPasukimFromCall { get; set; } = int.MaxValue;
        public bool StallLoad { get; set; }

        public StallingPerekDataService(LocalDatabaseService database) : base(database) { }

        public override Task LoadAsync() => StallLoad ? _neverLoad.Task : base.LoadAsync();

        public override Task<List<Pasuk>> LoadPasukimAsync(int perekId)
        {
            PasukimCalls++;
            return PasukimCalls <= StallPasukimCalls || PasukimCalls >= StallPasukimFromCall
                ? _neverPasukim.Task : base.LoadPasukimAsync(perekId);
        }

        /// <summary>Lets a stalled pasukim query finally return — the late unblock a timed-out attempt sees.</summary>
        public void ReleasePasukim(List<Pasuk> pasukim) => _neverPasukim.TrySetResult(pasukim);

        /// <summary>Fails a stalled pasukim query late — the detached attempt faults after it was abandoned.</summary>
        public void FaultPasukim(Exception error) => _neverPasukim.TrySetException(error);
    }

    private static PerekViewModel StallingReader(Fixture fixture, StallingPerekDataService data)
    {
        var model = new PerekViewModel(
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()), null,
            data, new PerushimCatalogService(fixture.Storage.FileSystem.Object),
            new PerushimNotesService(NotesDeliveryTests.Pad().Object, fixture.Storage.FileSystem.Object),
            fixture.Navigator.Object, fixture.Storage.FileSystem.Object, null);
        model.LoadAttemptTimeout = TimeSpan.FromMilliseconds(50);
        return model;
    }

    [Fact]
    public async Task ChapterLoad_WhenAStageStalls_TimesOutAndReportsTheStallStage()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object));
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);
        vm.LoadMaxAttempts = 1;

        var thrown = await vm.Awaiting(m => m.LoadByPerekIdAsync(1)).Should().ThrowAsync<TimeoutException>();

        thrown.Which.Message.Should().Contain("pasukim");
        vm.LoadStage.Should().Be("pasukim");
        vm.Perek.Should().BeNull("the stalled stage precedes SetPerek");
    }

    [Fact]
    public async Task ChapterLoad_WhenEveryAttemptStalls_RetriesBeforeSurfacingFailure()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object));
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);
        vm.LoadMaxAttempts = 2;

        await vm.Awaiting(m => m.LoadByPerekIdAsync(1)).Should().ThrowAsync<TimeoutException>();

        data.PasukimCalls.Should().Be(2, "each timed-out attempt re-enters the stalled stage");
    }

    [Fact]
    public async Task ChapterLoad_WhenAStallClears_RetryCompletesTheLoad()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object))
        {
            StallPasukimCalls = 1,
        };
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);

        await vm.LoadByPerekIdAsync(1);

        vm.PerekId.Should().Be(1);
        vm.Perek!.Pasukim.Single().Text.Should().Be("בראשית");
        vm.LoadStage.Should().Be("loaded");
        data.PasukimCalls.Should().BeGreaterThan(1, "the first attempt stalled and the retry re-ran the stage");
    }

    [Fact]
    public async Task ChapterLoad_WhenDataServiceStalls_TimesOutAtDataServiceStage()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object))
        {
            StallLoad = true,
        };
        var vm = StallingReader(fixture, data);
        vm.LoadMaxAttempts = 1;

        var thrown = await vm.Awaiting(m => m.LoadByPerekIdAsync(1)).Should().ThrowAsync<TimeoutException>();

        thrown.Which.Message.Should().Contain("data-service");
        data.PasukimCalls.Should().Be(0);
        vm.Perek.Should().BeNull();
    }

    [Fact]
    public async Task ChapterLoad_WhenSupersededByNewerLoad_ReportsNoErrorAndKeepsTheNewerPerek()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object))
        {
            StallPasukimCalls = 1,
        };
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);
        vm.LoadMaxAttempts = 1;

        // The stalled call is superseded before its timeout surfaces — it must
        // not throw over the newer load that now owns the reader, and it must
        // report the supersession so page continuations skip their landing.
        var superseded = vm.LoadByPerekIdAsync(1);
        var newerStamp = await vm.LoadByPerekIdAsync(2);
        (await superseded).Should().BeNull("a superseded load reports null so callers skip post-load actions");
        newerStamp.Should().Be(vm.ReaderLoadStamp, "the owning load returns the live stamp");

        vm.PerekId.Should().Be(2);
    }

    [Fact]
    public async Task ChapterLoad_WhenTimedOutAttemptCompletesLate_DoesNotOverwriteNewerNavigation()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object))
        {
            StallPasukimCalls = 1,
        };
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);
        vm.LoadMaxAttempts = 1;

        await vm.Awaiting(m => m.LoadByPerekIdAsync(1)).Should().ThrowAsync<TimeoutException>();
        vm.Perek.Should().BeNull();

        // A newer navigation supersedes the abandoned call and wins the reader.
        await vm.LoadByPerekIdAsync(2);
        vm.PerekId.Should().Be(2);
        vm.LoadStage.Should().Be("loaded");

        // The abandoned attempt's stalled query finally returns — its late
        // writes must not replace the newer perek or the load-stage marker.
        data.ReleasePasukim([]);
        await Task.Delay(200);

        vm.PerekId.Should().Be(2);
        vm.LoadStage.Should().Be("loaded");
    }

    /// <summary>Waits until the load pipeline reports the given stage.</summary>
    private static async Task WaitForStageAsync(PerekViewModel vm, string stage)
    {
        for (var i = 0; i < 1000 && vm.LoadStage != stage; i++)
        {
            await Task.Delay(5);
        }
        vm.LoadStage.Should().Be(stage);
    }

    [Fact]
    public async Task ChapterLoad_WhenAbandonedAttemptUnblocksAfterItsRetry_DropsItsLateWrites()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object))
        {
            StallPasukimCalls = 1,
        };
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);

        // Attempt 1 stalls at pasukim and is abandoned; the retry loads for real.
        await vm.LoadByPerekIdAsync(1);
        vm.PerekId.Should().Be(1);
        vm.Perek!.Pasukim.Single().Text.Should().Be("בראשית");
        vm.LoadStage.Should().Be("loaded");

        // The abandoned attempt unblocks late, inside the SAME call — only its
        // attempt stamp lost currency — so its released pasukim and stage marks
        // must not touch the state the retry already produced.
        data.ReleasePasukim([]);
        await Task.Delay(200);

        vm.PerekId.Should().Be(1);
        vm.Perek!.Pasukim.Should().NotBeEmpty("the stale attempt's released data must not reach the bound perek");
        vm.LoadStage.Should().Be("loaded");
    }

    [Fact]
    public async Task ChapterLoad_WhenSupersededDuringPerushim_DropsTheRemainingStages()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        // Park the load inside LoadPerushimAsync by gating the packaged catalog open.
        var catalogGate = new TaskCompletionSource<Stream>(TaskCreationOptions.RunContinuationsAsynchronously);
        fixture.Storage.FileSystem
            .Setup(f => f.OpenAppPackageFileAsync("sefaria-dump-5784-sivan-4.perushim_catalog.sqlite"))
            .Returns(catalogGate.Task);
        var vm = fixture.Model;

        var load = vm.LoadByPerekIdAsync(1);
        await WaitForStageAsync(vm, "perushim");

        // A newer navigation supersedes the call while it waits on the catalog.
        vm.InvalidatePendingLoads();
        catalogGate.SetException(new FileNotFoundException("gone"));
        await load;

        vm.PerekId.Should().Be(1, "SetPerek already landed before the park");
        vm.LoadStage.Should().Be("perushim", "the stale attempt dropped before the carousel and loaded marks");
        vm.CarouselPerakim.Should().BeEmpty("the superseded attempt must not build the carousel");
    }

    [Fact]
    public async Task ChapterLoad_WhenNeighborQueriesStall_StillPublishesTheRequestedChapter()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object))
        {
            StallPasukimCalls = 0,
            StallPasukimFromCall = 2,
        };
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);

        // Carousel metadata no longer waits for speculative neighbor queries.
        // The old eager-loading path stalls here even though chapter 1 is ready.
        await vm.LoadByPerekIdAsync(1).WaitAsync(TimeSpan.FromSeconds(1));

        vm.LoadStage.Should().Be("loaded");
        vm.CurrentCarouselPerek!.PerekId.Should().Be(1);
        vm.CarouselPerakim.Should().HaveCount(4);
        data.PasukimCalls.Should().Be(1);
    }

    [Fact]
    public async Task ChapterLoad_WhenStaleAttemptFailsLate_ObservesTheError()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object))
        {
            StallPasukimCalls = 1,
        };
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);
        vm.LoadMaxAttempts = 1;

        await vm.Awaiting(m => m.LoadByPerekIdAsync(1)).Should().ThrowAsync<TimeoutException>();

        // The abandoned query faults late — the detached-attempt observer must
        // swallow it into the log instead of leaving an unobserved exception.
        data.FaultPasukim(new InvalidOperationException("late failure"));
        await Task.Delay(200);

        vm.Perek.Should().BeNull();
    }

    [Fact]
    public async Task LoadPerushimAsync_WhenNotesMissingAndPerekMovedOn_KeepsCurrentPerushimState()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var vm = fixture.Model;
        await vm.LoadByPerekIdAsync(2);
        vm.CheckedPerushim = [1];

        // A stale perushim load for a perek already left must not wipe the
        // commentary state of the perek now on screen.
        await vm.LoadPerushimAsync(1);

        vm.CheckedPerushim.Should().Equal(1);
        vm.PerushimCatalogAvailable.Should().BeFalse();
        vm.PerushimNotesAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task EnsurePasukimLoaded_WhenQueryStalls_ReturnsAfterTimeoutInsteadOfHanging()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize(notes: false);
        var data = new StallingPerekDataService(new LocalDatabaseService(fixture.Storage.FileSystem.Object));
        await data.LoadAsync();
        var vm = StallingReader(fixture, data);
        var perek = data.GetPerek(1)!;

        await vm.Awaiting(m => m.EnsurePasukimLoadedAsync(perek)).Should().NotThrowAsync();

        perek.Pasukim.Should().BeEmpty();
        data.PasukimCalls.Should().Be(1);
    }

    [Fact]
    public async Task LoadPerushim_ReusesTheCacheWarmedByAdjacentPreload()
    {
        await using var fixture = new Fixture();
        await fixture.Initialize();

        await fixture.Model.LoadByPerekIdAsync(2);
        // Warms _perushimPreloadCache for the neighboring perakim, then loads
        // the current perek's perushim from that cache instead of re-querying.
        await fixture.Model.PreloadAdjacentPasukimAsync(2);
        await fixture.Model.PreloadAdjacentPasukimAsync(2); // alreadyCached arm
        await fixture.Model.LoadPerushimAsync(2);

        fixture.Model.Perushim.Select(p => p.Name).Should().Contain("Rashi");
    }
}
