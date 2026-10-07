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
    private bool _buildingFilters;
    private bool _filtersBuilt;
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
    }

    public void SetSource(string source) => SearchInput.Placeholder = source;

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
        SearchPanel.IsVisible = FiltersPanel.IsVisible = false;
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
        FiltersPanel.IsVisible = false;
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
            string.IsNullOrWhiteSpace(_viewModel.SearchPhrase) ? "הקלידו פרק, פסוק, פירוש או שם רב" :
            _viewModel.SearchResults.Count == 0 ? "לא נמצאו תוצאות" : $"{_viewModel.SearchResults.Count} תוצאות";
        ResultsList.IsVisible = !FiltersPanel.IsVisible && _viewModel.SearchResults.Count > 0;
    }

    private async void OnFiltersClicked(object? sender, EventArgs e)
    {
        await OpenSearchAsync();
        if (!IsSearchOpen)
        {
            return;
        }
        FiltersPanel.IsVisible = !FiltersPanel.IsVisible;
        await HideKeyboardAsync();
        UpdateStatus();
    }

    private void ShowFilterTab(VerticalStackLayout tab)
    {
        KindsFilters.IsVisible = tab == KindsFilters;
        BookFilters.IsVisible = tab == BookFilters;
        MoreFilters.IsVisible = tab == MoreFilters;
    }
    private void OnKindsTabClicked(object? sender, EventArgs e) => ShowFilterTab(KindsFilters);
    private void OnBooksTabClicked(object? sender, EventArgs e) => ShowFilterTab(BookFilters);
    private void OnOptionsTabClicked(object? sender, EventArgs e) => ShowFilterTab(MoreFilters);

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
                    ScheduleSearch();
                }));
            }
            foreach (var (key, group) in SefarimData.SefarimGroups)
            {
                var groupIndex = key - 1;
                var groupRow = FilterRow(group.Header, $"SearchGroup{key}", _viewModel.IsSeferGroupFilterEnabled(groupIndex), enabled =>
                {
                    _viewModel.SetSeferGroupFilterEnabled(groupIndex, enabled);
                    _ = BuildFiltersAsync();
                    ScheduleSearch();
                });
                BookFilters.Add(groupRow);
                var books = PerekDataService.Instance.Perakim!.Values.Where(perek => perek.SeferId >= group.From && perek.SeferId <= group.To)
                    .DistinctBy(perek => perek.SeferId).OrderBy(perek => perek.SeferId);
                foreach (var book in books)
                {
                    BookFilters.Add(FilterRow(book.SeferName, $"SearchBook{book.SeferId}", _viewModel.IsSeferFilterEnabled(book.SeferId), enabled =>
                    {
                        _viewModel.SetSeferFilterEnabled(book.SeferId, enabled);
                        _buildingFilters = true;
                        ((CheckBox)groupRow.Children[0]).IsChecked = _viewModel.IsSeferGroupFilterEnabled(groupIndex);
                        _buildingFilters = false;
                        ScheduleSearch();
                    }));
                }
            }
            _filtersBuilt = true;
        }
        finally { _buildingFilters = false; }
    }

    private Grid FilterRow(string title, string automationId, bool enabled, Action<bool> changed)
    {
        var checkBox = new CheckBox { IsChecked = enabled, AutomationId = automationId };
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
        Close();
        ResultSelected?.Invoke(this, result);
    }
}
