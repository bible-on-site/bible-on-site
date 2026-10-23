namespace BibleOnSite.Pages;

using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using Microsoft.Maui.Layouts;

/// <summary>
/// Reader page for פרשה על הפרק — weekly Torah parashot plus their
/// ordered Haftarah variants. Shares the על הפרק reader's full
/// interaction model (carousel, perushim panel, articles, circular
/// menu, search, reading modes, pasuk selection, fullscreen) through
/// the same controls and services; only the reading division differs —
/// units are stable parasha ids whose rows stay canonical pesukim.
/// </summary>
// Codacy: S2333 false positive — partial is required by the XAML code
// generator and by the sibling partial files.
#pragma warning disable S2333
public partial class ParashaPage : ContentPage, IQueryAttributable, IAnalyticsScreenName //NOSONAR
#pragma warning restore S2333
{
    private readonly ParashaViewModel _viewModel;
    private bool _isLoading;

    // Circular menu state
    private bool _isMenuOpen;

    // Articles view state
    private bool _isShowingArticles;

    // Guard: ignore CurrentItemChanged events fired by the CarouselView during
    // initial collection assignment — the ViewModel already holds the unit.
    private bool _carouselInitializing;

    // Tracks the carousel width so rotation/resize can be detected in SizeChanged.
    private double _carouselWidth;
    private bool _pendingCarouselResnap;

    // Unit requested via query attributes before the initial load finished.
    private int? _pendingUnitId;

    // Perek requested via query attributes; resolved to its containing
    // parasha only after the parasha service loads.
    private int? _pendingPerekId;

    /// <summary>
    /// Proxy for article selection highlight binding (avoids XC0045 when binding from Article template).
    /// </summary>
    public int? SelectedArticleId => _viewModel.SelectedArticleId;

    public ParashaPage()
    {
        InitializeComponent();
#if IOS
        ConfigureReaderSafeArea();
#endif
        _viewModel = new ParashaViewModel();
        BindingContext = _viewModel;
        FinishSetup();
    }

    public ParashaPage(ParashaViewModel viewModel)
    {
        InitializeComponent();
#if IOS
        ConfigureReaderSafeArea();
#endif
        _viewModel = viewModel;
        BindingContext = _viewModel;
        FinishSetup();
    }

    private void FinishSetup()
    {
        ForwardSelectedArticleIdChanged();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupCircularMenuLayout();
        SetupExitButtonDragHandler();
        SetupUnitPickerEvents();
        SubscribePerushimSearch();
        InitializeSearchHeader();
#if ANDROID || IOS
        if (OperatingSystem.IsAndroid() || OperatingSystem.IsIOS())
        {
            var statusBar = new CommunityToolkit.Maui.Behaviors.StatusBarBehavior
            {
                ApplyOn = CommunityToolkit.Maui.Behaviors.StatusBarApplyOn.OnPageNavigatedTo
            };
            statusBar.SetBinding(CommunityToolkit.Maui.Behaviors.StatusBarBehavior.StatusBarColorProperty,
                new Binding(nameof(BackgroundColor), source: ReaderToolbar));
            statusBar.SetAppTheme(CommunityToolkit.Maui.Behaviors.StatusBarBehavior.StatusBarStyleProperty,
                CommunityToolkit.Maui.Core.StatusBarStyle.DarkContent, CommunityToolkit.Maui.Core.StatusBarStyle.LightContent);
            Behaviors.Add(statusBar);
        }
#endif
        ParashaCarousel.SizeChanged += OnCarouselSizeChanged;
        ChapterSearch.SetSource(_viewModel.Source);
        ChapterSearch.SearchOpenChanged += OnChapterSearchOpenChanged;
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(ParashaViewModel.Source))
            {
                ChapterSearch.SetSource(_viewModel.Source);
            }
            if (e.PropertyName == nameof(ParashaViewModel.IsShnayimMikraEnabled) ||
                e.PropertyName == nameof(ParashaViewModel.FontFactor))
            {
                // A display-mode change rebuilds the loaded rows — the same
                // contract the perek reader's ItemsSource converter applies.
                RebuildLoadedRows();
            }
        };
    }

    /// <summary>Fire-and-forget row rebuild — the discard keeps it off the
    /// PropertyChanged path while still routing errors to the async context.</summary>
    private void RebuildLoadedRows() => _ = _viewModel.RebuildLoadedRowsAsync();

    /// <summary>
    /// Wires the unit picker's confirm event in code (rather than XAML event
    /// wiring) so the subscription is explicit beside the other setup calls.
    /// </summary>
    private void SetupUnitPickerEvents()
    {
        ParashaUnitPickerPopup.UnitSelected += async (_, unitId) =>
            await OnUnitPickerSelectedAsync(unitId);
    }

    /// <summary>
    /// Query attributes for deep navigation: <c>?unitId=42</c> (or
    /// <c>?unit=42</c>) opens a parasha by its stable id;
    /// <c>?perekId=5</c> opens the parasha containing that perek's first
    /// pasuk; <c>?searchResult=…</c> lands a search hit inside the reader.
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("searchResult", out var value) && value is SearchResult result)
        {
            _searchReaderResult = result;
        }
        if (query.TryGetValue("unitId", out var unitValue))
        {
            _pendingUnitId = ParsePositiveInt(unitValue);
        }
        else if (query.TryGetValue("unit", out var unitAlias))
        {
            _pendingUnitId = ParsePositiveInt(unitAlias);
        }
        else if (query.TryGetValue("perekId", out var perekValue))
        {
            _pendingPerekId = ParsePositiveInt(perekValue);
        }
    }

    private static int? ParsePositiveInt(object value) => value switch
    {
        int i when i > 0 => i,
        string s when int.TryParse(s, out var parsed) && parsed > 0 => parsed,
        _ => null
    };

    /// <summary>
    /// Subscribes to ViewModel.NavigationRequested so that programmatic
    /// navigation (prev/next/picker) jumps the CarouselView instantly via
    /// ScrollTo(animate:false) instead of animating through every
    /// intermediate position (which would cascade OnCarouselItemChanged).
    /// </summary>
    private void SetupCarouselNavigation()
    {
        _viewModel.NavigationRequested += (_, index) => OnViewModelNavigationRequested(index);
    }

    /// <summary>Jumps the carousel to a programmatically requested unit index.</summary>
    private void OnViewModelNavigationRequested(int index)
    {
        ResetRecitationSession();
        // Guard: suppress OnCarouselItemChanged while we reposition
        _carouselInitializing = true;
        ParashaCarousel.ScrollTo(index, animate: false);
        // Do not push CarouselPosition back into the two-way Position
        // binding here — it queues a second (animated) scroll that can
        // overshoot the target and land on the following unit.
        _carouselInitializing = false;

        ClearAllSelections();
        SetAnalyticsScreenForUnit();
        if (_isMenuOpen)
        {
            RefreshNavButtonVisuals();
        }

        _ = UpdateArticlesCountAsync();
        _ = _viewModel.PreloadAdjacentRowsAsync(_viewModel.UnitId);
        if (_isShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
    }

    /// <summary>
    /// Re-snaps the carousel when its measured width changes (rotation, fold,
    /// window resize) — otherwise the items keep the old width and the swipe
    /// lands mid-item.
    /// </summary>
    private void OnCarouselSizeChanged(object? sender, EventArgs e)
    {
        var width = ParashaCarousel.Width;
        if (width <= 0)
        {
            return;
        }
        if (Math.Abs(width - _carouselWidth) < 0.5)
        {
            return;
        }
        var isFirstMeasure = _carouselWidth <= 0;
        _carouselWidth = width;
        if (isFirstMeasure || _carouselInitializing)
        {
            return;
        }
        if (_isLoading)
        {
            // Rotation during the initial load: retry the re-snap once the
            // load completes instead of leaving stale item widths behind.
            _pendingCarouselResnap = true;
            return;
        }

        Dispatcher.Dispatch(ResnapCarousel);
    }

    /// <summary>
    /// Re-snaps the carousel to the current position after its width changed,
    /// restoring a single full-width item.
    /// </summary>
    private void ResnapCarousel()
    {
#if IOS
        var collectionView = ParashaCarousel.Handler?.PlatformView switch
        {
            UIKit.UICollectionView cv => cv,
            UIKit.UIView view => FindDescendantCollectionView(view),
            _ => null,
        };
        collectionView?.CollectionViewLayout.InvalidateLayout();
#elif ANDROID
        if (ParashaCarousel.Handler?.PlatformView is AndroidX.RecyclerView.Widget.RecyclerView recyclerView)
        {
            recyclerView.Post(recyclerView.RequestLayout);
        }
#endif
        ParashaCarousel.InvalidateMeasure();
        _carouselInitializing = true;
        ParashaCarousel.ScrollTo(_viewModel.CarouselPosition, animate: false);
        _carouselInitializing = false;
    }

#if IOS || MACCATALYST
    private static UIKit.UICollectionView? FindDescendantCollectionView(UIKit.UIView view)
    {
        foreach (var subview in view.Subviews)
        {
            if (subview is UIKit.UICollectionView collectionView)
            {
                return collectionView;
            }
            var found = FindDescendantCollectionView(subview);
            if (found != null)
            {
                return found;
            }
        }
        return null;
    }
#endif

    /// <summary>
    /// Populates page-level DynamicResource entries for perush font sizes and
    /// keeps them in sync when the user changes the font-factor preference.
    /// </summary>
    private void SetupFontSizeResources()
    {
        var prefs = PreferencesService.Instance;
        UpdateFontSizeResources(prefs);
        prefs.PreferencesChanged += (_, _) =>
            MainThread.BeginInvokeOnMainThread(() => UpdateFontSizeResources(prefs));
    }

    private void UpdateFontSizeResources(PreferencesService prefs)
    {
        var pasukFactor = prefs.PasukFontFactor;
        var perushFactor = prefs.PerushFontFactor;
        Resources["PasukFontSize"] = pasukFactor * 18;
        Resources["PasukNumFontSize"] = pasukFactor * 16;
        Resources["PerushNameFontSize"] = perushFactor * 14;
        Resources["PerushContentFontSize"] = perushFactor * 18;
    }

    private void ForwardSelectedArticleIdChanged()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(ParashaViewModel.SelectedArticleId))
            {
                OnPropertyChanged(nameof(SelectedArticleId));
            }
            // When the unit changes via prev/next, refresh articles and nav buttons
            if (e.PropertyName == nameof(ParashaViewModel.Unit) || e.PropertyName == "Unit")
            {
                MainThread.BeginInvokeOnMainThread(OnUnitChangedOnMainThread);
            }
        };
    }

    /// <summary>Refreshes articles and nav-button visuals after a unit change (main thread).</summary>
    private void OnUnitChangedOnMainThread()
    {
        ClearAllSelections();
        _ = UpdateArticlesCountAsync();
        if (_isShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
        // Force visual refresh of prev/next buttons (workaround for MAUI not updating disabled visual)
        RefreshNavButtonVisuals();
    }

    /// <summary>
    /// Forces the prev/next buttons to update their visual state.
    /// Workaround for MAUI bug where button disabled visual doesn't refresh in AbsoluteLayout.
    /// </summary>
    private void RefreshNavButtonVisuals()
    {
        // Only update if menu is open (buttons visible)
        if (!_isMenuOpen)
        {
            return;
        }

        var canPrev = _viewModel.CanGoToPreviousUnit;
        var canNext = _viewModel.CanGoToNextUnit;

        PrevUnitButton.IsEnabled = canPrev;
        PrevUnitButton.Opacity = canPrev ? 1.0 : 0.4;

        NextUnitButton.IsEnabled = canNext;
        NextUnitButton.Opacity = canNext ? 1.0 : 0.4;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
#if ANDROID
        RegisterReaderBack();
#endif
#if WINDOWS
        RegisterReaderKeyboardBack();
#endif
        SubscribeRecitation();
#if IOS
        // Native history must be ready before asynchronous reader positioning.
        ConfigureIosReaderHistory();
#endif
        await InitializeRecitationAsync();
#if ANDROID
        MainActivity.TouchStarted += OnTouchStarted;
        MainActivity.SubscribeTouchDispatched(OnTouchDispatched);
        MainActivity.TouchMoved += OnTouchMoved;
        MainActivity.TouchReleased += OnTouchReleased;
#endif
#if IOS
        ApplyBottomBarSafeArea();
        SizeChanged -= OnPageSizeChanged;
        SizeChanged += OnPageSizeChanged;
#endif
        if (_viewModel.Unit == null && !_isLoading)
        {
            _isLoading = true;
            try
            {
                await LoadInitialUnitAsync();
            }
            catch (Exception ex) //NOSONAR — failure boundary: a failed parasha load lands on the retryable error panel instead of crashing the reader.
            {
                Console.Error.WriteLine($"Failed to load parasha unit: {ex}");
                if (_viewModel.Unit == null)
                {
                    ShowParashaLoadError(ex);
                }
                else
                {
                    CarouselLoadingOverlay.IsVisible = false;
                }
            }
            finally
            {
                _isLoading = false;
                if (_pendingCarouselResnap)
                {
                    _pendingCarouselResnap = false;
                    Dispatcher.Dispatch(ResnapCarousel);
                }
            }
        }
        else if (_viewModel.UnitId > 0 && !_isLoading)
        {
            // An already-running reader may still get a query (e.g. a picker or
            // search deep link): honor it like a fresh load.
            if (_pendingUnitId is int pendingUnit && pendingUnit != _viewModel.UnitId)
            {
                _pendingUnitId = null;
                await _viewModel.NavigateToUnitAsync(pendingUnit);
            }
            else if (_pendingPerekId is int pendingPerek)
            {
                _pendingPerekId = null;
                var unitId = await _viewModel.GetUnitIdForPerekAsync(pendingPerek);
                if (unitId is int target && target != _viewModel.UnitId)
                {
                    await _viewModel.NavigateToUnitAsync(target);
                }
            }
            else
            {
                _pendingUnitId = null;
                _pendingPerekId = null;
            }
            // Perushim may have been installed (downloaded in Preferences) or cleared by the OS
            // since this page last appeared. Re-check and reload so they show without an app restart.
            await RefreshPerushimIfAvailabilityChangedAsync();
            StartSearchIntroduction();
        }
#if IOS
        Dispatcher.Dispatch(ConfigureIosReaderHistory);
#endif
    }

    /// <summary>
    /// Reloads perushim for the current unit when notes-availability changed since the last load
    /// (e.g. the user downloaded the package in Preferences and returned to this page).
    /// </summary>
    private async Task RefreshPerushimIfAvailabilityChangedAsync()
    {
        try
        {
            await PerushimNotesService.Instance.InitializeAsync();
            if (PerushimNotesService.Instance.IsAvailable != _viewModel.PerushimNotesAvailable &&
                _viewModel.Unit is { } unit)
            {
                await _viewModel.LoadPerushimAsync(unit);
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: on-appearing refresh is best-effort
        catch (Exception ex) //NOSONAR — on-appearing refresh is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Refresh perushim on appearing failed: {ex}");
        }
    }

    private void OnReaderListLoaded(object? sender, EventArgs e)
    {
#if IOS
        // Newly realized verse lists must yield the edge gesture to history.
        ConfigureIosReaderHistory();
#endif
    }

    protected override void OnDisappearing()
    {
        FinishSearchIntroduction();
#if ANDROID
        UnregisterReaderBack();
#endif
#if WINDOWS
        UnregisterReaderKeyboardBack();
#endif
        if (!_preserveSearchOnDisappear)
        {
            ChapterSearch.Close();
        }
        ResetRecitationSession();
        PreferencesService.Instance.PreferencesChanged -= OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed -= OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested -= OnPlaybackStopRequested;
#if ANDROID
        MainActivity.TouchStarted -= OnTouchStarted;
        MainActivity.UnsubscribeTouchDispatched(OnTouchDispatched);
        MainActivity.TouchMoved -= OnTouchMoved;
        MainActivity.TouchReleased -= OnTouchReleased;
        _swipe.Cancel();
        LongPressBehavior.CancelAllPending();
#endif
        base.OnDisappearing();
    }

    /// <summary>
    /// Runs the full first-load sequence for this reader: resolve the parasha
    /// to open, wait out the load, snap the carousel, then apply a pending
    /// search-result landing. Throws whatever the load throws — the caller
    /// turns that into the retryable error overlay.
    /// </summary>
    private async Task LoadInitialUnitAsync()
    {
        ShowCarouselLoading();

        var unitId = _pendingUnitId;
        if (unitId == null && _pendingPerekId is int perekId)
        {
            unitId = await _viewModel.GetUnitIdForPerekAsync(perekId);
        }
        if (unitId == null && _searchReaderResult is { } searchResult)
        {
            unitId = await UnitIdForSearchResultAsync(searchResult);
        }
        _pendingUnitId = null;
        _pendingPerekId = null;

        unitId ??= await _viewModel.GetInitialUnitIdAsync();

        // Guard: ignore OnCarouselItemChanged during initial load.
        _carouselInitializing = true;
        try
        {
            await _viewModel.LoadByUnitIdAsync(unitId.Value);

            // CarouselView resets Position to 0 when ItemsSource changes.
            // Force it to the correct position without animation.
            var targetPos = UnitIndexOf(_viewModel.UnitId);
            if (targetPos >= 0)
            {
                ParashaCarousel.ScrollTo(targetPos, animate: false);
                _viewModel.CarouselPosition = targetPos;
            }
        }
        finally
        {
            _carouselInitializing = false;
        }

        // Hide loading overlay — carousel is ready
        CarouselLoadingOverlay.IsVisible = false;

        // A search-result link lands inside the selected reading instance.
        await ApplySearchReaderLocationAsync();
        StartSearchIntroduction();
        SetAnalyticsScreenForUnit();

        // Update articles count badge
        await UpdateArticlesCountAsync();

        // Preload rows for adjacent units so the next swipe is instant
        _ = _viewModel.PreloadAdjacentRowsAsync(_viewModel.UnitId);
    }

    /// <summary>Swaps the loading overlay to its spinner state (initial load and retry).</summary>
    private void ShowCarouselLoading()
    {
        CarouselLoadErrorPanel.IsVisible = false;
        CarouselLoadingIndicator.IsVisible = true;
        CarouselLoadingOverlay.IsVisible = true;
    }

    /// <summary>Swaps the loading overlay to its retryable error state.</summary>
    private void ShowParashaLoadError(Exception ex)
    {
        CarouselLoadingIndicator.IsVisible = false;
        CarouselLoadErrorDetail.Text = ex.Message;
        CarouselLoadErrorPanel.IsVisible = true;
        CarouselLoadingOverlay.IsVisible = true;
    }

    /// <summary>Retry button on the load-failure overlay — re-runs the full fresh load.</summary>
    private async void OnParashaLoadRetryClicked(object? sender, EventArgs e)
    {
        if (_isLoading)
        {
            return;
        }

        _isLoading = true;
        try
        {
            await LoadInitialUnitAsync();
        }
        catch (Exception ex) //NOSONAR — failure boundary: a failed retry must land back on the retryable error panel, not crash the reader.
        {
            Console.Error.WriteLine($"Parasha load retry failed: {ex}");
            if (_viewModel.Unit == null)
            {
                ShowParashaLoadError(ex);
            }
            else
            {
                CarouselLoadingOverlay.IsVisible = false;
            }
        }
        finally
        {
            _isLoading = false;
        }
    }

    /// <summary>The unit's index inside the carousel collection (-1 when missing).</summary>
    private int UnitIndexOf(int unitId)
    {
        for (var i = 0; i < _viewModel.CarouselUnits.Count; i++)
        {
            if (_viewModel.CarouselUnits[i].UnitId == unitId)
            {
                return i;
            }
        }
        return -1;
    }

    /// <summary>
    /// Carousel swipe: lazy-load the incoming unit's clipped rows, then update
    /// state and kick off perushim/articles/preload in the background — never
    /// block the next swipe.
    /// </summary>
    private async void OnCarouselItemChanged(object? sender, CurrentItemChangedEventArgs e)
    {
        if (_carouselInitializing)
        {
            return;
        }

        if (e.CurrentItem is not ParashaUnit unit || unit.UnitId <= 0 || unit.UnitId == _viewModel.UnitId)
        {
            return;
        }

        // Lazy-load rows if not yet loaded
        if (unit.Rows.Count == 0)
        {
            await _viewModel.EnsureRowsLoadedAsync(unit);
        }

        // Synchronous state update — fast, no guard needed.
        _viewModel.Unit = unit;

        ClearAllSelections();
        SetAnalyticsScreenForUnit();

        // Refresh nav button visuals if menu is open (synchronous)
        if (_isMenuOpen)
        {
            RefreshNavButtonVisuals();
        }

        // Fire async tasks in the background — never block the next swipe
        _ = UpdateArticlesCountAsync();
        _ = _viewModel.LoadPerushimAsync(unit);
        _ = _viewModel.PreloadAdjacentRowsAsync(unit.UnitId);
        if (_isShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
    }

    #region Circular Menu

    private void SetupCircularMenuLayout()
    {
        FloatingMenuContainer.SizeChanged += (_, _) => LayoutCircularMenu();
    }

    /// <summary>
    /// Positions the toggle and the three satellite buttons on the elliptical
    /// fan computed by <see cref="BibleOnSite.Helpers.FanMenuGeometry"/>.
    /// </summary>
    private void LayoutCircularMenu()
    {
        var width = FloatingMenuContainer.Width - FloatingMenuContainer.Padding.HorizontalThickness;
        var height = FloatingMenuContainer.Height - FloatingMenuContainer.Padding.VerticalThickness;
        if (width <= 0 || height <= 0)
        {
            return;
        }

        var satellites = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };
        var layout = Helpers.FanMenuGeometry.Compute(width, height, satellites.Length);
        ApplyMenuBounds(CircularMenuButton, layout.Toggle);
        for (var i = 0; i < satellites.Length && i < layout.Items.Count; i++)
        {
            ApplyMenuBounds(satellites[i], layout.Items[i]);
        }
    }

    private static void ApplyMenuBounds(View view, Rect bounds)
    {
        AbsoluteLayout.SetLayoutFlags(view, AbsoluteLayoutFlags.None);
        AbsoluteLayout.SetLayoutBounds(view, bounds);
    }

    /// <summary>Toggles the circular menu open/closed state with animation.</summary>
    private async void OnCircularMenuClicked(object? sender, EventArgs e)
    {
        _isMenuOpen = !_isMenuOpen;

        if (_isMenuOpen)
        {
            await OpenCircularMenuAsync();
        }
        else
        {
            await CloseCircularMenuAsync();
        }
    }

    /// <summary>Opens the circular menu with animated expansion.</summary>
    private async Task OpenCircularMenuAsync()
    {
        var buttons = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };

        // Set prev/next enabled state before animating
        PrevUnitButton.IsEnabled = _viewModel.CanGoToPreviousUnit;
        NextUnitButton.IsEnabled = _viewModel.CanGoToNextUnit;

        foreach (var button in buttons)
        {
            button.InputTransparent = false;
            button.Opacity = 0;
        }

        CircularMenuScrim.IsVisible = true;

        // Change FAB icon to X
        CircularMenuButton.Text = Fonts.FluentUI.dismiss_24_regular;
        CircularMenuButton.BackgroundColor = Colors.Red;

        var animations = new List<Task>
        {
            CircularMenuButton.RotateToAsync(180, 250, Easing.SpringOut),
            CircularMenuScrim.FadeToAsync(1, 200)
        };

        foreach (var button in buttons)
        {
            var targetOpacity = button.IsEnabled ? 1.0 : 0.4;
            animations.Add(button.FadeToAsync(targetOpacity, 200));
        }

        await Task.WhenAll(animations);
    }

    /// <summary>Closes the circular menu with animated contraction.</summary>
    private async Task CloseCircularMenuAsync()
    {
        var buttons = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };

        CircularMenuButton.Text = Fonts.FluentUI.navigation_24_regular;
        CircularMenuButton.BackgroundColor = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];

        var animations = new List<Task>
        {
            CircularMenuButton.RotateToAsync(0, 200, Easing.SpringOut),
            CircularMenuScrim.FadeToAsync(0, 150)
        };

        foreach (var button in buttons)
        {
            animations.Add(button.FadeToAsync(0, 150));
        }

        await Task.WhenAll(animations);

        // A reopen during the close animation wins — leave scrim and satellites alone
        if (_isMenuOpen)
        {
            return;
        }

        CircularMenuScrim.IsVisible = false;

        foreach (var button in buttons)
        {
            button.InputTransparent = true;
        }
    }

    /// <summary>Handles tap on the scrim — dismisses the open menu.</summary>
    private async void OnOverlayTapped(object? sender, TappedEventArgs e)
    {
        if (_isMenuOpen)
        {
            _isMenuOpen = false;
            await CloseCircularMenuAsync();
        }
    }

    /// <summary>Handles tap on a satellite menu item — the menu closes.</summary>
    private async void OnMenuItemClicked(object? sender, EventArgs e)
    {
        // Command-based buttons already fired their command; just close.
        _isMenuOpen = false;
        await CloseCircularMenuAsync();
    }

    #endregion

    #region Navigation & Picker

    private void OnReaderMenuClicked(object? sender, EventArgs e) =>
        Shell.Current.FlyoutIsPresented = true;

    private void OnUnitPickerClicked(object? sender, EventArgs e)
    {
        ParashaUnitPickerPopup.Show(_viewModel.UnitId);
    }

    /// <summary>Handles unit selection from the picker popup.</summary>
    private async Task OnUnitPickerSelectedAsync(int unitId)
    {
        if (unitId > 0 && unitId != _viewModel.UnitId)
        {
            await _viewModel.NavigateToUnitAsync(unitId);
        }
    }

    /// <summary>⋮ reader options menu — toggles the dropdown overlay.</summary>
    private void OnReaderMenuButtonClicked(object? sender, EventArgs e)
    {
        ReaderMenuOverlay.IsVisible = !ReaderMenuOverlay.IsVisible;
    }

    private void OnReaderMenuDismissed(object? sender, TappedEventArgs e)
    {
        ReaderMenuOverlay.IsVisible = false;
    }

    private async void OnShnayimMikraTapped(object? sender, TappedEventArgs e)
    {
        _viewModel.IsShnayimMikraEnabled = !_viewModel.IsShnayimMikraEnabled;
        ReaderMenuOverlay.IsVisible = false;
        await Task.CompletedTask;
    }

    private async void OnTikkunKorimTapped(object? sender, TappedEventArgs e)
    {
        _viewModel.IsTikkunKorimEnabled = !_viewModel.IsTikkunKorimEnabled;
        ReaderMenuOverlay.IsVisible = false;
        await Task.CompletedTask;
    }

    private async void OnDivineNameMaskingTapped(object? sender, TappedEventArgs e)
    {
        _viewModel.DivineNameMaskingEnabled = !_viewModel.DivineNameMaskingEnabled;
        ReaderMenuOverlay.IsVisible = false;
        await Task.CompletedTask;
    }

    /// <summary>Tapping the תיקון קוראים flow toggles niqqud+taamim.</summary>
    private void OnTikkunTextTapped(object? sender, TappedEventArgs e)
    {
        if (ChapterSearch.IsSearchOpen)
        {
            return;
        }
        _viewModel.TikkunMarksHidden = !_viewModel.TikkunMarksHidden;
    }

    /// <summary>Android-native tap on the תיקון flow (MAUI taps fail inside CarouselView templates).</summary>
    private void OnTikkunNativeTapped(object? sender, EventArgs e)
    {
        if (ChapterSearch.IsSearchOpen)
        {
            return;
        }
        _viewModel.TikkunMarksHidden = !_viewModel.TikkunMarksHidden;
    }

    #endregion

    #region Articles

    /// <summary>Updates the articles count badge for the current unit.</summary>
    private async Task UpdateArticlesCountAsync()
    {
        try
        {
            var unit = _viewModel.Unit;
            if (unit == null)
            {
                ArticlesBadge.IsVisible = false;
                return;
            }
            await _viewModel.LoadArticlesAsync(unit);
            ArticlesBadge.IsVisible = _viewModel.ArticlesCount > 0;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-count badge degrades to hidden
        catch (Exception ex) //NOSONAR — articles-count badge degrades to hidden.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error fetching articles count: {ex.Message}");
            ArticlesBadge.IsVisible = false;
        }
    }

    /// <summary>Handles articles button click - shows the unit's articles.</summary>
    private async void OnArticlesButtonClicked(object? sender, EventArgs e)
    {
        try
        {
            if (_isShowingArticles)
            {
                return;
            }

            _isShowingArticles = true;
            await ShowUnitArticlesAsync();

            ParashaCarousel.IsVisible = false;
            ArticlesCollection.IsVisible = true;

            ArticlesButton.TextColor = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#BB86FC")
                : Color.FromArgb("#512BD4");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Articles] Error in OnArticlesButtonClicked: {ex}");
        }
    }

    /// <summary>Returns to the unit text view.</summary>
    private void ShowUnitView()
    {
        _isShowingArticles = false;
        _viewModel.SelectedArticleId = null;

        ArticlesCollection.IsVisible = false;
        ParashaCarousel.IsVisible = true;

        ArticlesButton.TextColor = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark
            ? Color.FromArgb("#9CA3AF")
            : Color.FromArgb("#6B7280");
    }

    /// <summary>Pushes the unit's loaded articles into the articles grid.</summary>
    private async Task ShowUnitArticlesAsync()
    {
        var unit = _viewModel.Unit;
        if (unit == null)
        {
            return;
        }
        await _viewModel.LoadArticlesAsync(unit);
        ArticlesCollection.ItemsSource = _viewModel.Articles;
    }

    /// <summary>Handles article selection - navigates to article detail.</summary>
    private async void OnArticleSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is Article article)
        {
            _viewModel.SelectedArticleId = article.Id;
            ArticlesCollection.SelectedItem = null;

            try
            {
                await Shell.Current.GoToAsync($"articleDetail?articleId={article.Id}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error navigating to article: {ex.Message}");
            }
        }
    }

    #endregion

    #region Full Screen

    /// <summary>Text button — returns to the unit view from articles, else scrolls to top.</summary>
    private void OnTextButtonClicked(object? sender, EventArgs e)
    {
        if (_isShowingArticles)
        {
            ShowUnitView();
        }
        else
        {
            ParashaCarousel.ScrollTo(_viewModel.CarouselPosition, position: ScrollToPosition.Start, animate: false);
        }
    }

    /// <summary>Enters full screen mode - hides top and bottom bars, shows exit button.</summary>
    private void OnFullScreenClicked(object? sender, EventArgs e)
    {
        // Close circular menu if open
        if (_isMenuOpen)
        {
            _isMenuOpen = false;
            var buttons = new[] { PrevUnitButton, UnitPickerButton, NextUnitButton };
            foreach (var b in buttons)
            {
                b.Opacity = 0;
                b.InputTransparent = true;
            }
            CircularMenuButton.Text = Fonts.FluentUI.navigation_24_regular;
            CircularMenuButton.BackgroundColor = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];
            CircularMenuButton.Rotation = 0;
            CircularMenuScrim.Opacity = 0;
            CircularMenuScrim.IsVisible = false;
        }

        ReaderToolbar.IsVisible = false;
        BottomBar.IsVisible = false;
        FloatingMenuContainer.IsVisible = false;
        ExitFullScreenButton.IsVisible = true;
    }

    /// <summary>Exits full screen mode - restores navigation and bottom bar.</summary>
    private void ExitFullScreen()
    {
        ExitFullScreenButton.IsVisible = false;
        ReaderToolbar.IsVisible = true;
        BottomBar.IsVisible = true;
        FloatingMenuContainer.IsVisible = true;
    }

    /// <summary>Exits full screen mode - restores navigation and bottom bar.</summary>
    private void OnExitFullScreenClicked(object? sender, TappedEventArgs e)
    {
        ExitFullScreen();
    }

    /// <summary>
    /// Draggable exit-fullscreen affordance: Android uses a native Touch handler
    /// (raw coordinates survive RTL/translation), other platforms use tap+pan.
    /// </summary>
    private void SetupExitButtonDragHandler()
    {
#if ANDROID
        ExitFullScreenButton.HandlerChanged += (_, _) =>
        {
            if (ExitFullScreenButton.Handler?.PlatformView is Android.Views.View nativeView)
            {
                _exitButtonTouchSlop = (nativeView.Context is { } ctx
                    ? Android.Views.ViewConfiguration.Get(ctx)?.ScaledTouchSlop
                    : null) ?? 24;
                _exitButtonDensity = (float)DeviceDisplay.MainDisplayInfo.Density;
                nativeView.Touch += OnExitButtonNativeTouch;
            }
        };
#else
        var tap = new TapGestureRecognizer();
        tap.Tapped += OnExitFullScreenClicked;
        ExitFullScreenButton.GestureRecognizers.Add(tap);

        var pan = new PanGestureRecognizer();
        pan.PanUpdated += OnExitFullScreenButtonPan;
        ExitFullScreenButton.GestureRecognizers.Add(pan);
#endif
    }

