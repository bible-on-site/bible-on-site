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
    public const string Perek = "PerekPage";

    /// <summary>
    /// Flyout pages are pushed above the perek page (never swapped in as Shell roots)
    /// so the nav-bar back button and iOS swipe-back always lead back to the perek.
    /// </summary>
    public static string FlyoutPage(string route) => route == Perek ? $"//{Perek}" : $"//{Perek}/{route}";
}
