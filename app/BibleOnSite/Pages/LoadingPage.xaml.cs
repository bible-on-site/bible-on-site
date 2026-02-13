using BibleOnSite.Config;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

/// <summary>
/// Loading page shown on app startup while starter data is being loaded.
/// Handles offline mode gracefully — never blocks indefinitely.
/// </summary>
public partial class LoadingPage : ContentPage
{
    private bool _isLoading;

    public LoadingPage()
    {
        InitializeComponent();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_isLoading)
            return;

        _isLoading = true;

        try
        {
            // Initialize config (loads API URL override from build config)
            await AppConfig.Instance.InitializeAsync();
            Console.WriteLine($"API URL: {AppConfig.Instance.GetApiUrl()}");

            // Load preferences (font, last perek, perek-to-load) so PerekPage can use them
            PreferencesService.Instance.Load();

            // Load PerekDataService (tanah) so GetTodaysPerekId works for startup preference
            if (!PerekDataService.Instance.IsLoaded)
                await PerekDataService.Instance.LoadAsync();

            await LoadStarterDataAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Startup error: {ex}");
        }

        // Start monitoring connectivity changes so we can refresh when back online
        NetworkService.Instance.StartMonitoring();

        // Always navigate — the app works without articles/authors
        await NavigateToMainPageAsync();
    }

    private async Task LoadStarterDataAsync()
    {
        LoadingLabel.Text = "מתחבר לפרק...";
        await StarterService.Instance.LoadWithRetryAsync();

        if (!StarterService.Instance.IsLoaded)
        {
            // Show the classic "התעיף עיניך" message briefly before navigating
            LoadingLabel.Text = "הֲתָעִיף עֵינֶיךָ בּוֹ וְאֵינֶנּוּ?\n(משלי כג ה)\n\nממשיכים ללא חיבור לשרת";
            await Task.Delay(1500);
        }
        else if (StarterService.Instance.IsFromCache)
        {
            LoadingLabel.Text = "נטען ממטמון מקומי";
        }
    }

    private static async Task NavigateToMainPageAsync()
    {
        // Navigate to the main PerekPage
        await Shell.Current.GoToAsync("//PerekPage");
    }
}
