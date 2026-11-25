using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

/// <summary>Hosts the app's existing search, including the Screen kind, above home.</summary>
#pragma warning disable S2333 // MAUI XAML supplies the other half of this page.
public partial class HomeSearchPage : ContentPage, IAnalyticsScreenName
#pragma warning restore S2333
{
    private bool _active;
    public AnalyticsScreen? AnalyticsScreen => new("HomeSearch", nameof(HomeSearchPage));

    public HomeSearchPage()
    {
        InitializeComponent();
        UnifiedSearch.SearchOpenChanged += async (_, _) =>
        {
            if (_active && !UnifiedSearch.IsSearchOpen)
            {
                await ShellAppNavigator.Instance.GoToAsync("..");
            }
        };
    }

    protected override async void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        _active = true;
        await UnifiedSearch.OpenAsync();
        UnifiedSearch.FocusInput();
    }

    protected override void OnDisappearing()
    {
        _active = false;
        _ = UnifiedSearch.SuspendAsync();
        base.OnDisappearing();
    }

    protected override bool OnBackButtonPressed()
    {
        UnifiedSearch.HandleBack();
        return true;
    }

    private async void OnResultSelected(object? sender, SearchResult result)
    {
        _ = sender; // The shared XAML event supplies the originating control.
        var navigator = ShellAppNavigator.Instance;
        switch (result)
        {
            case ScreenSearchResult screen:
                await navigator.GoToAsync(screen.Destination.Route);
                break;
            case AuthorSearchResult author:
                await navigator.GoToAsync($"{AppRoutes.Articles}?authorId={author.Author.Id}&authorName={Uri.EscapeDataString(author.Author.Name)}");
                break;
            case ArticleSearchResult article:
                await navigator.GoToAsync($"{AppRoutes.ArticleDetail}?articleId={article.ArticleId}&perekId={article.PerekId}" +
                    $"&searchExcerpt={Uri.EscapeDataString(article.Excerpt)}&searchPhrase={Uri.EscapeDataString(article.SearchPhrase)}");
                break;
            case TanahpediaSearchResult entry:
                await navigator.GoToAsync(AppRoutes.TanahpediaEntry(entry.UniqueName));
                break;
            default:
                await navigator.GoToAsync(AppRoutes.SearchReader, false,
                    new ShellNavigationQueryParameters { ["searchResult"] = result });
                break;
        }
    }
}
