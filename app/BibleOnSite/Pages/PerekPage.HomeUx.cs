using BibleOnSite.Config;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

public partial class PerekPage
{
    private readonly ReaderHeaderScrollState _homeUxHeader = new();
    private double _homeUxTikkunOffset;

    private void ConfigureHomeUxPreview()
    {
        if (!HomeUxPreview.Enabled) { return; }
        HomePreviewButton.IsVisible = true;
        // Keep the RecyclerView viewport stable. Collapsing an Auto row resizes
        // it during a scroll and Android can repeatedly re-anchor the list.
        // The permanent extra strip under the viewport is covered by bottom
        // chrome; translating this surface fills the hidden toolbar band.
        MainGrid.RowDefinitions[0].Height = SharedTopBar.BarHeight;
        PerekCarousel.Margin = new Thickness(0, 0, 0, -SharedTopBar.BarHeight);
        ReaderToolbar.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(ReaderToolbar.IsVisible))
            {
                var offset = ReaderToolbar.IsVisible ? 0 : -SharedTopBar.BarHeight;
                PerekCarousel.TranslationY = offset;
                ReadingProgressBar.TranslationY = offset;
            }
        };
        FanMenu.Satellites.Remove(PrevPerekButton);
        FanMenu.Satellites.Remove(NextPerekButton);
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(_viewModel.Perek) or nameof(_viewModel.SelectedPasukNums))
            {
                _homeUxHeader.Reset();
                _homeUxTikkunOffset = 0;
                ReaderToolbar.IsVisible = true;
            }
        };
    }

    private void UpdateHomeUxHeader(double delta)
    {
        if (!HomeUxPreview.Enabled) { return; }
        if (ExitFullScreenButton.IsVisible) { return; }
        var keepVisible = _viewModel.SelectedPasukNums.Count > 0 || ChapterSearch.IsSearchOpen
            || ReaderMenuOverlay.IsVisible;
        ReaderToolbar.IsVisible = _homeUxHeader.Update(delta, keepVisible);
    }

    private async void OnHomePreviewClicked(object? sender, EventArgs e) =>
        await ShellAppNavigator.Instance.GoToAsync($"//{AppRoutes.Perek}");
}
