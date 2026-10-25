namespace BibleOnSite.Services;

/// <summary>Contextual entry to the same preferences used by the flyout.</summary>
public static class PreferencesNavigation
{
    public static Microsoft.Maui.Controls.Command BackCommand { get; } =
        new(async () => await ShellAppNavigator.Instance.GoToAsync(".."));

    public static Task OpenPerushimDownloadAsync(IAppNavigator navigator) =>
        navigator.GoToAsync("PreferencesPage?section=packs");
}