#if ANDROID
    private float _exitButtonTouchStartRawX;
    private float _exitButtonTouchStartRawY;
    private double _exitButtonDragStartTx;
    private double _exitButtonDragStartTy;
    private bool _exitButtonIsDragging;
    private int _exitButtonTouchSlop;
    private float _exitButtonDensity;

    /// <summary>
    /// Native Android touch handler for exit fullscreen button.
    /// Uses getRawX/getRawY (screen coordinates) which are never affected by
    /// view translation, RTL layout, or MAUI coordinate transforms.
    /// </summary>
    private void OnExitButtonNativeTouch(object? sender, Android.Views.View.TouchEventArgs e)
    {
        if (e.Event is not { } motion)
        {
            return;
        }

        switch (motion.ActionMasked)
        {
            case Android.Views.MotionEventActions.Down:
                _exitButtonTouchStartRawX = motion.RawX;
                _exitButtonTouchStartRawY = motion.RawY;
                _exitButtonDragStartTx = ExitFullScreenButton.TranslationX;
                _exitButtonDragStartTy = ExitFullScreenButton.TranslationY;
                _exitButtonIsDragging = false;
                e.Handled = true;
                break;

            case Android.Views.MotionEventActions.Move:
                {
                    var dx = motion.RawX - _exitButtonTouchStartRawX;
                    var dy = motion.RawY - _exitButtonTouchStartRawY;

                    if (!_exitButtonIsDragging &&
                        (Math.Abs(dx) > _exitButtonTouchSlop || Math.Abs(dy) > _exitButtonTouchSlop))
                    {
                        _exitButtonIsDragging = true;
                    }

                    if (_exitButtonIsDragging)
                    {
                        ExitFullScreenButton.TranslationX = _exitButtonDragStartTx + dx / _exitButtonDensity;
                        ExitFullScreenButton.TranslationY = _exitButtonDragStartTy + dy / _exitButtonDensity;
                    }
                    e.Handled = true;
                    break;
                }

            case Android.Views.MotionEventActions.Up:
                if (!_exitButtonIsDragging)
                {
                    ExitFullScreen();
                }
                e.Handled = true;
                break;

            case Android.Views.MotionEventActions.Cancel:
                e.Handled = true;
                break;

            default:
                // Other motion actions do not affect the exit-button drag.
                break;
        }
    }
