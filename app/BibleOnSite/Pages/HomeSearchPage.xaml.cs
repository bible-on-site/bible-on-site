using System.ComponentModel;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other half of this page.
public partial class HomeSearchPage : ContentPage, IAnalyticsScreenName
#pragma warning restore S2333
{
    private readonly SearchViewModel _content = new();
    private CancellationTokenSource? _debounce;
    public string AnalyticsScreenName => "HomeSearch";

    public HomeSearchPage()
    {
        InitializeComponent();
        _content.SetAuthors(StarterService.Instance.Authors);
        BindableLayout.SetItemsSource(ContentResults, _content.SearchResults);
        BindableLayout.SetItemsSource(NavigationResults, HomeNavigationSearch.Find(string.Empty));
        _content.PropertyChanged += OnSearchStateChanged;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        Dispatcher.Dispatch(() => GlobalQuery.Focus());
    }

    protected override void OnDisappearing()
    {
        _debounce?.Cancel();
        _content.CancelSearch();
        GlobalQuery.Unfocus();
        base.OnDisappearing();
    }

    private async void OnQueryChanged(object? sender, TextChangedEventArgs e)
    {
        _debounce?.Cancel();
        _debounce?.Dispose();
        _debounce = new CancellationTokenSource();
        var token = _debounce.Token;
        var query = e.NewTextValue ?? string.Empty;
        var navigation = HomeNavigationSearch.Find(query);
        BindableLayout.SetItemsSource(NavigationResults, navigation);
        NavigationSection.IsVisible = navigation.Count > 0;
        _content.SearchPhrase = query;
        _content.SearchResults.Clear();
        ContentSection.IsVisible = !string.IsNullOrWhiteSpace(query);
        if (!ContentSection.IsVisible) { return; }
        SearchStatus.Text = "מחפש בתוכן...";
        try
        {
            await Task.Delay(250, token);
            await _content.SearchAsync(token);
        }
        catch (OperationCanceledException)
        {
            // A replacement query or navigation owns the visible results.
        }
        #pragma warning disable S2221 // UI failure boundary: keep local navigation usable after a content-search failure.
        catch (Exception ex) when (ex is not OutOfMemoryException) //NOSONAR - the view model already exposes the search error.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[HomeSearch] Content search failed: {ex}");
        }
    }

    private void OnSearchStateChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is not SearchViewModel model || e.PropertyName is not
            (nameof(SearchViewModel.SearchResults) or nameof(SearchViewModel.IsLoading) or
             nameof(SearchViewModel.ErrorMessage) or nameof(SearchViewModel.AvailabilityMessage)))
        {
            return;
        }
        ContentLoading.IsRunning = model.IsLoading;
        ContentLoading.IsVisible = model.IsLoading;
        SearchStatus.Text = model.IsLoading ? "מחפש בתוכן..." :
            model.SearchResults.Count > 0 ? $"{model.SearchResults.Count} תוצאות בתוכן" :
            string.IsNullOrWhiteSpace(model.ErrorMessage) ? "לא נמצאו תוצאות בתוכן" : model.ErrorMessage;
        SearchAvailability.Text = model.AvailabilityMessage;
        SearchAvailability.IsVisible = !string.IsNullOrWhiteSpace(model.AvailabilityMessage);
    }

    private async void OnNavigationResultTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not NavigationSearchItem item) { return; }
        GlobalQuery.Unfocus();
        if (item.Route == HomeNavigationSearch.IndexAction)
        {
            SearchIndexPicker.Show(PerekDataService.Instance.GetTodaysPerekId());
            return;
        }
        await ShellAppNavigator.Instance.GoToAsync(item.Route);
    }

    private async void OnContentResultTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is not SearchResult result) { return; }
        GlobalQuery.Unfocus();
        var navigator = ShellAppNavigator.Instance;
        switch (result)
        {
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

    protected override bool OnBackButtonPressed()
    {
        if (SearchIndexPicker.IsVisible)
        {
            SearchIndexPicker.Hide();
            return true;
        }
        return base.OnBackButtonPressed();
    }

    private async void OnIndexPerekSelected(int perekId) =>
        await ShellAppNavigator.Instance.GoToAsync($"{AppRoutes.CalendarReader}?perekId={perekId}");
    private async void OnBackClicked(object? sender, EventArgs e) =>
        await ShellAppNavigator.Instance.GoToAsync("..");
    private void OnClearClicked(object? sender, EventArgs e) => GlobalQuery.Text = string.Empty;
}
