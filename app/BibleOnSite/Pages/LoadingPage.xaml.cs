using BibleOnSite.Config;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

/// <summary>
/// Loading page shown on app startup while starter data is being loaded.
/// Handles offline mode gracefully — never blocks indefinitely.
/// </summary>
public partial class LoadingPage : ContentPage, IAnalyticsScreenName
{
    private bool _isLoading;

    /// <summary>Transient bootstrap screen — never a reportable GA screen.</summary>
    public string? AnalyticsScreenName => null;

    public LoadingPage()
    {
        InitializeComponent();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_isLoading)
        {
            return;
        }

        _isLoading = true;

        Task? perekLoad = null;
        try
        {
            // The perek catalog load is pure local work (packaged-DB refresh +
            // SQLite reads) with no dependency on config or the network — start
            // it first so it overlaps the steps below instead of queuing behind.
            perekLoad = PerekDataService.Instance.LoadAsync();

            // Initialize config (loads API URL override from build config). Must
            // finish before StarterService resolves GetApiUrl() for its client.
            await AppConfig.Instance.InitializeAsync();
            Console.WriteLine($"API URL: {AppConfig.Instance.GetApiUrl()}");

            // Load preferences (font, last perek, perek-to-load) so PerekPage can use them
            PreferencesService.Instance.Load();

            // Starter data (GraphQL with cache/offline fallbacks) is independent
            // of the local catalog — wait for both before opening the reader.
            await Task.WhenAll(perekLoad, LoadStarterDataAsync());
        }
        catch (Exception ex)
        {
            // The catalog load ran in parallel and may still be in flight here
            // (e.g. AppConfig threw before WhenAll was awaited). Observe its
            // fault — already faulted or faulting later — so it is never left
            // as an unobserved task exception.
            if (perekLoad != null)
            {
                _ = perekLoad.ContinueWith(
                    t => Console.Error.WriteLine($"Perek data load failed: {t.Exception}"),
                    CancellationToken.None,
                    TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default);
            }
            Console.Error.WriteLine($"Startup error: {ex}");
        }

        // Start monitoring connectivity changes so we can refresh when back online
        NetworkService.Instance.StartMonitoring();

        // Always open the reader — the app works without articles/authors
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
        Console.WriteLine("[Startup] Opening PerekPage in the existing ShellContent");
        await MainThread.InvokeOnMainThreadAsync(() => ((AppShell)Shell.Current).CompleteStartup());
        Console.WriteLine("[Startup] PerekPage startup completed");
    }
}
