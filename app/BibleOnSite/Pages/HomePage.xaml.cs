using BibleOnSite.Services;
using BibleOnSite.Helpers;
using System.Globalization;

namespace BibleOnSite.Pages;

/// <summary>Native home UX preview; uses the packaged catalog and existing destinations.</summary>
#pragma warning disable S2333 // The MAUI XAML compiler generates the other half of this page.
public partial class HomePage : ContentPage, IAnalyticsScreenName
#pragma warning restore S2333
{
    private int _dailyPerekId;
    private bool _loading;
    public string AnalyticsScreenName => "Home";

    public HomePage()
    {
        InitializeComponent();
        TodayLabel.Text = DateTime.Today.ToString("dddd", CultureInfo.GetCultureInfo("he-IL"));
#if ANDROID || IOS
        var statusBar = new CommunityToolkit.Maui.Behaviors.StatusBarBehavior
        {
            ApplyOn = CommunityToolkit.Maui.Behaviors.StatusBarApplyOn.OnPageNavigatedTo
        };
        statusBar.SetBinding(CommunityToolkit.Maui.Behaviors.StatusBarBehavior.StatusBarColorProperty,
            new Binding(nameof(BackgroundColor), source: this));
        statusBar.SetAppTheme(CommunityToolkit.Maui.Behaviors.StatusBarBehavior.StatusBarStyleProperty,
            CommunityToolkit.Maui.Core.StatusBarStyle.DarkContent,
            CommunityToolkit.Maui.Core.StatusBarStyle.LightContent);
        Behaviors.Add(statusBar);
#endif
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (AppLinkHelper.PendingTarget is not null && Shell.Current is AppShell shell)
        {
            await shell.OpenHomeUxAppLinkAsync();
            if (shell.CurrentPage != this) { return; }
        }
        await LoadDailyPerekAsync();
    }

    private async Task LoadDailyPerekAsync()
    {
        if (_loading) { return; }
        _loading = true;
        HomeError.IsVisible = false;
        try
        {
            var catalog = PerekDataService.Instance;
            await catalog.LoadAsync();
            _dailyPerekId = catalog.GetTodaysPerekId();
            var perek = catalog.GetPerek(_dailyPerekId)
                ?? throw new InvalidOperationException("The daily chapter is absent from the catalog.");
            var verses = await catalog.LoadPasukimAsync(_dailyPerekId);
            DailySource.Text = catalog.GetPerekSource(_dailyPerekId);
            DailyGlyph.Text = perek.PerekNumber.ToHebrewLetters();
            DailyTitle.Text = perek.Header;
            DailyTitle.IsVisible = !string.IsNullOrWhiteSpace(perek.Header);
            VerseCount.Text = $"{verses.Count} פסוקים";
            var starter = StarterService.Instance;
            ArticleCount.Text = starter.IsLoaded
                ? $"{starter.GetDailyPerekArticlesCount(_dailyPerekId)} מאמרים היום"
                : "מאמרים בחיבור לרשת";
            DailyPerekCard.IsEnabled = true;
        }
        #pragma warning disable S2221 // UI failure boundary: a catalog failure keeps other destinations available and offers retry.
        catch (Exception ex) //NOSONAR — a catalog failure leaves the other home destinations available and offers a retry.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Home] Daily chapter load failed: {ex}");
            DailySource.Text = "הפרק היומי";
            DailyPerekCard.IsEnabled = false;
            HomeError.IsVisible = true;
        }
        finally { _loading = false; }
    }

    protected override bool OnBackButtonPressed()
    {
        if (HomeIndexPicker.IsVisible)
        {
            HomeIndexPicker.Hide();
            return true;
        }
        return base.OnBackButtonPressed();
    }

    private static Task OpenAsync(string route) => ShellAppNavigator.Instance.GoToAsync(route);
    private async void OnGlobalSearchTapped(object? sender, TappedEventArgs e) =>
        await OpenAsync(nameof(HomeSearchPage));
    private async void OnDailyPerekTapped(object? sender, TappedEventArgs e) =>
        await OpenAsync($"{AppRoutes.CalendarReader}?perekId={_dailyPerekId}");
    private void OnIndexTapped(object? sender, TappedEventArgs e) => HomeIndexPicker.Show(Math.Max(1, _dailyPerekId));
    private async void OnIndexPerekSelected(int perekId) =>
        await OpenAsync($"{AppRoutes.CalendarReader}?perekId={perekId}");
    private async void OnCalendarTapped(object? sender, TappedEventArgs e) => await OpenAsync(AppRoutes.LearningCalendar);
    private async void OnMasoraTapped(object? sender, TappedEventArgs e) => await OpenAsync(AppRoutes.Masora);
    private async void OnAuthorsTapped(object? sender, TappedEventArgs e) => await OpenAsync(AppRoutes.Authors);
    private async void OnPreferencesClicked(object? sender, EventArgs e) => await OpenAsync(AppRoutes.Preferences);
    private async void OnDestinationTapped(object? sender, TappedEventArgs e)
    {
        _ = sender; // The XAML activation carries the destination in its parameter.
        if (e.Parameter is string route) { await OpenAsync(route); }
    }
    private async void OnRetryClicked(object? sender, EventArgs e) => await LoadDailyPerekAsync();
}
