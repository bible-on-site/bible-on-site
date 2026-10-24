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
        LimitPicker.Value = _viewModel.ResultsLimit;
        _viewModel.PropertyChanged += (_, _) => UpdateStatus();
        SearchPanel.SizeChanged += (_, _) => ResizeFilterSheet();
        // Kind availability follows live prerequisites: connectivity and the
        // installed commentary pack (#2454). The subscriptions stay detached
        // while this control is unloaded so a popped reader is never kept
        // alive by the singleton services.
        AttachAvailabilityWatchers();
        Loaded += (_, _) =>
        {
            AttachAvailabilityWatchers();
            if (_filtersBuilt)
            {
                RefreshKindAvailability();
            }
        };
        Unloaded += (_, _) =>
        {
            DetachAvailabilityWatchers();
            _debounce?.Cancel();
            _viewModel.CancelSearch();
        };
        RefreshRecentHistory();
        _buildingFilters = false;
    }

    /// <summary>
    /// Kind-availability watchers on the singleton services. Named handlers +
    /// an idempotent attach/detach pair keep a popped reader from staying
    /// subscribed (and alive) for the process lifetime.
    /// </summary>
    private bool _watchingAvailability;
    private PerushimNotesService? _notesService;

    private void AttachAvailabilityWatchers()
    {
        if (_watchingAvailability)
        {
            return;
        }
        Connectivity.Current.ConnectivityChanged += OnConnectivityChanged;
        try
        {
            _notesService ??= PerushimNotesService.Instance;
            _notesService.OperationCompleted += OnNotesOperationCompleted;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: pack watcher attach is best-effort; a host without packs keeps static availability
        catch (Exception ex) when (ex is not OutOfMemoryException) //NOSONAR — pack watcher attach is best-effort; a host without packs keeps static availability.
        {
            #pragma warning restore S2221
            // A host without the pack service simply keeps static availability.
            Console.Error.WriteLine($"Commentary-pack watcher unavailable: {ex}");
        }
        _watchingAvailability = true;
    }

    private void DetachAvailabilityWatchers()
    {
        if (!_watchingAvailability)
        {
            return;
        }
        Connectivity.Current.ConnectivityChanged -= OnConnectivityChanged;
        if (_notesService != null)
        {
            _notesService.OperationCompleted -= OnNotesOperationCompleted;
        }
        _watchingAvailability = false;
    }

    private void OnConnectivityChanged(object? sender, ConnectivityChangedEventArgs e)
        => Dispatcher.Dispatch(RefreshKindAvailability);

    private void OnNotesOperationCompleted()
        => Dispatcher.Dispatch(RefreshKindAvailability);

    public void SetSource(string source) => SearchInput.Placeholder = source;

    /// <summary>
    /// The focused-pasuk reader narrows "מה לחפש" to תוכן פסוק and תוכן פירוש
    /// with their own selection; the reader's saved kinds are restored on exit
    /// (#2466). The sheet applies every change immediately, so it has no
    /// הצגת תוצאות button (#2454).
    /// </summary>
    public void SetFocusedPasukScope(bool scoped)
    {
        if (scoped == _viewModel.KindsScoped)
        {
            return;
        }
        if (scoped)
        {
            _viewModel.EnterKindsScope([SearchFilter.Pasuk, SearchFilter.Perush]);
        }
        else
        {
            _viewModel.ExitKindsScope();
        }
        if (_filtersBuilt)
        {
            BuildKindFilters();
        }
        UpdateFilterSummaries();
    }

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
        #pragma warning disable S2221 // Deliberate failure boundary: search-init failure surfaces as a user-facing error message
        catch (Exception ex) //NOSONAR — search-init failure surfaces as a user-facing error message.
        {
            #pragma warning restore S2221
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
        _viewModel.ShowPerushimDownloadLink = false;
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
        #pragma warning disable S2221 // Deliberate failure boundary: user-triggered search failure is logged; status refresh continues
        catch (Exception ex) { Console.Error.WriteLine($"Search failed: {ex}"); } //NOSONAR — user-triggered search failure is logged; status refresh continues.
        #pragma warning restore S2221
        UpdateStatus();
    }

    private void OnSearchSubmitted(object? sender, EventArgs e)
    {
        RememberSearch();
        ScheduleSearch(0);
        _ = HideKeyboardAsync();
    }

    private async void OnPerushimDownloadLinkTapped(object? sender, TappedEventArgs e)
    {
        try
        {
            await Shell.Current.GoToAsync(AppRoutes.ExtensionPacks);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: navigation failure is log-only
        catch (Exception ex) //NOSONAR — a navigation failure must not crash the picker.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Navigate to perushim download failed: {ex}");
        }
    }

    private async Task HideKeyboardAsync()
    {
        try
        {
            // Unfocus alone can leave Android's floating keyboard over the results.
            await SearchInput.HideSoftInputAsync(CancellationToken.None);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: keyboard dismissal is best-effort
        catch (Exception ex) //NOSONAR — keyboard dismissal is best-effort.
        {
            #pragma warning restore S2221
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
        PerushimDownloadLink.IsVisible = _viewModel.ShowPerushimDownloadLink;
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
            BuildKindFilters();
            var (booksSelectAllRow, booksSelectAll) = SelectAllRow("SearchBooksSelectAll", state =>
            {
                var select = state == TriCheckState.Checked;
                _buildingFilters = true;
                try
                {
                    _viewModel.SetAllSefarimEnabled(select);
                    foreach (var pair in _filterChecks.Where(pair => !pair.Key.StartsWith("SearchKind", StringComparison.Ordinal)))
                    {
                        pair.Value.IsChecked = select;
                    }
                    _booksExplicit = true;
                }
                finally { _buildingFilters = false; }
                UpdateBooksSelectAll();
                UpdateFilterSummaries();
                ScheduleSearch();
            });
            _booksSelectAll = booksSelectAll;
            Grid.SetColumnSpan(booksSelectAllRow, 3);
            BookFilters.Add(booksSelectAllRow, 0, 0);
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
                    UpdateBooksSelectAll();
                    ScheduleSearch();
                });
                ((Label)groupRow.Children[1]).FontAttributes = FontAttributes.Bold;
                column.Add(groupRow);
                BookFilters.Add(column, groupIndex, 1);
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
                        UpdateBooksSelectAll();
                        ScheduleSearch();
                    });
                    ((Label)row.Children[1]).FontSize = 12;
                    bookRows.Add(row);
                    column.Add(row);
                }
            }
            UpdateBooksSelectAll();
            _filtersBuilt = true;
        }
        finally { _buildingFilters = false; }
    }

    /// <summary>One row in the kinds sheet: the checkbox plus an availability reason under the name (#2454).</summary>
    private sealed class KindRow(CheckBox check, Label title, Label reason, Grid grid)
    {
        public CheckBox Check { get; } = check;
        public Label Title { get; } = title;
        public Label Reason { get; } = reason;
        public Grid Grid { get; } = grid;
    }

    private readonly Dictionary<SearchFilter, KindRow> _kindRows = new();
    private TriStateCheckBox? _kindsSelectAll;
    private TriStateCheckBox? _booksSelectAll;

    /// <summary>
    /// A בחר הכל row above an option set: the tri-state box mirrors the set's
    /// all/partial/none selection and a tap selects or clears everything (#2454).
    /// </summary>
    private static (Grid Row, TriStateCheckBox Box) SelectAllRow(string automationId, Action<TriCheckState> toggled)
    {
        var box = new TriStateCheckBox { AutomationId = automationId };
        SemanticProperties.SetDescription(box, "בחר הכל");
        box.Toggled = () => toggled(box.State);
        var label = new Label { Text = "בחר הכל", FontAttributes = FontAttributes.Bold, VerticalOptions = LayoutOptions.Center };
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)] };
        row.Add(box);
        row.Add(label, 1);
        var tap = new TapGestureRecognizer();
        tap.Tapped += (_, _) => box.Toggle();
        label.GestureRecognizers.Add(tap);
        return (row, box);
    }

    /// <summary>A kind row whose checkbox is disabled with a reason while its prerequisite is missing.</summary>
    private Grid KindFilterRow(SearchFilter filter)
    {
        var title = new Label { Text = filter.GetHebrewName(), VerticalOptions = LayoutOptions.Center };
        var reason = new Label
        {
            FontSize = 12,
            IsVisible = false,
            TextColor = Color.FromArgb("#52647C"),
            VerticalOptions = LayoutOptions.Center
        };
        reason.SetAppThemeColor(Label.TextColorProperty, Color.FromArgb("#52647C"), Color.FromArgb("#B2C2D8"));
        var checkBox = new CheckBox { IsChecked = _viewModel.IsFilterEnabled(filter), AutomationId = $"SearchKind{filter}", WidthRequest = 32, HeightRequest = 44 };
        _filterChecks[$"SearchKind{filter}"] = checkBox;
        checkBox.CheckedChanged += (_, e) =>
        {
            if (_buildingFilters)
            {
                return;
            }
            _viewModel.SetFilterEnabled(filter, e.Value);
            _kindsExplicit = true;
            UpdateKindsSelectAll();
            UpdateFilterSummaries();
            ScheduleSearch();
        };
        var labels = new VerticalStackLayout { title, reason };
        var row = new Grid { ColumnDefinitions = [new ColumnDefinition(GridLength.Auto), new ColumnDefinition(GridLength.Star)] };
        row.Add(checkBox);
        row.Add(labels, 1);
        var tap = new TapGestureRecognizer();
        tap.Tapped += (_, _) =>
        {
            if (row.IsEnabled)
            {
                checkBox.IsChecked = !checkBox.IsChecked;
            }
        };
        labels.GestureRecognizers.Add(tap);
        _kindRows[filter] = new KindRow(checkBox, title, reason, row);
        return row;
    }

    /// <summary>
    /// Re-evaluates every kind against current connectivity and the installed
    /// commentary pack, disabling the row and showing the missing prerequisite
    /// while keeping the stored selection intent (#2454). Called when the
    /// sheet opens, when connectivity changes, and when the pack changes.
    /// </summary>
    private void RefreshKindAvailability()
    {
        foreach (var (filter, row) in _kindRows)
        {
            var reason = _viewModel.KindUnavailableReason(filter);
            var available = reason == null;
            row.Grid.IsEnabled = available;
            row.Reason.IsVisible = !available;
            row.Title.Opacity = available ? 1 : 0.55;
            row.Check.Opacity = available ? 1 : 0.55;
            if (reason != null)
            {
                row.Reason.Text = reason;
            }
            SemanticProperties.SetDescription(row.Check, available ? row.Title.Text : $"{row.Title.Text}, {reason}");
        }
        UpdateKindsSelectAll();
        // Availability that returns after a search snapshotted its kinds (or
        // mid-flight) leaves results missing until a retype — re-run the open
        // query once the regained kinds can actually serve it (#2454).
        if (IsSearchOpen
            && !string.IsNullOrWhiteSpace(_viewModel.SearchPhrase)
            && _viewModel.HasRegainedAvailableKind())
        {
            ScheduleSearch();
        }
    }

    /// <summary>Mirrors the kinds set's all/partial/none selection onto its בחר הכל box.</summary>
    private void UpdateKindsSelectAll()
    {
        if (_kindsSelectAll == null)
        {
            return;
        }
        var available = _kindRows.Keys.Where(_viewModel.IsKindAvailable).ToList();
        _kindsSelectAll.State = TriStateCheckBox.DeriveState(available.Count(_viewModel.IsFilterEnabled), available.Count);
        _kindsSelectAll.IsEnabled = available.Count > 0;
    }

    /// <summary>Mirrors the sefarim set's all/partial/none selection onto its בחר הכל box.</summary>
    private void UpdateBooksSelectAll()
    {
        if (_booksSelectAll == null)
        {
            return;
        }
        var total = SefarimData.SefarimGroups.Values.Sum(group => group.To - group.From + 1);
        var selected = Enumerable.Range(1, total).Count(_viewModel.IsSeferFilterEnabled);
        _booksSelectAll.State = TriStateCheckBox.DeriveState(selected, total);
    }

    /// <summary>
    /// Rebuilds the kinds rows so the sheet always reflects the active scope
    /// and current content availability (#2466, #2454): in the focused-pasuk
    /// scope only its kinds are listed, and a kind whose prerequisite is
    /// missing is shown disabled with its reason.
    /// </summary>
    private void BuildKindFilters()
    {
        KindsFilters.Clear();
        foreach (var key in _filterChecks.Keys.Where(key => key.StartsWith("SearchKind", StringComparison.Ordinal)).ToList())
        {
            _filterChecks.Remove(key);
        }
        _kindRows.Clear();
        var (kindsSelectAllRow, kindsSelectAll) = SelectAllRow("SearchKindsSelectAll", state =>
        {
            var select = state == TriCheckState.Checked;
            _buildingFilters = true;
            try
            {
                _viewModel.SetAvailableFiltersEnabled(select);
                foreach (var filter in _kindRows.Keys.Where(_viewModel.IsKindAvailable))
                {
                    _kindRows[filter].Check.IsChecked = select;
                }
                _kindsExplicit = true;
            }
            finally { _buildingFilters = false; }
            UpdateKindsSelectAll();
            UpdateFilterSummaries();
            ScheduleSearch();
        });
        _kindsSelectAll = kindsSelectAll;
        KindsFilters.Add(kindsSelectAllRow);
        foreach (var filter in _viewModel.KindOptions)
        {
            KindsFilters.Add(KindFilterRow(filter));
        }
        RefreshKindAvailability();
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
        var limit = (int)LimitPicker.Value;
        if (limit == _viewModel.ResultsLimit)
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
        #pragma warning disable S2221 // Deliberate failure boundary: recent-searches load degrades to an empty list
        catch (Exception ex) //NOSONAR — recent-searches load degrades to an empty list.
        {
            #pragma warning restore S2221
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
        #pragma warning disable S2221 // Deliberate failure boundary: recent-search persistence is best-effort
        catch (Exception ex) //NOSONAR — recent-search persistence is best-effort.
        {
            #pragma warning restore S2221
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
