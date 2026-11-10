namespace BibleOnSite.Services;

/// <summary>The Shell boundary used by view-model navigation and error dialogs.</summary>
public interface IAppNavigator
{
    Task GoToAsync(string route);
    Task GoToAsync(string route, bool animate, IDictionary<string, object>? parameters);

    /// <summary>
    /// Dependent/programmatic navigation (app links): queues behind a
    /// transition still in flight instead of being deduplicated like a
    /// second user tap, so the request cannot vanish mid-sequence.
    /// </summary>
    Task GoToQueuedAsync(string route);

    Task DisplayAlertAsync(string title, string message, string cancel);

    /// <summary>
    /// Two-choice confirmation. Returns true only when the user accepts; false on
    /// cancel and when no window can present the dialog (never a false accept).
    /// </summary>
    Task<bool> DisplayChoiceAsync(string title, string message, string accept, string cancel);

    /// <summary>
    /// Two-choice destructive confirmation (#2630): same result mapping as
    /// <see cref="DisplayChoiceAsync"/>, with the affirmative action rendered in
    /// the destructive red text.
    /// </summary>
    Task<bool> DisplayDestructiveChoiceAsync(string title, string message, string destructive, string cancel);
}

public sealed class ShellAppNavigator : IAppNavigator
{
    public static IAppNavigator Instance { get; } = new ShellAppNavigator();

    /// <summary>Every navigation funnels through one serializer: the per-page
    /// <see cref="Helpers.NavigationGate"/>s cannot see each other and the
    /// direct Shell.Current.GoToAsync callers had no gate at all, so a second
    /// GoToAsync could still reach UIKit while a transition was in flight —
    /// which faults the navigation controller and is a fatal ObjC exception
    /// on iOS (the TestFlight SIGABRT on repeated link taps).</summary>
    private static readonly Helpers.NavigationGate Gate = new();

    /// <summary>Liveness bound on the post-navigation settle wait — releases
    /// the gate when Navigated never arrives (a cancelled or externally
    /// pre-empted navigation), not a performance deadline.</summary>
    private static readonly TimeSpan SettleBound = TimeSpan.FromMilliseconds(1500);

    public Task GoToAsync(string route) =>
        Gate.RunAsync(() => NavigateAndSettleAsync(route));

    public Task GoToAsync(string route, bool animate, IDictionary<string, object>? parameters) =>
        Gate.RunAsync(() => NavigateAndSettleAsync(route, animate, parameters));

    public Task GoToQueuedAsync(string route) =>
        Gate.RunQueuedAsync(() => NavigateAndSettleAsync(route));

    private static Task NavigateAndSettleAsync(string route) =>
        NavigateAndSettleAsync(route, true, null);

    private static async Task NavigateAndSettleAsync(string route, bool animate,
        IDictionary<string, object>? parameters)
    {
        var shell = Shell.Current;
        var settled = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnNavigated(object? sender, ShellNavigatedEventArgs e) => settled.TrySetResult();
        shell.Navigated += OnNavigated;
        try
        {
            // The 3-arg overload rejects a null query — dispatch on presence.
            await (ToQuery(parameters) is { } query
                ? shell.GoToAsync(route, animate, query)
                : shell.GoToAsync(route, animate));
            // iOS can resolve GoToAsync while the native transition still
            // animates: release only once Shell reports Navigated so a rapid
            // follow-up tap cannot collide with the in-flight transition.
            await Task.WhenAny(settled.Task, Task.Delay(SettleBound));
        }
        finally
        {
            shell.Navigated -= OnNavigated;
        }
    }

    private static ShellNavigationQueryParameters? ToQuery(IDictionary<string, object>? parameters) =>
        parameters switch
        {
            null => null,
            ShellNavigationQueryParameters query => query,
            _ => new ShellNavigationQueryParameters(parameters)
        };

    // Every blocking dialog flows through the shared dialog policy/presenter
    // (#2630) so callers cannot drift back to native defaults.
    public Task DisplayAlertAsync(string title, string message, string cancel) =>
        AppDialogs.AlertAsync(title, message, cancel);

    public Task<bool> DisplayChoiceAsync(string title, string message, string accept, string cancel) =>
        AppDialogs.ConfirmAsync(title, message, accept, cancel);

    public Task<bool> DisplayDestructiveChoiceAsync(string title, string message, string destructive, string cancel) =>
        AppDialogs.ConfirmDestructiveAsync(title, message, destructive, cancel);
}

/// <summary>
/// The reading division a live reader route belongs to (#3263). A division
/// groups the interchangeable instances of one reading surface: selecting a
/// division's explicit destination must land on a reader of that division,
/// never on whichever foreign reader the location happened to end on.
/// </summary>
public enum ReaderDivision
{
    /// <summary>The על הפרק chapter reader — the Shell root and its pushed
    /// search/calendar aliases.</summary>
    Perek,
    /// <summary>The פרשה על הפרק reading instance.</summary>
    Parasha,
    /// <summary>The מסורה על הפרק reading instance.</summary>
    Masora,
    /// <summary>The מועדים על הפרק reading instance (#3261).</summary>
    Moed,
}

