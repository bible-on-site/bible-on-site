using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using FluentAssertions;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Dispatching;
using Moq;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Contract tests for <see cref="ReaderDisplaySync"/> — the coordinator that
/// owns the rendered-text synchronization every reader page shares (#2573):
/// the page-level font resources and their preference tracking, the theme
/// refresh of the realized pesukim (#2601), and the notes-materialization
/// re-check (#2430). The notes service is faked through the same
/// <see cref="IReaderNotesAvailability"/> seam <c>PerushimNotesService</c>
/// implements; the page-level wiring contract lives in
/// ReaderCarouselContractTests.
/// </summary>
[Collection("Application state")]
public class ReaderDisplaySyncTests
{
    /// <summary>A notes-availability fake — the seam the real service satisfies.</summary>
    private sealed class FakeNotes : IReaderNotesAvailability
    {
        private Action? _operationCompleted;

        event Action? IReaderNotesAvailability.OperationCompleted
        {
            add => _operationCompleted += value;
            remove => _operationCompleted -= value;
        }

        public bool IsAvailable { get; set; }
        public int InitializeCalls { get; private set; }
        public Exception? InitializeError { get; set; }

        public Task InitializeAsync()
        {
            InitializeCalls++;
            return InitializeError is { } error ? Task.FromException(error) : Task.CompletedTask;
        }

        public void CompleteOperation() => _operationCompleted?.Invoke();
    }

    private sealed class Rig
    {
        public readonly ContentPage Page = new();
        public readonly FakeNotes Notes = new();
        public readonly PreferencesService Preferences =
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());

        public readonly List<Pasuk> Loaded = [];
        public int LoadedCalls;
        public int AfterThemeCalls;
        public bool NotesAvailable;
        public bool NotesPending;
        public int ReloadCalls;

        // Async work the coordinator dispatched — RunDispatchesInline controls
        // whether Dispatch executes immediately or queues for the test to drive
        // (the queue-once path needs the second case).
        public readonly List<Action> DispatchedWork = [];
        public bool RunDispatchesInline = true;

        public Rig()
        {
            AttachDispatcher(Page);
            Loaded.Add(new Pasuk { Text = "א" });
            Loaded.Add(new Pasuk { Text = "ב" });
        }

