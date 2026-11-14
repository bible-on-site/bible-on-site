using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>
/// The notes-availability seam the readers share — the contract
/// <see cref="PerushimNotesService"/> already satisfies. Abstracted so the
/// display-sync coordinator is unit-testable without a packaged notes DB.
/// </summary>
public interface IReaderNotesAvailability
{
    /// <summary>Raised when a materialization/initialization settles so deferred refresh work can run.</summary>
    event Action? OperationCompleted;

    /// <summary>Whether the notes DB is currently queryable.</summary>
    bool IsAvailable { get; }

    /// <summary>Ensures the notes pack is initialized/materialized.</summary>
    Task InitializeAsync();
}

/// <summary>
/// The page surface <see cref="ReaderDisplaySync"/> needs — resources for the
/// font entries, lifecycle for the theme subscription, the dispatcher for the
/// queued notes refresh and the services it syncs against.
/// </summary>
public sealed class ReaderDisplaySyncSurfaces
{
    /// <summary>The reader page itself.</summary>
    public required Page Page { get; init; }

    /// <summary>The shared notes service the readers materialize against.</summary>
    public required IReaderNotesAvailability Notes { get; init; }

    /// <summary>The preferences service driving the font factors.</summary>
    public required PreferencesService Preferences { get; init; }
}

/// <summary>
/// The division-specific plugs <see cref="ReaderDisplaySync"/> needs: which
/// pesukim to repaint on a theme flip and how the division reloads notes.
/// The sync they feed is shared; the data is not.
/// </summary>
public sealed class ReaderDisplaySyncActions
{
    /// <summary>
    /// The pesukim currently realized on the reader's carousel — the theme
    /// refresh repaints only what exists, not every pasuk in the corpus.
    /// </summary>
    public required Func<IEnumerable<Pasuk>> LoadedPasukim { get; init; }

    /// <summary>
    /// Division extras after the pasuk refresh — the focused-pasuk overlay and
    /// recitation repaint on readers that have them; null on masora.
    /// </summary>
    public Action? AfterThemeRefresh { get; init; }

    /// <summary>The division's last-known notes-availability flag.</summary>
    public required Func<bool> NotesAvailable { get; init; }

    /// <summary>The division's last-known materialization-in-flight flag.</summary>
    public required Func<bool> NotesPending { get; init; }

    /// <summary>
    /// Reloads notes for the reader's current unit (division adapter: the
    /// perek id on על הפרק, the loaded unit on the alternative readers).
    /// </summary>
    public required Func<Task> ReloadNotesAsync { get; init; }
}

/// <summary>
/// Owns the rendered-text synchronization shared by the perek, parasha and
/// masora readers (#2573) — the plumbing that used to sit as three identical
/// method copies in each page:
///
/// - Font-size resources: the page-level <c>PasukFontSize</c> /
///   <c>PasukNumFontSize</c> / <c>PerushNameFontSize</c> /
///   <c>PerushContentFontSize</c> DynamicResource entries, kept in step with
///   the user's font-factor preference through a weak subscription.
/// - Theme refresh: span colors (qri brackets, recitation highlight, פ/ס
///   marks) are baked into each pasuk's cached FormattedString at build time,
///   so a theme flip while the page is alive repaints the realized rows
///   (#2601). The subscription rides Loaded/Unloaded so a page kept on the
///   Shell stack re-checks the theme when navigation returns.
/// - Notes materialization: a reader opened while the first-launch notes pack
///   still copies skips awaiting it (#2430) — when the copy completes the
///   service raises <c>OperationCompleted</c> off the UI thread and the queued
///   refresh re-checks availability once.
/// </summary>
public sealed class ReaderDisplaySync
{
    private const double PasukFontSizeBase = 18;
    private const double PasukNumFontSizeBase = 16;
    private const double PerushNameFontSizeBase = 14;
    private const double PerushContentFontSizeBase = 18;

    private readonly ReaderDisplaySyncSurfaces _ui;
    private readonly ReaderDisplaySyncActions _actions;
    private bool _notesRefreshQueued;

    public ReaderDisplaySync(ReaderDisplaySyncSurfaces surfaces, ReaderDisplaySyncActions actions)
    {
        _ui = surfaces;
        _actions = actions;

        var prefs = _ui.Preferences;
        ApplyFontSizes(_ui.Page.Resources, prefs);
        // The lambda captures the preferences singleton (which outlives every
        // reader anyway) but not the coordinator — only the page rides the
        // weak subscription, exactly as the pages' own wiring did.
        WeakPreferencesSubscription.Subscribe(_ui.Page, prefs,
            page => MainThread.BeginInvokeOnMainThread(() => ApplyFontSizes(page.Resources, prefs)));

        SubscribeThemeChange();
        SubscribeNotesMaterialization();
    }

