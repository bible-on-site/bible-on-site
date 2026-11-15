using BibleOnSite.Config;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // Reader controls and lifecycle belong to the other XAML/code-behind partials.
public partial class PerekPage
#pragma warning restore S2333
{
    private readonly ReaderHeaderScrollState _homeUxHeader = new();
#if !ANDROID
    private double _homeUxTikkunOffset;
#endif

    private void ConfigureHomeUxPreview()
    {
        if (!HomeUxPreview.Enabled) { return; }
        HomePreviewButton.IsVisible = false;
        FanMenu.IsVisible = false;
        ReaderToolbar.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F2EFE6"), Color.FromArgb("#111C2C"));
        NormalNavigationTitle.HeightRequest = 52;
        NormalNavigationTitle.FontSize = 22;
        NormalNavigationTitle.CornerRadius = 16;
        ReaderMenuButton.WidthRequest = 52;
        ReaderMenuButton.HeightRequest = 52;
        ReaderMenuButton.CornerRadius = 16;
        ReaderMenuButton.FontSize = 24;
        ReaderMenuButton.Text = Fonts.FluentUI.options_24_regular;
        ReaderMenuButton.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#E4EAF4"), Color.FromArgb("#243C5D"));
        SemanticProperties.SetDescription(ReaderMenuButton, "כלי הקריאה");
        FinishSearchIntroduction();
        // The content occupies one permanent viewport. Only the OVERLAY bar
        // moves: neither scrolling nor header changes can remeasure the list.
        MainGrid.RowDefinitions[0].Height = SharedTopBar.BarHeight;
        MainGrid.IsClippedToBounds = true;
        ContentArea.Margin = new Thickness(0, -SharedTopBar.BarHeight, 0, 0);
        ReaderToolbar.ZIndex = 500;
        ReadingProgressBar.TranslationY = -SharedTopBar.BarHeight;
        ArticlesCollection.Margin = new Thickness(0, SharedTopBar.BarHeight, 0, 0);
        PerekCarousel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PerekCarousel.IsVisible) && !PerekCarousel.IsVisible)
            {
                // Articles replace the scrolling surface, so they must not
                // inherit a toolbar hidden by the preceding text scroll.
                RevealHomeUxHeader();
            }
        };
        FanMenu.Satellites.Remove(PrevPerekButton);
        FanMenu.Satellites.Remove(NextPerekButton);
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(_viewModel.Perek) or nameof(_viewModel.SelectedPasukNums))
            {
                _homeUxHeader.Reset();
#if !ANDROID
                _homeUxTikkunOffset = 0;
#endif
                ApplyHomeUxHeader(true);
            }
        };
        ReaderMenuOverlay.SearchRequested += async (_, _) =>
            await ShellAppNavigator.Instance.GoToAsync(nameof(HomeSearchPage));
        ReaderMenuOverlay.FullscreenRequested += (_, _) => _chrome.ToggleFullScreen();
    }

    private void ConfigureHomeUxReadingSurface(CollectionView? list)
    {
        if (!HomeUxPreview.Enabled || list?.Header is not null || list?.Parent is not Grid page) { return; }
        var heading = page.Children.OfType<Grid>().FirstOrDefault(child => Grid.GetRow(child) == 0);
        if (heading is null) { return; }
        page.Remove(heading);
        heading.Margin = new Thickness(0, SharedTopBar.BarHeight, 0, 0);
        heading.SetBinding(BindingContextProperty, new Binding(nameof(BindingContext), source: list));
        list.Header = heading;
        Grid.SetRow(list, 0);
        Grid.SetRowSpan(list, 2);
        // The alternate continuous-text surface needs the same initial inset.
        foreach (var flow in page.Children.OfType<ScrollView>())
        {
            if (flow.Content is { } content)
            {
                content.Margin = new Thickness(0, SharedTopBar.BarHeight, 0, 0);
            }
        }
    }

    private void ApplyHomeUxHeader(bool visible)
    {
        ReaderToolbar.TranslationY = visible ? 0 : -SharedTopBar.BarHeight;
        ReaderToolbar.InputTransparent = !visible;
    }

    private void UpdateHomeUxHeader(double delta)
    {
        if (!HomeUxPreview.Enabled) { return; }
        if (ExitFullScreenButton.IsVisible) { return; }
        var keepVisible = ReaderSurfaceState.IsActive(_viewModel.SelectedPasukNums.Count,
            _chapterRecitationSelection, _focusedPasuk != null, _recitationCursor.PlayingKey != null)
            || _chrome.IsShowingArticles || ChapterSearch.IsSearchOpen || ReaderMenuOverlay.IsVisible;
        ApplyHomeUxHeader(_homeUxHeader.Update(delta, keepVisible));
    }

    private void RevealHomeUxHeader()
    {
        if (!HomeUxPreview.Enabled || ExitFullScreenButton.IsVisible) { return; }
        _homeUxHeader.Reset();
        ApplyHomeUxHeader(true);
    }

    private async void OnHomePreviewClicked(object? sender, EventArgs e) =>
        await ShellAppNavigator.Instance.GoToAsync($"//{AppRoutes.Perek}");
}