#else
    private double _exitButtonPanStartX;
    private double _exitButtonPanStartY;

    private void OnExitFullScreenButtonPan(object? sender, PanUpdatedEventArgs e)
    {
        switch (e.StatusType)
        {
            case GestureStatus.Started:
                _exitButtonPanStartX = ExitFullScreenButton.TranslationX;
                _exitButtonPanStartY = ExitFullScreenButton.TranslationY;
                break;
            case GestureStatus.Running:
                ExitFullScreenButton.TranslationX = _exitButtonPanStartX + e.TotalX;
                ExitFullScreenButton.TranslationY = _exitButtonPanStartY + e.TotalY;
                break;

            default:
                // Completed/canceled gestures keep the button where the pan left it.
                break;
        }
    }
#endif

    #endregion

    #region Android Touch / Swipe

#if ANDROID
    private readonly SwipeNavigationTracker _swipe = new();

    private void OnTouchStarted(object? sender, TouchPosition position)
    {
        _swipe.Cancel();
        if (_carouselInitializing || CarouselLoadingOverlay.IsVisible || _isMenuOpen || _isShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen ||
            !ContainsTouch(ParashaCarousel, position) || ContainsTouch(BottomBar, position) ||
            ContainsTouch(ExitFullScreenButton, position))
        {
            return;
        }
        _swipe.Begin(position, ParashaCarousel.Position);
    }

    private void OnTouchDispatched(object? sender, TouchPosition position)
    {
        if (_carouselInitializing || CarouselLoadingOverlay.IsVisible || _isMenuOpen || _isShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen ||
            !ContainsTouch(ParashaCarousel, position) || ContainsTouch(BottomBar, position) ||
            ContainsTouch(ExitFullScreenButton, position) || ContainsTouch(CircularMenuButton, position) ||
            ContainsTouch(SelectionBar, position))
        {
            return;
        }

        LongPressBehavior.BeginUnreceivedPress(position.X, position.Y, _viewModel.Unit);
    }

    private static bool ContainsTouch(VisualElement element, TouchPosition position)
    {
        if (!element.IsVisible || element.Handler?.PlatformView is not Android.Views.View view)
        {
            return false;
        }

        if (!view.IsShown)
        {
            return false;
        }

        var location = new int[2];
        view.GetLocationOnScreen(location);
        return position.X >= location[0] && position.X < location[0] + view.Width &&
            position.Y >= location[1] && position.Y < location[1] + view.Height;
    }

    private void OnTouchMoved(object? sender, TouchPosition position)
    {
        var slop = ParashaCarousel.Handler?.PlatformView is Android.Views.View view
            ? Android.Views.ViewConfiguration.Get(view.Context!)?.ScaledTouchSlop ?? 12
            : 12;
        _swipe.Move(position, slop);
    }

    // Releases and native cancels/interruptions both arrive here: a cancel
    // mid-swipe can strand the carousel mid-offset just like a release, so
    // it settles the same way (#2469).
    private void OnTouchReleased(object? sender, TouchPosition position) =>
        SettleSwipe(_swipe.Last ?? position);

    private void SettleSwipe(TouchPosition position)
    {
        if (ParashaCarousel.Handler?.PlatformView is not Android.Views.View view)
        {
            return;
        }

        var configuration = Android.Views.ViewConfiguration.Get(view.Context!);
        var target = _swipe.End(position, view.Width, configuration?.ScaledTouchSlop ?? 12,
            configuration?.ScaledMinimumFlingVelocity ?? 50,
            view.LayoutDirection == Android.Views.LayoutDirection.Rtl, _viewModel.CarouselUnits.Count);
        if (target is int index)
        {
            // Run after native dispatch, so an intercepted Up/Cancel cannot stop
            // the final snap. ScrollTo also resets MAUI's current snap target.
            ParashaCarousel.ScrollTo(index, position: ScrollToPosition.Center, animate: true);
        }
    }