        /// <summary>Gives the headless page an inline dispatcher.</summary>
        private void AttachDispatcher(Element element)
        {
            var dispatcher = new Mock<IDispatcher>();
            dispatcher.SetupGet(d => d.IsDispatchRequired).Returns(false);
            dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>()))
                .Returns((Action action) =>
                {
                    DispatchedWork.Add(action);
                    if (RunDispatchesInline)
                    {
                        action();
                    }
                    return true;
                });
            var services = new Mock<IServiceProvider>();
            services.Setup(s => s.GetService(typeof(IDispatcher))).Returns(dispatcher.Object);
            var context = new Mock<IMauiContext>();
            context.SetupGet(c => c.Services).Returns(services.Object);
            var handler = new Mock<IViewHandler>();
            handler.SetupGet(h => h.MauiContext).Returns(context.Object);
            element.Handler = handler.Object;
        }

        public ReaderDisplaySync Create() => new(
            new ReaderDisplaySyncSurfaces
            {
                Page = Page,
                Notes = Notes,
                Preferences = Preferences,
            },
            new ReaderDisplaySyncActions
            {
                LoadedPasukim = () => { LoadedCalls++; return Loaded; },
                AfterThemeRefresh = () => AfterThemeCalls++,
                NotesAvailable = () => NotesAvailable,
                NotesPending = () => NotesPending,
                ReloadNotesAsync = () => { ReloadCalls++; return Task.CompletedTask; },
            });
    }

    // — Font resources ——————————————————————————————————————————————————————

    [Fact]
    public void Constructor_applies_the_font_resources_from_preferences()
    {
        var rig = new Rig();
        rig.Preferences.FontFactor = 1.5;

        _ = rig.Create();

        rig.Page.Resources["PasukFontSize"].Should().Be(1.5 * 18);
        rig.Page.Resources["PasukNumFontSize"].Should().Be(1.5 * 16);
        rig.Page.Resources["PerushNameFontSize"].Should().Be(1.5 * 14);
        rig.Page.Resources["PerushContentFontSize"].Should().Be(1.5 * 18);
    }

    [Fact]
    public void Font_resources_track_the_category_percents()
    {
        var rig = new Rig();
        rig.Preferences.PasukFontPercent = 150;
        rig.Preferences.PerushFontPercent = 80;

        _ = rig.Create();

        rig.Page.Resources["PasukFontSize"].Should().Be(1.5 * 18);
        rig.Page.Resources["PerushContentFontSize"].Should().Be(0.8 * 18);
    }

    [Fact]
    public void ApplyFontSizes_writes_all_four_entries()
    {
        var rig = new Rig();
        var resources = new ResourceDictionary();

        ReaderDisplaySync.ApplyFontSizes(resources, rig.Preferences);

        resources.Should().ContainKeys(
            "PasukFontSize", "PasukNumFontSize", "PerushNameFontSize", "PerushContentFontSize");
    }

    // — Notes availability refresh ——————————————————————————————————————————

    [Fact]
    public async Task RefreshNotes_reloads_when_availability_flipped()
    {
        var rig = new Rig();
        var sync = rig.Create();
        rig.Notes.IsAvailable = true;
        rig.NotesAvailable = false;

        await sync.RefreshNotesIfAvailabilityChangedAsync();

        rig.Notes.InitializeCalls.Should().Be(1, "the refresh settles the notes init before checking");
        rig.ReloadCalls.Should().Be(1,
            "an availability flip (pack downloaded in Preferences) reloads the current unit's notes");
    }

    [Fact]
    public async Task RefreshNotes_reloads_while_materialization_is_pending()
    {
        var rig = new Rig();
        var sync = rig.Create();
        rig.NotesPending = true;

        await sync.RefreshNotesIfAvailabilityChangedAsync();

        rig.ReloadCalls.Should().Be(1,
            "a pending materialization re-pulls the notes the load skipped (#2430)");
    }

    [Fact]
    public async Task RefreshNotes_skips_when_the_state_is_unchanged()
    {
        var rig = new Rig();
        var sync = rig.Create();

        await sync.RefreshNotesIfAvailabilityChangedAsync();

        rig.ReloadCalls.Should().Be(0, "nothing changed since the last load — no redundant reload");
    }

    [Fact]
    public async Task RefreshNotes_swallows_initialize_failures()
    {
        var rig = new Rig();
        var sync = rig.Create();
        rig.Notes.InitializeError = new InvalidOperationException("db missing");

        var act = () => sync.RefreshNotesIfAvailabilityChangedAsync();

        await act.Should().NotThrowAsync(
            "the on-appearing/materialization refresh is best-effort — a failing notes "
            + "pack must not break the reader");
    }

    // — Materialization-completion event ————————————————————————————————————

    [Fact]
    public async Task OperationCompleted_with_changed_state_queues_and_runs_the_refresh()
    {
        var rig = new Rig();
        _ = rig.Create();
        rig.Notes.IsAvailable = true;

        rig.Notes.CompleteOperation();

        rig.DispatchedWork.Should().ContainSingle("a materialization finish re-checks availability once");
        rig.ReloadCalls.Should().Be(1,
            "the queued refresh saw the availability flip and reloaded notes");
        await Task.CompletedTask;
    }

    [Fact]
    public void OperationCompleted_with_unchanged_state_queues_nothing()
    {
        var rig = new Rig();
        _ = rig.Create();

        rig.Notes.CompleteOperation();

        rig.DispatchedWork.Should().BeEmpty(
            "the guard skips the refresh entirely when availability already matches");
        rig.ReloadCalls.Should().Be(0);
    }

    [Fact]
    public async Task OperationCompleted_while_a_refresh_is_queued_does_not_queue_again()
    {
        var rig = new Rig { RunDispatchesInline = false };
        _ = rig.Create();
        rig.Notes.IsAvailable = true;

        rig.Notes.CompleteOperation();
        rig.Notes.CompleteOperation();

        rig.DispatchedWork.Should().ContainSingle(
            "a second completion while the first refresh is queued must not re-queue — " +
            "the refresh itself re-fires OperationCompleted (#2430)");

        rig.DispatchedWork[0]();
        rig.ReloadCalls.Should().Be(1);
        await Task.CompletedTask;
    }

    [Fact]
    public void Page_unload_unsubscribes_the_notes_event()
    {
        var rig = new Rig();
        var sync = rig.Create();
        rig.Notes.IsAvailable = true;

        sync.OnPageUnloadedForNotes(null!, EventArgs.Empty);
        rig.Notes.CompleteOperation();

        rig.DispatchedWork.Should().BeEmpty(
            "an unloaded page must not refresh notes for a reader that left");
    }

    // — Theme refresh ———————————————————————————————————————————————————————

    [Fact]
    public void Theme_refresh_enumerates_the_loaded_pesukim_and_runs_division_extras()
    {
        var rig = new Rig();
        var sync = rig.Create();

        sync.RefreshLoadedPasukimForTheme();

        rig.LoadedCalls.Should().Be(1, "the refresh repaints only the realized rows, not the corpus");
        rig.AfterThemeCalls.Should().Be(1,
            "division extras (focused pasuk, recitation repaint) run after the pasuk refresh");
    }

    [Fact]
    public void Theme_refresh_tolerates_absent_division_extras()
    {
        var rig = new Rig();
        var sync = new ReaderDisplaySync(
            new ReaderDisplaySyncSurfaces
            {
                Page = rig.Page,
                Notes = rig.Notes,
                Preferences = rig.Preferences,
            },
            new ReaderDisplaySyncActions
            {
                LoadedPasukim = () => rig.Loaded,
                AfterThemeRefresh = null,
                NotesAvailable = () => false,
                NotesPending = () => false,
                ReloadNotesAsync = () => Task.CompletedTask,
            });

        var act = () => sync.RefreshLoadedPasukimForTheme();

        act.Should().NotThrow("masora carries no focused-pasuk extras — the plug is optional");
    }

    // — Theme subscription lifecycle ————————————————————————————————————————

    [Fact]
    public void Page_load_subscribes_and_immediately_refreshes_for_the_current_theme()
    {
        var rig = new Rig();
        var previous = Application.Current;
        try
        {
            Application.Current = new Application();
            var sync = rig.Create();

            sync.OnPageLoadedForTheme(null!, EventArgs.Empty);

            rig.LoadedCalls.Should().Be(1,
                "a page landing after the theme flipped repaints immediately, not on the next flip");
            rig.AfterThemeCalls.Should().Be(1);
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public void Page_unload_then_load_rechecks_the_theme()
    {
        var rig = new Rig();
        var previous = Application.Current;
        try
        {
            Application.Current = new Application();
            var sync = rig.Create();

            sync.OnPageLoadedForTheme(null!, EventArgs.Empty);
            sync.OnPageUnloadedForTheme(null!, EventArgs.Empty);
            sync.OnPageLoadedForTheme(null!, EventArgs.Empty);

            rig.AfterThemeCalls.Should().Be(2,
                "a page kept on the Shell stack re-checks the theme when navigation returns");
        }
        finally
        {
            Application.Current = previous;
        }
    }

    [Fact]
    public void Theme_handlers_tolerate_a_missing_application()
    {
        var rig = new Rig();
        var previous = Application.Current;
        try
        {
            Application.Current = null;
            var sync = rig.Create();

            var act = () =>
            {
                sync.OnPageLoadedForTheme(null!, EventArgs.Empty);
                sync.OnPageUnloadedForTheme(null!, EventArgs.Empty);
            };

            act.Should().NotThrow("unit-test hosts and early shutdown leave no Application behind");
            rig.LoadedCalls.Should().Be(0);
        }
        finally
        {
            Application.Current = previous;
        }
    }
}
