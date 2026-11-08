namespace BibleOnSite.Services;

/// <summary>Contextual entry to the same preferences used by the flyout.</summary>
public static class PreferencesNavigation
{
    public static Task OpenPerushimDownloadAsync(IAppNavigator navigator) =>
        navigator.GoToAsync("PreferencesPage?section=packs");
}
