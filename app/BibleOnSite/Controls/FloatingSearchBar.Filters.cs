using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Controls;

#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class FloatingSearchBar
#pragma warning restore S2333
{
    private bool _kindsExplicit;
    private bool _booksExplicit;
    private bool _optionsExplicit;
    private int _sheetVersion;
    private readonly Dictionary<string, CheckBox> _filterChecks = new();

    public void HandleBack()
    {
        if (FilterSheetOverlay.IsVisible)
        {
            _ = CloseFilterSheetAsync();
        }
        else
        {
            Close();
        }
    }

    private void UpdateFilterSummaries()
    {
        var kinds = Enum.GetValues<SearchFilter>().Where(_viewModel.IsFilterEnabled).Select(filter => filter.GetHebrewName()).ToArray();
        KindsChipText.Text = SearchSelectionSummary.Describe(kinds, "מה לחפש", _kindsExplicit);
        var books = PerekDataService.Instance.Perakim?.Values.DistinctBy(perek => perek.SeferId)
            .Where(perek => _viewModel.IsSeferFilterEnabled(perek.SeferId)).OrderBy(perek => perek.SeferId)
            .Select(perek => (perek.SeferId, perek.SeferName)).ToArray() ?? [];
        BooksChipText.Text = SearchSelectionSummary.Books(books, _booksExplicit);
        OptionsChipText.Text = _optionsExplicit ? $"{_viewModel.ResultsLimit} תוצאות" : "הגדרות נוספות";
        SortLabel.Text = _viewModel.Sorting == SearchSort.Relevance ? "הכי רלוונטי" : "לפי סדר הדורות";
        ClearAllChip.IsVisible = _kindsExplicit || _booksExplicit || _optionsExplicit || _viewModel.Sorting != SearchSort.Relevance;
    }

    private async void OnKindsTabClicked(object? sender, EventArgs e) => await ShowFilterSheetAsync(KindsFilters, "מה לחפש");
    private async void OnBooksTabClicked(object? sender, EventArgs e) => await ShowFilterSheetAsync(BookFilters, "היכן לחפש");
    private async void OnOptionsTabClicked(object? sender, EventArgs e) => await ShowFilterSheetAsync(MoreFilters, "הגדרות נוספות");
    private async void OnSortClicked(object? sender, EventArgs e) => await ShowFilterSheetAsync(SortFilters, "סדר התוצאות");

    private async Task ShowFilterSheetAsync(View panel, string title)
    {
        var version = ++_sheetVersion;
        await HideKeyboardAsync();
        if (!IsSearchOpen || version != _sheetVersion)
        {
            return;
        }
        KindsFilters.IsVisible = panel == KindsFilters;
        BookFilters.IsVisible = panel == BookFilters;
        MoreFilters.IsVisible = panel == MoreFilters;
        SortFilters.IsVisible = panel == SortFilters;
        SheetTitle.Text = title;
        FilterSheetOverlay.IsVisible = true;
        ResizeFilterSheet();
        FilterSheet.TranslationY = FilterSheet.HeightRequest;
        await FilterSheet.TranslateToAsync(0, 0, 220, Easing.CubicOut);
    }

    private void ResizeFilterSheet()
    {
        if (SearchPanel.Height > 0)
        {
            FilterSheet.HeightRequest = Math.Min(SearchPanel.Height, Math.Clamp(SearchPanel.Height * 0.72, 260, 520));
        }
    }

    private async void OnSheetDismissed(object? sender, EventArgs e) => await CloseFilterSheetAsync();

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
            if (FilterSheet.TranslationY > 70)
            {
                _ = CloseFilterSheetAsync();
            }
            else
            {
                _ = FilterSheet.TranslateToAsync(0, 0, 150, Easing.CubicOut);
            }
        }
    }

    private async void OnSortChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (_buildingFilters || !e.Value || sender is not RadioButton radio ||
            !Enum.TryParse<SearchSort>(radio.Value?.ToString(), out var sorting) || _viewModel.Sorting == sorting)
        {
            return;
        }
        _viewModel.Sorting = sorting;
        UpdateFilterSummaries();
        ScheduleSearch(0);
        await CloseFilterSheetAsync();
    }

    private void OnClearAllClicked(object? sender, EventArgs e)
    {
        _buildingFilters = true;
        try
        {
            foreach (var filter in Enum.GetValues<SearchFilter>())
            {
                _viewModel.SetFilterEnabled(filter, true);
            }
            foreach (var group in Enumerable.Range(0, 3))
            {
                _viewModel.SetSeferGroupFilterEnabled(group, true);
            }
            foreach (var checkBox in _filterChecks.Values)
            {
                checkBox.IsChecked = true;
            }
            _viewModel.ResultsLimit = 10;
            LimitPicker.SelectedItem = 10;
            _viewModel.Sorting = SearchSort.Relevance;
            SortRelevanceRadio.IsChecked = true;
            _kindsExplicit = _booksExplicit = _optionsExplicit = false;
        }
        finally
        {
            _buildingFilters = false;
        }
        UpdateStatus();
        ScheduleSearch(0);
    }
}
