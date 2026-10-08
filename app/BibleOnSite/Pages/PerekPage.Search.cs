using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class PerekPage
#pragma warning restore S2333
{
    private bool _preserveSearchOnDisappear;
    private SearchResult? _searchReaderResult;
    private View? _searchHeader;

    private async void OnPerekSourceClicked(object? sender, EventArgs e) => await ChapterSearch.OpenAsync();

    private void OnChapterSearchOpenChanged(object? sender, EventArgs e) => UpdateSelectionBar();

    private void OnReaderMenuClicked(object? sender, EventArgs e) => Shell.Current.FlyoutIsPresented = true;

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("searchResult", out var value) && value is SearchResult result && GetSearchPerekId(result) > 0)
        {
            _searchReaderResult = result;
        }
    }

    private static int GetSearchPerekId(SearchResult result) => result switch
    {
        PerekSearchResult chapter => chapter.Perek.PerekId,
        PasukSearchResult verse => verse.PerekId,
        PerushSearchResult commentary => commentary.PerekId,
        _ => 0
    };

#pragma warning disable S1172 // The XAML event delegate requires the sender parameter.
    private async void OnSearchResultSelected(object? sender, SearchResult result)
#pragma warning restore S1172
    {
        if (_preserveSearchOnDisappear)
        {
            return;
        }
        _preserveSearchOnDisappear = true;
        try
        {
            if (result is AuthorSearchResult author)
            {
                await Shell.Current.GoToAsync($"ArticlesPage?authorId={author.Author.Id}&authorName={Uri.EscapeDataString(author.Author.Name)}");
            }
            else if (GetSearchPerekId(result) > 0)
            {
                await Shell.Current.GoToAsync(AppRoutes.SearchReader, false, new ShellNavigationQueryParameters
                {
                    ["searchResult"] = result
                });
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Search navigation failed: {ex}");
            await DisplayAlertAsync("חיפוש", "לא ניתן לפתוח את תוצאת החיפוש. נסו שוב", "אישור");
        }
        finally
        {
            _preserveSearchOnDisappear = false;
        }
    }

    private async Task ApplySearchReaderLocationAsync()
    {
        var result = _searchReaderResult;
        _searchReaderResult = null;
        var pasukNum = result switch
        {
            PasukSearchResult verse => verse.Pasuk.PasukNum,
            PerushSearchResult commentary => commentary.PasukNum,
            _ => 0
        };
        if (result is PerushSearchResult note && int.TryParse(note.PerushId, out var perushId) && !_viewModel.IsPerushChecked(perushId))
        {
            _viewModel.ToggleCheckedPerush(perushId);
        }
        if (_viewModel.Perek?.Pasukim.FirstOrDefault(pasuk => pasuk.PasukNum == pasukNum) is not { } pasuk)
        {
            return;
        }

        // The carousel realizes its chapter list after the page is laid out.
        // Scroll the ordinary reader instead of entering verse-selection mode.
        for (var attempt = 0; attempt < 40; attempt++)
        {
            var list = PerekCarousel.GetVisualTreeDescendants().OfType<CollectionView>()
                .FirstOrDefault(view => view.BindingContext == _viewModel.Perek && view.Handler != null && view.Height > 0);
            if (list != null)
            {
                list.ScrollTo(pasuk, position: ScrollToPosition.Start, animate: false);
                return;
            }
            await Task.Delay(50);
        }
        Console.Error.WriteLine($"Search reader could not locate verse {pasukNum} in chapter {_viewModel.PerekId}.");
    }
}
