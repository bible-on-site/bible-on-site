namespace BibleOnSite.Services;

/// <summary>The Shell boundary used by view-model navigation and error dialogs.</summary>
public interface IAppNavigator
{
    Task GoToAsync(string route);
    Task DisplayAlertAsync(string title, string message, string cancel);
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
}

public static class AppRoutes
{
    public static string Perek => "PerekPage";
    public static string SearchReader => "searchReader";

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
