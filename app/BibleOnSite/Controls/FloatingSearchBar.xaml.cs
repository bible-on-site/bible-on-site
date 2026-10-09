using BibleOnSite.Data;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Controls;

#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class FloatingSearchBar : ContentView
#pragma warning restore S2333
{
    private readonly SearchViewModel _viewModel = new();
    private CancellationTokenSource? _debounce;
    private bool _buildingFilters = true;
    private bool _filtersBuilt;
    private readonly SearchHistoryService _history = new(new MauiPreferencesStorage());
    public bool IsSearchOpen => SearchPanel.IsVisible;
#pragma warning disable S3264 // Invoked below; subscribers include XAML and the Android reader callback.
    public event EventHandler? SearchOpenChanged;
    public event EventHandler<SearchResult>? ResultSelected;
#pragma warning restore S3264

    public FloatingSearchBar()
    {
        InitializeComponent();
        BindingContext = _viewModel;
        LimitPicker.ItemsSource = Enumerable.Range(1, 10).Select(value => value * 5).ToList();
        LimitPicker.SelectedItem = _viewModel.ResultsLimit;
        _viewModel.PropertyChanged += (_, _) => UpdateStatus();
        SearchPanel.SizeChanged += (_, _) => ResizeFilterSheet();
        RefreshRecentHistory();
        _buildingFilters = false;
    }

    public void SetSource(string source) => SearchInput.Placeholder = source;

    public View DetachHeader()
    {
        SearchLayout.Remove(SearchHeader);
        // Keep the source toolbar in place while the search page covers the reader.
        SearchHeader.BindingContext = _viewModel;
        return SearchHeader;
    }

    public Task OpenAsync() => OpenSearchAsync();

    public void FocusInput() => Dispatcher.Dispatch(() => SearchInput.Focus());

    private async void OnSearchFocused(object? sender, FocusEventArgs e)
    {
        await OpenSearchAsync();
    }

    private async Task OpenSearchAsync()
    {
        if (IsSearchOpen)
        {
            return;
        }
        SearchPanel.IsVisible = true;
        SearchOpenChanged?.Invoke(this, EventArgs.Empty);
        RefreshRecentHistory();
        _ = AnimateSearchPageAsync();
        UpdateStatus();
        try
        {
            // The reader loads authors from the API or cache during startup.
            // Opening local search must not require a second network request.
            _viewModel.SetAuthors(StarterService.Instance.Authors);
            _viewModel.SetPerushim(await PerushimCatalogService.Instance.GetAllPerushimAsync());
            if (!_filtersBuilt)
            {
                await BuildFiltersAsync();
            }
            if (IsSearchOpen)
            {
                ScheduleSearch();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Search initialization failed: {ex}");
            _viewModel.ErrorMessage = "שגיאה בטעינת החיפוש. נסו שוב";
        }
    }

    public void Close()
    {
        _debounce?.Cancel();
        _viewModel.CancelSearch();
        CloseFilterSheetImmediately();
        this.AbortAnimation("SearchPageEntrance");
        SearchPanel.IsVisible = false;
        SearchPanel.Opacity = 1;
        SearchPanel.TranslationY = 0;
        SearchOpenChanged?.Invoke(this, EventArgs.Empty);
        _ = HideKeyboardAsync();
        _viewModel.SearchPhrase = string.Empty;
        _viewModel.SearchResults.Clear();
        _viewModel.ErrorMessage = _viewModel.AvailabilityMessage = string.Empty;
        UpdateStatus();
    }

    private void OnNavigationClicked(object? sender, EventArgs e)
    {
        if (IsSearchOpen)
        {
            Close();
        }
        else
        {
            SearchInput.Focus();
        }
    }

    private void OnClearClicked(object? sender, EventArgs e)
    {
        SearchInput.Text = string.Empty;
        SearchInput.Focus();
    }
    private void OnSearchTextChanged(object? sender, TextChangedEventArgs e)
    {
        if (BindingContext == null)
        {
            return;
        }
        _viewModel.SearchPhrase = e.NewTextValue ?? string.Empty;
        _viewModel.SearchResults.Clear();
        CloseFilterSheetImmediately();
        if (string.IsNullOrWhiteSpace(_viewModel.SearchPhrase))
        {
            RefreshRecentHistory();
        }
        UpdateStatus();
        if (IsSearchOpen)
        {
            ScheduleSearch();
        }
    }

    private void ScheduleSearch(int delay = 500) => _ = RunSearchAsync(delay);

    private async Task RunSearchAsync(int delay)
    {
        _debounce?.Cancel();
        _debounce?.Dispose();
        _debounce = new CancellationTokenSource();
        var token = _debounce.Token;
        _viewModel.CancelSearch();
        _viewModel.SearchResults.Clear();
        _viewModel.LoadingMessage = "מחפש...";
        _viewModel.IsLoading = !string.IsNullOrWhiteSpace(_viewModel.SearchPhrase);
        try
        {
            await Task.Delay(delay, token);
            await _viewModel.SearchAsync(token);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // Replaced queries and closing the panel intentionally cancel this search.
        }
        catch (Exception ex) { Console.Error.WriteLine($"Search failed: {ex}"); }
        UpdateStatus();
    }

    private void OnSearchSubmitted(object? sender, EventArgs e)
    {
        RememberSearch();
        ScheduleSearch(0);
        _ = HideKeyboardAsync();
    }

    private async Task HideKeyboardAsync()
    {
        try
        {
            // Unfocus alone can leave Android's floating keyboard over the results.
            await SearchInput.HideSoftInputAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Could not dismiss search keyboard: {ex}");
        }
        SearchInput.Unfocus();
    }

    private void UpdateStatus()
    {
        NavigationButton.Text = IsSearchOpen ? Fonts.FluentUI.arrow_right_24_regular : Fonts.FluentUI.search_24_regular;
        SemanticProperties.SetDescription(NavigationButton, IsSearchOpen ? "סגירת החיפוש" : "חיפוש");
        ClearButton.IsVisible = !string.IsNullOrEmpty(_viewModel.SearchPhrase);
        ErrorText.IsVisible = !string.IsNullOrWhiteSpace(_viewModel.ErrorMessage);
        AvailabilityText.IsVisible = !string.IsNullOrWhiteSpace(_viewModel.AvailabilityMessage);
        SearchStatus.Text = _viewModel.IsLoading ? _viewModel.LoadingMessage :
            string.IsNullOrWhiteSpace(_viewModel.SearchPhrase) ? "חיפושים אחרונים" :
            _viewModel.SearchResults.Count == 0 ? "לא נמצאו תוצאות" : $"{_viewModel.SearchResults.Count} תוצאות";
        var emptyPhrase = string.IsNullOrWhiteSpace(_viewModel.SearchPhrase);
        ResultsList.IsVisible = !emptyPhrase && _viewModel.SearchResults.Count > 0;
        RecentList.IsVisible = emptyPhrase;
        UpdateFilterSummaries();
    }

    private async Task BuildFiltersAsync()
    {
        await PerekDataService.Instance.LoadAsync();
        _buildingFilters = true;
        try
        {
            KindsFilters.Clear();
            BookFilters.Clear();
            foreach (var filter in Enum.GetValues<SearchFilter>())
            {
                KindsFilters.Add(FilterRow(filter.GetHebrewName(), $"SearchKind{filter}", _viewModel.IsFilterEnabled(filter), enabled =>
                {
                    _viewModel.SetFilterEnabled(filter, enabled);
                    _kindsExplicit = true;
                    UpdateFilterSummaries();
                    ScheduleSearch();
                }));
            }
            foreach (var (key, group) in SefarimData.SefarimGroups)
            {
                var groupIndex = key - 1;
                var column = new VerticalStackLayout();
                var bookRows = new List<Grid>();
                var groupRow = FilterRow(group.Header, $"SearchGroup{key}", _viewModel.IsSeferGroupFilterEnabled(groupIndex), enabled =>
                {
                    _viewModel.SetSeferGroupFilterEnabled(groupIndex, enabled);
                    _booksExplicit = true;
                    UpdateFilterSummaries();
                    _buildingFilters = true;
                    foreach (var row in bookRows)
                    {
                        ((CheckBox)row.Children[0]).IsChecked = enabled;
                    }
                    _buildingFilters = false;
                    ScheduleSearch();
                });
                ((Label)groupRow.Children[1]).FontAttributes = FontAttributes.Bold;
                column.Add(groupRow);
                BookFilters.Add(column, groupIndex);
                var books = PerekDataService.Instance.Perakim!.Values.Where(perek => perek.SeferId >= group.From && perek.SeferId <= group.To)
                    .DistinctBy(perek => perek.SeferId).OrderBy(perek => perek.SeferId);
                foreach (var book in books)
                {
                    var row = FilterRow(book.SeferName, $"SearchBook{book.SeferId}", _viewModel.IsSeferFilterEnabled(book.SeferId), enabled =>
                    {
                        _viewModel.SetSeferFilterEnabled(book.SeferId, enabled);
                        _booksExplicit = true;
                        UpdateFilterSummaries();
                        _buildingFilters = true;
                        ((CheckBox)groupRow.Children[0]).IsChecked = _viewModel.IsSeferGroupFilterEnabled(groupIndex);
                        _buildingFilters = false;
                        ScheduleSearch();
                    });
                    ((Label)row.Children[1]).FontSize = 12;
                    bookRows.Add(row);
                    column.Add(row);
                }
            }
            _filtersBuilt = true;
        }
        finally { _buildingFilters = false; }
    }

    private Grid FilterRow(string title, string automationId, bool enabled, Action<bool> changed)
    {
        var checkBox = new CheckBox { IsChecked = enabled, AutomationId = automationId, WidthRequest = 32, HeightRequest = 44 };
        _filterChecks[automationId] = checkBox;
        SemanticProperties.SetDescription(checkBox, title);
        checkBox.CheckedChanged += (_, e) =>
        {
            if (!_buildingFilters)
            {
                changed(e.Value);
            }
        };
        var label = new Label { Text = title, VerticalOptions = LayoutOptions.Center };
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)] };
        row.Add(checkBox);
        row.Add(label, 1);
        var tap = new TapGestureRecognizer();
        tap.Tapped += (_, _) => checkBox.IsChecked = !checkBox.IsChecked;
        label.GestureRecognizers.Add(tap);
        return row;
    }

    private void OnLimitChanged(object? sender, EventArgs e)
    {
        if (LimitPicker.SelectedItem is not int limit)
        {
            return;
        }
        _viewModel.ResultsLimit = limit;
        if (!_buildingFilters)
        {
            _optionsExplicit = true;
            UpdateFilterSummaries();
        }
        if (IsSearchOpen)
        {
            ScheduleSearch();
        }
    }

    private void OnResultSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not SearchResult result)
        {
            return;
        }
        ResultsList.SelectedItem = null;
        RememberSearch();
        _debounce?.Cancel();
        _viewModel.CancelSearch();
        UpdateStatus();
        _ = HideKeyboardAsync();
        ResultSelected?.Invoke(this, result);
    }

    private Task AnimateSearchPageAsync()
    {
#if IOS
        if (UIKit.UIAccessibility.IsReduceMotionEnabled)
        {
            return Task.CompletedTask;
        }
#endif
        SearchPanel.Opacity = 0;
        SearchPanel.TranslationY = 32;
        var completion = new TaskCompletionSource();
        new Animation(progress =>
        {
            SearchPanel.Opacity = progress;
            SearchPanel.TranslationY = 32 * (1 - progress);
        }).Commit(this, "SearchPageEntrance", 16, 200, Easing.CubicOut, (_, _) => completion.TrySetResult());
        return completion.Task;
    }

    private void RefreshRecentHistory()
    {
        try
        {
            RecentList.ItemsSource = _history.Read();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Could not load recent searches: {ex}");
            RecentList.ItemsSource = Array.Empty<string>();
        }
    }

    private void RememberSearch()
    {
        try
        {
            _history.Remember(_viewModel.SearchPhrase);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Could not save recent search: {ex}");
        }
    }

    private async void OnRecentSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not string phrase)
        {
            return;
        }
        RecentList.SelectedItem = null;
        SearchInput.Text = phrase;
        RememberSearch();
        ScheduleSearch(0);
        await HideKeyboardAsync();
    }
}