#endif

    #endregion

    #region iOS Safe Area

#if IOS
    /// <summary>
    /// The page disables automatic safe-area padding so the reader spans the
    /// full width in landscape — see ReaderSafeArea for the shared logic
    /// which is what produced the empty landscape side bands (#1308).
    /// Keep the root's top inset so the reader toolbar stays below the status
    /// bar and notch. Its bottom edge also respects the home indicator, with
    /// ApplyBottomBarSafeArea managing the bottom bar itself. Leave the sides
    /// and descendant layouts unpadded so landscape content spans the width.
    /// Views inside scroll views (the carousel cells and pasukim lists) never
    /// apply safe-area padding, so only the direct layout chain needs this.
    /// </summary>
    private void ConfigureReaderSafeArea()
    {
        ReaderSafeArea.Configure(MainGrid);
    }

    private void OnPageSizeChanged(object? sender, EventArgs e) => ApplyBottomBarSafeArea();

    private void ApplyBottomBarSafeArea()
    {
        double bottom = 0;
        var window = UIKit.UIApplication.SharedApplication?.ConnectedScenes
            .OfType<UIKit.UIWindowScene>()
            .FirstOrDefault()?.Windows
            .FirstOrDefault(w => w.IsKeyWindow);
        if (window != null)
        {
            bottom = window.SafeAreaInsets.Bottom;
        }

        // Shift the bars down over the home-indicator inset and pull the page
        // up underneath so no gap shows (tester-confirmed combination).
        // With no inset (iPad, landscape) the same assignments restore the
        // layout defaults, so an inset disappearing never leaves stale values.
        var totalHeight = 90 + bottom;
        BottomBar.TranslationY = bottom;
        BottomBar.Padding = new Thickness(0, 0, 0, bottom);
        BottomBar.HeightRequest = totalHeight;
        FloatingMenuContainer.TranslationY = bottom;
        FloatingMenuContainer.Padding = new Thickness(0, 0, 0, bottom);
        this.Padding = new Thickness(0, 0, 0, -bottom);
        Resources["BottomBarTotalHeight"] = totalHeight;

        // Padding changes the arrange area without firing SizeChanged.
        LayoutCircularMenu();
    }
#endif

    #endregion

    #region Analytics

    /// <summary>
    /// The reader reports its own logical screen (ParashaAlHaperek/{unitId}) from
    /// page lifecycle and carousel swipes — transitions a Shell-level
    /// screen_view would double-count — so the Shell report is suppressed.
    /// </summary>
    public string? AnalyticsScreenName => null;

    protected override void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        SetAnalyticsScreenForUnit();
    }

    /// <summary>Logs current parasha screen to analytics (legacy-style: ParashaAlHaperek/{unitId}).</summary>
    private void SetAnalyticsScreenForUnit()
    {
        var analytics = Microsoft.Maui.Controls.Application.Current?.Handler?.MauiContext?.Services.GetService<IAnalyticsService>();
        analytics?.SetScreen($"ParashaAlHaperek/{_viewModel.UnitId}", "ParashaPage");
    }

    #endregion
}
