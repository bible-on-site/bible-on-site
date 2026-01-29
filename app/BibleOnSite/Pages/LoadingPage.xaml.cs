using BibleOnSite.Config;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

/// <summary>
/// Loading page shown on app startup while starter data is being loaded.
/// Similar to the legacy Flutter app's splash/loading behavior.
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

            await LoadStarterDataAsync();
            await NavigateToMainPageAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to load starter data: {ex}");
            // Navigate anyway - pages will retry loading if needed
            await NavigateToMainPageAsync();
        }
    }

    private async Task LoadStarterDataAsync()
    {
        try
        {
            LoadingLabel.Text = "מתחבר לפרק...";
            await StarterService.Instance.LoadWithRetryAsync();
            Console.WriteLine($"Loaded {StarterService.Instance.Authors.Count} authors from API");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Starter loading failed: {ex.Message}");
            throw;
        }
    }

    private static async Task NavigateToMainPageAsync()
    {
        // Navigate to the main PerekPage
        await Shell.Current.GoToAsync("//PerekPage");
    }
}
