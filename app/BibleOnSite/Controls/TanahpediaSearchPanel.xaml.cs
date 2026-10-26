using BibleOnSite.Models;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Controls;

/// <summary>
/// The Tanahpedia-scoped search overlay — the על הפרק search experience
/// (header, מה לחפש filter sheet, status row, results list) bound to
/// <see cref="TanahpediaSearchViewModel"/> so only the encyclopedia provider
/// runs and its corpus narrows by taxonomy categories, never by the general
/// reader's provider choices. One instance lives on each Tanahpedia page, so
/// query, category selection and results survive entry navigation.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class TanahpediaSearchPanel : ContentView
#pragma warning restore S2333
{
    private readonly TanahpediaSearchViewModel _viewModel = new();
    private CancellationTokenSource? _debounce;
    private bool _buildingFilters;
    private bool _filtersBuilt;
    private string? _presetKey;
    private int _sheetVersion;

    /// <summary>Invoked when the user taps a result — the page navigates to the entry.</summary>
    public Action<string>? OnEntrySelected { get; set; }

    public bool IsSearchOpen => IsVisible;

    /// <summary>The Tanahpedia search view model — kept alive with the page.</summary>
    public TanahpediaSearchViewModel Search => _viewModel;

    public TanahpediaSearchPanel()
    {
        InitializeComponent();
        BindingContext = _viewModel;
        UpdateStatus();
    }

    /// <summary>
    /// Sets the context preset — null for the landing page (all categories),
    /// a category key on fresh navigation to a category page. Applied once,
    /// at the first open; a preserved instance never resets it.
    /// </summary>
    public void SetCategoryPreset(string? categoryKey) => _presetKey ??= categoryKey;

    public async Task OpenAsync()
    {
        if (IsVisible)
        {
            return;
        }
        _viewModel.ApplyCategoryPreset(_presetKey);
        IsVisible = true;
        BuildFilters();
        UpdateStatus();
        await Task.CompletedTask;
        SearchInput.Focus();
    }

    public void Close()
    {
        _debounce?.Cancel();
        _viewModel.CancelSearch();
        CloseFilterSheetImmediately();
        IsVisible = false;
        _ = HideKeyboardAsync();
    }

    /// <summary>Device/system Back while the search is open closes it (or its sheet).</summary>
    public bool HandleBack()
    {
        if (!IsVisible)
        {
            return false;
        }
        if (FilterSheetOverlay.IsVisible)
        {
            _ = CloseFilterSheetAsync();
        }
        else
        {
            Close();
        }
        return true;
    }

    private void BuildFilters()
    {
        if (_filtersBuilt)
        {
            return;
        }
        _filtersBuilt = true;
        _buildingFilters = true;
        try
        {
            KindsFilters.Clear();
            KindsFilters.Add(FilterRow("בחר הכל", "TanahpediaKindAll", _viewModel.AllSelected, enabled =>
            {
                if (enabled)
                {
                    _viewModel.SelectAllCategories();
                }
                else
                {
                    // Narrowing past בחר הכל starts from the taxonomy: keep
                    // the per-row toggles authoritative instead of a dead end.
                }
            }));
            foreach (var parent in TanahpediaTaxonomy.Hierarchy)
            {
                var parentRow = FilterRow(parent.Label, $"TanahpediaKind{parent.Key}",
                    _viewModel.IsCategoryEnabled(parent.Key), enabled =>
                        _viewModel.SetCategoryEnabled(parent.Key, enabled));
                ((Label)parentRow.Children[1]).FontAttributes = FontAttributes.Bold;
                KindsFilters.Add(parentRow);
                foreach (var childRow in parent.Children.Select(child =>
                {
                    var row = FilterRow(child.Label, $"TanahpediaKind{child.Key}",
                        _viewModel.IsCategoryEnabled(child.Key), enabled =>
                            _viewModel.SetCategoryEnabled(child.Key, enabled));
                    row.Margin = new Thickness(28, 0, 0, 0);
                    ((Label)row.Children[1]).FontSize = 13;
                    return row;
                }))
                {
                    KindsFilters.Add(childRow);
                }
            }
        }
        finally
        {
            _buildingFilters = false;
        }
    }

    private Grid FilterRow(string title, string automationId, bool enabled, Action<bool> changed)
    {
        var checkBox = new CheckBox { IsChecked = enabled, AutomationId = automationId, WidthRequest = 32, HeightRequest = 44 };
        SemanticProperties.SetDescription(checkBox, title);
        checkBox.CheckedChanged += (_, e) =>
        {
            if (!_buildingFilters)
            {
                changed(e.Value);
            }
        };
        var row = new Grid();
        row.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Auto));
        row.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
        row.Add(checkBox);
        row.Add(new Label { Text = title, VerticalOptions = LayoutOptions.Center, FontSize = 15 }, 1);
        return row;
    }

    private void SyncCategoryChecks()
    {
        // Refresh the checkboxes to the committed selection — used when the
        // sheet reopens after a preset or parent/child cascading toggle.
        foreach (var row in KindsFilters.Children.OfType<Grid>())
        {
            if (row.Children[0] is not CheckBox check || check.AutomationId is not { } id)
            {
                continue;
            }
            check.IsChecked = id == "TanahpediaKindAll"
                ? _viewModel.AllSelected
                : _viewModel.IsCategoryEnabled(id["TanahpediaKind".Length..]);
        }
    }

    private void OnKindsTabClicked(object? sender, TappedEventArgs e)
    {
        SyncCategoryChecks();
        FilterSheetOverlay.IsVisible = true;
    }

    private async void OnSheetDismissed(object? sender, TappedEventArgs e) => await CloseFilterSheetAsync();

    private async Task CloseFilterSheetAsync()
    {
        var version = ++_sheetVersion;
        if (!FilterSheetOverlay.IsVisible)
        {
            return;
        }
        await FilterSheet.TranslateToAsync(0, FilterSheet.HeightRequest, 180, Easing.CubicIn);
        if (version == _sheetVersion)
        {
            FilterSheetOverlay.IsVisible = false;
            FilterSheet.TranslationY = 0;
        }
        // Category changes take effect on close (#2454's apply-on-close UX).
        UpdateStatus();
        ScheduleSearch(0);
    }

    private void CloseFilterSheetImmediately()
    {
        _sheetVersion++;
        FilterSheet.AbortAnimation("TranslateTo");
        FilterSheetOverlay.IsVisible = false;
        FilterSheet.TranslationY = 0;
    }

    private void OnSheetPanUpdated(object? sender, PanUpdatedEventArgs e)
    {
        if (e.StatusType == GestureStatus.Running)
        {
            FilterSheet.TranslationY = Math.Max(0, e.TotalY);
        }
        else if (e.StatusType is GestureStatus.Completed or GestureStatus.Canceled)
        {
            _ = FilterSheet.TranslationY > 70
                ? CloseFilterSheetAsync()
                : FilterSheet.TranslateToAsync(0, 0, 150, Easing.CubicOut);
        }
    }

    private void OnNavigationClicked(object? sender, EventArgs e) => Close();

    private void OnClearClicked(object? sender, EventArgs e)
    {
        SearchInput.Text = string.Empty;
        SearchInput.Focus();
    }

    private void OnSearchTextChanged(object? sender, TextChangedEventArgs e)
    {
        _viewModel.SearchPhrase = e.NewTextValue ?? string.Empty;
        UpdateStatus();
        ScheduleSearch();
    }

    private void OnSearchSubmitted(object? sender, EventArgs e)
    {
        ScheduleSearch(0);
        _ = HideKeyboardAsync();
    }

    private void OnResultSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is not TanahpediaSearchHit hit)
        {
            return;
        }
        ResultsList.SelectedItem = null;
        OnEntrySelected?.Invoke(hit.UniqueName);
    }

    private void ScheduleSearch(int delay = 500) => _ = RunSearchAsync(delay);

    private async Task RunSearchAsync(int delay)
    {
        _debounce?.Cancel();
        _debounce?.Dispose();
        _debounce = new CancellationTokenSource();
        var token = _debounce.Token;
        _viewModel.CancelSearch();
        try
        {
            await Task.Delay(delay, token);
            await _viewModel.SearchAsync(token);
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // Replaced queries and closing the panel intentionally cancel this search.
        }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — failure boundary: a failed search must not crash the overlay.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Tanahpedia search failed: {ex}");
        }
        UpdateStatus();
    }

    private void UpdateStatus()
    {
        KindsChipText.Text = _viewModel.CategorySummary;
        ClearButton.IsVisible = !string.IsNullOrEmpty(_viewModel.SearchPhrase);
        ErrorText.IsVisible = _viewModel.HasError;
        var emptyPhrase = string.IsNullOrWhiteSpace(_viewModel.SearchPhrase);
        SearchStatus.Text = _viewModel.IsLoading ? "מחפש..." :
            emptyPhrase ? string.Empty :
            _viewModel.NoneSelected ? "לא נבחרו קטגוריות" :
            _viewModel.Results.Count == 0 ? "לא נמצאו תוצאות" : $"{_viewModel.Results.Count} תוצאות";
        ResultsList.IsVisible = !emptyPhrase && _viewModel.HasResults;
        HintText.IsVisible = emptyPhrase;
    }

    private async Task HideKeyboardAsync()
    {
        try
        {
            await SearchInput.HideSoftInputAsync(CancellationToken.None);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — keyboard dismissal is best-effort and must not crash the panel.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Could not dismiss search keyboard: {ex}");
        }
        SearchInput.Unfocus();
    }
}
