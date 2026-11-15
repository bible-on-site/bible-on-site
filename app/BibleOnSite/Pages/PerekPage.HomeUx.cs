using BibleOnSite.Config;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // Reader controls and lifecycle belong to the other XAML/code-behind partials.
public partial class PerekPage
#pragma warning restore S2333
{
    private readonly ReaderChromeIdleState _homeUxControls = new();
    private IDispatcherTimer? _homeUxIdleTimer;
    private bool? _homeUxVisibleTarget;
    private bool _homeUxActive;
    private const string HomeUxChromeAnimation = "HomeUxChrome";
#if !ANDROID
    private double _homeUxTikkunOffset;
#endif

    private void ConfigureHomeUxPreview()
    {
        if (!HomeUxPreview.Enabled) { return; }
        HomePreviewButton.IsVisible = false;
        FanMenu.IsVisible = false;
        ReaderToolbar.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#F5F7FB"), Color.FromArgb("#111C2C"));
        NormalNavigationTitle.HeightRequest = 52;
        NormalNavigationTitle.FontSize = 22;
        NormalNavigationTitle.CornerRadius = 16;
        NormalNavigationTitle.SetAppThemeColor(BackgroundColorProperty, Color.FromArgb("#E4EAF4"), Color.FromArgb("#243C5D"));
        SemanticProperties.SetHint(NormalNavigationTitle, "בחירת ספר ופרק");
        ToolTipProperties.SetText(NormalNavigationTitle, "בחירת ספר ופרק");
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
#if ANDROID
        ReaderToolbar.Loaded += (_, _) =>
        {
            // RecyclerView children can otherwise paint above the nested
            // navigation capsule when the content extends under the toolbar.
            if (ReaderToolbar.Handler?.PlatformView is Android.Views.View nativeBar)
            {
                nativeBar.Elevation = 8 * (nativeBar.Resources?.DisplayMetrics?.Density ?? 1);
            }
        };
#endif
        ReadingProgressBar.TranslationY = -SharedTopBar.BarHeight;
        ArticlesCollection.Margin = new Thickness(0, SharedTopBar.BarHeight, 0, 0);
        PerekCarousel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PerekCarousel.IsVisible) && !PerekCarousel.IsVisible)
            {
                // Articles replace the scrolling surface, so they must not
                // inherit a toolbar hidden by the preceding text scroll.
                RevealHomeUxControls();
            }
        };
        FanMenu.Satellites.Remove(PrevPerekButton);
        FanMenu.Satellites.Remove(NextPerekButton);
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(_viewModel.Perek) or nameof(_viewModel.SelectedPasukNums))
            {
#if !ANDROID
                _homeUxTikkunOffset = 0;
#endif
                RevealHomeUxControls();
            }
        };
        ReaderMenuOverlay.SearchRequested += async (_, _) =>
            await ShellAppNavigator.Instance.GoToAsync(nameof(HomeSearchPage));
        Appearing += (_, _) =>
        {
            _homeUxActive = true;
            _homeUxControls.Reset();
            _homeUxIdleTimer?.Stop();
            ApplyHomeUxControls(true, false);
        };
        Disappearing += (_, _) =>
        {
            _homeUxActive = false;
            _homeUxIdleTimer?.Stop();
            this.AbortAnimation(HomeUxChromeAnimation);
        };
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

    private void ApplyHomeUxControls(bool visible, bool animate = true)
    {
        if (animate && _homeUxVisibleTarget == visible) { return; }
        _homeUxVisibleTarget = visible;
        this.AbortAnimation(HomeUxChromeAnimation);
        ReaderToolbar.InputTransparent = !visible;
        BottomBar.InputTransparent = !visible;
        AutomationProperties.SetExcludedWithChildren(BottomBar, !visible);
        var targetY = visible ? 0 : -SharedTopBar.BarHeight;
        var targetOpacity = visible ? 1d : 0d;
        if (!animate)
        {
            ReaderToolbar.TranslationY = targetY;
            BottomBar.Opacity = targetOpacity;
            return;
        }
        var startY = ReaderToolbar.TranslationY;
        var startOpacity = BottomBar.Opacity;
        new Animation(progress =>
        {
            ReaderToolbar.TranslationY = startY + (targetY - startY) * progress;
            BottomBar.Opacity = startOpacity + (targetOpacity - startOpacity) * progress;
        }).Commit(this, HomeUxChromeAnimation, 16, visible ? 160u : 240u, Easing.CubicOut);
    }

    private void UpdateHomeUxScroll(double delta)
    {
        if (!HomeUxPreview.Enabled) { return; }
        if (ExitFullScreenButton.IsVisible) { return; }
        if (!double.IsFinite(delta) || Math.Abs(delta) < 0.5) { return; }
        _homeUxControls.NoteScroll(Environment.TickCount64);
        ApplyHomeUxControls(true);
        StartHomeUxIdleTimer();
    }

    private bool KeepHomeUxControlsVisible => ReaderSurfaceState.IsActive(_viewModel.SelectedPasukNums.Count,
            _chapterRecitationSelection, _focusedPasuk != null, _recitationCursor.PlayingKey != null)
            || _chrome.IsShowingArticles || ChapterSearch.IsSearchOpen || ReaderMenuOverlay.IsVisible
            || PerushimPanel.IsOpen || PerekPickerPopup.IsVisible;

    private void OnHomeUxReadingDragChanged(bool dragging)
    {
        if (!HomeUxPreview.Enabled || ExitFullScreenButton.IsVisible) { return; }
        if (dragging) { _homeUxControls.DragStarted(Environment.TickCount64); }
        else { _homeUxControls.DragEnded(Environment.TickCount64); }
        ApplyHomeUxControls(true);
        StartHomeUxIdleTimer();
    }

    private void StartHomeUxIdleTimer()
    {
        if (!_homeUxActive || !_homeUxControls.HasInteracted) { return; }
        if (_homeUxIdleTimer is null)
        {
            _homeUxIdleTimer = Dispatcher.CreateTimer();
            _homeUxIdleTimer.Interval = TimeSpan.FromMilliseconds(100);
            _homeUxIdleTimer.Tick += (_, _) =>
            {
                var visible = _homeUxControls.Tick(Environment.TickCount64, KeepHomeUxControlsVisible);
                ApplyHomeUxControls(visible);
                if (!visible) { _homeUxIdleTimer.Stop(); }
            };
        }
        _homeUxIdleTimer.Start();
    }

    private void RevealHomeUxControls()
    {
        if (!HomeUxPreview.Enabled || ExitFullScreenButton.IsVisible) { return; }
        _homeUxControls.Reveal(Environment.TickCount64);
        ApplyHomeUxControls(true);
        StartHomeUxIdleTimer();
    }

    private async void OnHomePreviewClicked(object? sender, EventArgs e) =>
        await ShellAppNavigator.Instance.GoToAsync($"//{AppRoutes.Perek}");
}
