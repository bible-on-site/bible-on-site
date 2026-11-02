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

    /// <summary>
    /// Flyout pages replace another menu page above the most recent reader.
    /// Preserve search-reader history so Back returns to the chapter being read.
    /// </summary>
    public static string FlyoutPage(string route) => FlyoutPage(route, null);

    public static string FlyoutPage(string route, string? currentLocation)
    {
        var segments = (currentLocation ?? $"//{Perek}").Split('?', 2)[0]
            .Split('/', StringSplitOptions.RemoveEmptyEntries);
        var reader = Array.FindLastIndex(segments, segment => segment == Perek || segment == SearchReader || segment == Parasha);
        var readerPath = reader < 0 ? $"//{Perek}" : "//" + string.Join('/', segments.Take(reader + 1));
        return route == Perek ? readerPath : $"{readerPath}/{route}";
    }
}