    /// <summary>
    /// Populates the page-level DynamicResource entries for pasuk/perush text
    /// sizes from the font-factor preferences. DynamicResource is used because
    /// x:Reference bindings inside CarouselView DataTemplates are unreliable on
    /// Android. Reading-text category inventory (#2461): פסוקים covers the
    /// pasuk body (base 18) and pasuk-number markers (base 16); פירושים covers
    /// perush content (base 18 so 100% matches the pasuk body) and perush
    /// names (base 14 heading hierarchy).
    /// </summary>
    internal static void ApplyFontSizes(ResourceDictionary resources, PreferencesService prefs)
    {
        var pasukFactor = prefs.PasukFontFactor;
        var perushFactor = prefs.PerushFontFactor;
        resources["PasukFontSize"] = pasukFactor * PasukFontSizeBase;
        resources["PasukNumFontSize"] = pasukFactor * PasukNumFontSizeBase;
        resources["PerushNameFontSize"] = perushFactor * PerushNameFontSizeBase;
        resources["PerushContentFontSize"] = perushFactor * PerushContentFontSizeBase;
    }

    /// <summary>
    /// Reloads notes for the current unit when notes-availability changed
    /// since the last load (e.g. the user downloaded the pack in Preferences
    /// and returned to this page). Also called by the materialization
    /// completion hook — failures are best-effort in both paths.
    /// </summary>
    public async Task RefreshNotesIfAvailabilityChangedAsync()
    {
        try
        {
            await _ui.Notes.InitializeAsync();
            if (_ui.Notes.IsAvailable != _actions.NotesAvailable() || _actions.NotesPending())
            {
                await _actions.ReloadNotesAsync();
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: refresh is best-effort
        catch (Exception ex) //NOSONAR — refresh is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Refresh perushim failed: {ex}");
        }
    }

    /// <summary>
    /// A reader opened while the first-launch notes pack still materializes
    /// skips awaiting it (#2430) — when the copy completes the service raises
    /// OperationCompleted off the UI thread, so re-check availability here.
    /// </summary>
    private void SubscribeNotesMaterialization()
    {
        _ui.Notes.OperationCompleted += OnNotesOperationCompleted;
        _ui.Page.Unloaded += OnPageUnloadedForNotes;
    }

    // Internal rather than private: coverage counts delegate bodies the
    // page events invoke, so tests drive them directly (#2573).
    internal void OnPageUnloadedForNotes(object? sender, EventArgs e) =>
        _ui.Notes.OperationCompleted -= OnNotesOperationCompleted;

    internal void OnNotesOperationCompleted()
    {
        // InitializeAsync releases the operation lock, which re-fires this
        // event — and the refresh calls InitializeAsync itself. Without this
        // guard every refresh queues another dispatcher turn forever, the UI
        // thread never idles, and accessibility queries starve (#2430).
        if (_notesRefreshQueued ||
            (_ui.Notes.IsAvailable == _actions.NotesAvailable() && !_actions.NotesPending()))
        {
            return;
        }
        _notesRefreshQueued = true;
        _ = _ui.Page.Dispatcher.DispatchAsync(async () =>
        {
            try { await RefreshNotesIfAvailabilityChangedAsync(); }
            finally { _notesRefreshQueued = false; }
        });
    }

    /// <summary>
    /// Span colors are baked into each pasuk's cached FormattedString at build
    /// time — a theme flip while the page is alive must refresh the realized
    /// rows so they don't keep the other theme's colors (#2601).
    /// </summary>
    private Application? _app;

    private void SubscribeThemeChange()
    {
        _app = Microsoft.Maui.Controls.Application.Current;
        if (_app is null)
        {
            return;
        }
        // Pair with Loaded/Unloaded — a page kept on the Shell stack reloads
        // when navigation returns, and must re-check the theme then.
        _ui.Page.Loaded += OnPageLoadedForTheme;
        _ui.Page.Unloaded += OnPageUnloadedForTheme;
    }

    // Internal rather than private: coverage counts delegate bodies the
    // page events invoke, so tests drive them directly (#2573).
    internal void OnPageLoadedForTheme(object? sender, EventArgs e)
    {
        if (_app is null)
        {
            return;
        }
        _app.RequestedThemeChanged += OnRequestedThemeChanged;
        OnRequestedThemeChanged(_app, new AppThemeChangedEventArgs(_app.RequestedTheme));
    }

    internal void OnPageUnloadedForTheme(object? sender, EventArgs e)
    {
        if (_app is null)
        {
            return;
        }
        _app.RequestedThemeChanged -= OnRequestedThemeChanged;
    }

    internal void OnRequestedThemeChanged(object? sender, AppThemeChangedEventArgs e) =>
        RefreshLoadedPasukimForTheme();

    // Split from the event handler so tests can exercise the refresh without
    // standing an Application — the handler is a thin delegate either way.
    internal void RefreshLoadedPasukimForTheme()
    {
        _ui.Page.Dispatcher.Dispatch(() =>
        {
            foreach (var pasuk in _actions.LoadedPasukim())
            {
                pasuk.RefreshForThemeChange();
            }
            _actions.AfterThemeRefresh?.Invoke();
        });
    }
}
