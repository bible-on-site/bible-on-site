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
