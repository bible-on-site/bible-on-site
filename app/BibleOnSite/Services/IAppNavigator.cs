namespace BibleOnSite.Services;

/// <summary>The Shell boundary used by view-model navigation and error dialogs.</summary>
public interface IAppNavigator
{
    Task GoToAsync(string route);
    Task DisplayAlertAsync(string title, string message, string cancel);

    /// <summary>
    /// Two-choice confirmation. Returns true only when the user accepts; false on
    /// cancel and when no window can present the dialog (never a false accept).
    /// </summary>
    Task<bool> DisplayChoiceAsync(string title, string message, string accept, string cancel);
}

public sealed class ShellAppNavigator : IAppNavigator
{
    public static IAppNavigator Instance { get; } = new ShellAppNavigator();

    public Task GoToAsync(string route) => Shell.Current.GoToAsync(route);

    public Task DisplayAlertAsync(string title, string message, string cancel)
    {
        var page = Application.Current?.Windows.FirstOrDefault()?.Page;
        return page?.DisplayAlertAsync(title, message, cancel) ?? Task.CompletedTask;
    }

    public Task<bool> DisplayChoiceAsync(string title, string message, string accept, string cancel)
    {
        var page = Application.Current?.Windows.FirstOrDefault()?.Page;
        return page?.DisplayAlertAsync(title, message, accept, cancel) ?? Task.FromResult(false);
    }
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

    /// <summary>
    /// Flyout pages replace another menu page above the most recent reader.
    /// Preserve search-reader history so Back returns to the chapter being read.
    /// </summary>
    public static string FlyoutPage(string route) => FlyoutPage(route, null);

    public static string FlyoutPage(string route, string? currentLocation)
    {
        var segments = (currentLocation ?? $"//{Perek}").Split('?', 2)[0]
            .Split('/', StringSplitOptions.RemoveEmptyEntries);
        var reader = Array.FindLastIndex(segments, segment => segment == Perek || segment == SearchReader);
        var readerPath = reader < 0 ? $"//{Perek}" : "//" + string.Join('/', segments.Take(reader + 1));
        return route == Perek ? readerPath : $"{readerPath}/{route}";
    }
}