public static class AppRoutes
{
    public static string Perek => "PerekPage";
    public static string SearchReader => "searchReader";
    public static string RecitationPreferences => "RecitationPreferencesPage";
    public static string DisplayPreferences => "DisplayPreferencesPage";
    public static string PerekPreferences => "PerekPreferencesPage";
    public static string ExtensionPacks => "ExtensionPacksPage";
    public static string SoundPreferences => "SoundPreferencesPage";
    public static string SupportPreferences => "SupportPreferencesPage";
    public static string LearningCalendar => "LearningCalendarPage";

    /// <summary>
    /// PerekPage pushed above the calendar so Back returns to the viewed month.
    /// </summary>
    public static string CalendarReader => "calendarReader";

    /// <summary>The מסורה על הפרק reading instance — a flyout page like the other menu pages.</summary>
    public static string Masora => "MasoraPage";

    /// <summary>The פרשה על הפרק reader instance — a reader page like PerekPage.</summary>
    public static string Parasha => "ParashaPage";

    /// <summary>The פרשה listing above the reader — same flyout destination.</summary>
    public static string ParashaList => "ParashaListPage";

    /// <summary>The מועדים catalogue listing above the reader — same flyout destination.</summary>
    public static string Moadim => "MoadimListPage";

    /// <summary>The מועדים על הפרק reader instance — a reader page like ParashaPage.</summary>
    public static string Moed => "MoedPage";

    public static string Tanahpedia => "TanahpediaPage";
    public static string TanahpediaCategory => "tanahpediaCategory";
    public static string TanahpediaEntryRoute => "tanahpediaEntry";
    public static string Articles => "ArticlesPage";
    public static string ArticleDetail => "articleDetail";
    public static string Authors => "AuthorsPage";
    public static string DailyBulletin => "DailyBulletinPage";

    /// <summary>Terms of service — named for the flyout row, not the page class.</summary>
    public static string Terms => "TosPage";

    public static string Preferences => "PreferencesPage";
    public static string Contact => "ContactPage";
    public static string Donations => "DonationsPage";

    /// <summary>
    /// A תנכפדיה entry page pushed above the caller — the page resolves
    /// synonyms and ambiguous names itself.
    /// </summary>
    public static string TanahpediaEntry(string uniqueName) =>
        $"{TanahpediaEntryRoute}?uniqueName={Uri.EscapeDataString(uniqueName)}";

    /// <summary>
    /// Every live reader route and the <see cref="ReaderDivision"/> it belongs
    /// to — the single route-role map shared by flyout navigation, the
    /// selected-destination code and the transition tests (#3263). New reader
    /// families (e.g. מועדים) register here once instead of per-handler
    /// hardcoded reader lists.
    /// </summary>
    public static IReadOnlyDictionary<string, ReaderDivision> ReaderDivisions { get; } =
        new Dictionary<string, ReaderDivision>(StringComparer.Ordinal)
        {
            [Perek] = ReaderDivision.Perek,
            [SearchReader] = ReaderDivision.Perek,
            [CalendarReader] = ReaderDivision.Perek,
            [Parasha] = ReaderDivision.Parasha,
            [Masora] = ReaderDivision.Masora,
            [Moed] = ReaderDivision.Moed,
        };

    /// <summary>
    /// Flyout destinations split into two intents (#3263):
    /// <list type="bullet">
    /// <item>A reader destination activates its own <see cref="ReaderDivision"/>:
    /// the deepest already-running reader of that division stays active (pages
    /// above it pop), regardless of a previous foreign reader, an intermediate
    /// menu page or a pushed article/preferences/search screen.</item>
    /// <item>Any other flyout page pushes above the deepest live reader — of
    /// any division — replacing a sibling menu page there, so Back returns to
    /// the reading (search/calendar reader history included).</item>
    /// </list>
    /// </summary>
    public static string FlyoutPage(string route) => FlyoutPage(route, null);

    public static string FlyoutPage(string route, string? currentLocation)
    {
        var segments = (currentLocation ?? $"//{Perek}").Split('?', 2)[0]
            .Split('/', StringSplitOptions.RemoveEmptyEntries);

        if (ReaderDivisions.TryGetValue(route, out var division))
        {
            var own = Array.FindLastIndex(segments, segment =>
                ReaderDivisions.TryGetValue(segment, out var other) && other == division);
            if (own >= 0)
            {
                return "//" + string.Join('/', segments.Take(own + 1));
            }
            // The perek division is the Shell root itself — its reader always
            // exists beneath whatever is stacked above. Other divisions are
            // pushed readers: open one above the current reader so Back works.
            return route == Perek ? $"//{Perek}" : $"{ReaderAnchorPath(segments)}/{route}";
        }

        return $"{ReaderAnchorPath(segments)}/{route}";
    }

    /// <summary>The location prefix ending at the deepest live reader — the
    /// anchor a non-reader flyout page is pushed above.</summary>
    private static string ReaderAnchorPath(string[] segments)
    {
        var reader = Array.FindLastIndex(segments, segment => ReaderDivisions.ContainsKey(segment));
        return reader < 0 ? $"//{Perek}" : "//" + string.Join('/', segments.Take(reader + 1));
    }
}
