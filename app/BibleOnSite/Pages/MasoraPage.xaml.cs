namespace BibleOnSite.Pages;

using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using Microsoft.Maui.Layouts;

/// <summary>
/// Reader page for מסורה על הפרק — Masoretic parasha units delimited by
/// ptuha/stuma breaks. Shares the על הפרק reader's interaction model
/// (carousel, perushim panel, articles, circular menu) while navigating
/// stable unit ids; rows are canonical pesukim clipped to each unit's
/// inclusive ranges — never a copied scripture corpus.
/// </summary>
// Codacy: S2333 false positive — partial is required by the XAML code
// generator and by the back-handling partial parts.
#pragma warning disable S2333
public partial class MasoraPage : ContentPage, IQueryAttributable //NOSONAR
#pragma warning restore S2333
{
    private readonly MasoraViewModel _viewModel;
    private bool _isLoading;

    // Articles view state
    private bool _isShowingArticles;

    // Guard: ignore CurrentItemChanged events fired by the CarouselView during
    // initial collection assignment — the ViewModel already holds the unit.
    private bool _carouselInitializing;

    // Unit requested via query attributes before the initial load finished.
    private int? _pendingUnitId;

    // Perek requested via query attributes; resolved to its containing unit
    // only after the masora service loads.
    private int? _pendingPerekId;

    public MasoraPage()
    {
        InitializeComponent();
        _viewModel = new MasoraViewModel();
        BindingContext = _viewModel;
        SubscribeViewModelChanges();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupUnitPickerEvents();
        SubscribeNotesMaterialization();
        SubscribeThemeChange();
    }

    public MasoraPage(MasoraViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
        SubscribeViewModelChanges();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupUnitPickerEvents();
        SubscribeNotesMaterialization();
        SubscribeThemeChange();
    }

    /// <summary>
    /// A reader opened while the first-launch notes pack still materializes
    /// skips awaiting it (#2430) — when the copy completes the service raises
    /// OperationCompleted off the UI thread, so re-check availability here.
    /// </summary>
    private void SubscribeNotesMaterialization()
    {
        PerushimNotesService.Instance.OperationCompleted += OnNotesOperationCompleted;
        Unloaded += (_, _) => PerushimNotesService.Instance.OperationCompleted -= OnNotesOperationCompleted;
    }

    /// <summary>
    /// Span colors (qri brackets, recitation highlight, פ/ס marks) are baked into
    /// each pasuk's cached FormattedString at build time — a theme flip while the
    /// page is alive must refresh the realized rows so they don't keep the other
    /// theme's colors (#2601).
    /// </summary>
    private void SubscribeThemeChange()
    {
        if (Microsoft.Maui.Controls.Application.Current is not { } app)
        {
            return;
        }
        // Pair with Loaded/Unloaded — a page kept on the Shell stack reloads
        // when navigation returns, and must re-check the theme then.
        Loaded += (_, _) =>
        {
            app.RequestedThemeChanged += OnRequestedThemeChanged;
            OnRequestedThemeChanged(app, new AppThemeChangedEventArgs(app.RequestedTheme));
        };
        Unloaded += (_, _) => app.RequestedThemeChanged -= OnRequestedThemeChanged;
    }

    private void OnRequestedThemeChanged(object? sender, AppThemeChangedEventArgs e)
    {
        Dispatcher.Dispatch(() =>
        {
            foreach (var unit in _viewModel.CarouselUnits)
            {
                foreach (var row in unit.Rows)
                {
                    row.Pasuk?.RefreshForThemeChange();
                }
            }
        });
    }

    private bool _notesRefreshQueued;

    private void OnNotesOperationCompleted()
    {
        // InitializeAsync releases the operation lock, which re-fires this
        // event — and the refresh calls InitializeAsync itself. Without this
        // guard every refresh queues another dispatcher turn forever, the UI
        // thread never idles, and accessibility queries starve (#2430).
        if (_notesRefreshQueued ||
            (PerushimNotesService.Instance.IsAvailable == _viewModel.PerushimNotesAvailable
                && !_viewModel.PerushimNotesPending))
        {
            return;
        }
        _notesRefreshQueued = true;
        _ = Dispatcher.DispatchAsync(async () =>
        {
            try { await RefreshPerushimIfAvailabilityChangedAsync(); }
            finally { _notesRefreshQueued = false; }
        });
    }

    /// <summary>
    /// Reloads perushim for the current unit when notes-availability changed
    /// since the last load (e.g. the first-launch pack finished copying).
    /// </summary>
    private async Task RefreshPerushimIfAvailabilityChangedAsync()
    {
        try
        {
            await PerushimNotesService.Instance.InitializeAsync();
            if ((PerushimNotesService.Instance.IsAvailable != _viewModel.PerushimNotesAvailable
                    || _viewModel.PerushimNotesPending) &&
                _viewModel.Unit is { } unit)
            {
                await _viewModel.LoadPerushimAsync(unit);
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: refresh is best-effort
        catch (Exception ex) //NOSONAR — refresh is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Refresh perushim on materialization failed: {ex}");
        }
    }

    /// <summary>
    /// Wires the unit picker's confirm event in code (rather than XAML event
    /// wiring) so the subscription is explicit beside the other setup calls.
    /// </summary>
    private void SetupUnitPickerEvents()
    {
        MasoraUnitPickerPopup.UnitSelected += async (_, unitId) =>
            await OnUnitPickerSelectedAsync(unitId);
    }

    /// <summary>
    /// Query attributes for deep navigation: <c>?unit=42</c> opens a unit by its
    /// stable id; <c>?perekId=5</c> opens the unit containing that perek's first
    /// pasuk (e.g. jumping from the על הפרק reader).
    /// </summary>
    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("unit", out var unitValue))
        {
            _pendingUnitId = ParsePositiveInt(unitValue);
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
        // Guard: suppress OnCarouselItemChanged while we reposition
        _carouselInitializing = true;
        MasoraCarousel.ScrollTo(index, animate: false);
        // Do not push CarouselPosition back into the two-way Position
        // binding here — it queues a second (animated) scroll that can
        // overshoot the target and land on the following unit.
        _carouselInitializing = false;

        if (FanMenu.IsOpen)
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
    /// Populates page-level DynamicResource entries for perush font sizes and
    /// keeps them in sync when the user changes the font-factor preference.
    /// </summary>
    private void SetupFontSizeResources()
    {
        var prefs = PreferencesService.Instance;
        UpdateFontSizeResources(prefs);
        WeakPreferencesSubscription.Subscribe(this, prefs, page =>
            MainThread.BeginInvokeOnMainThread(() => page.UpdateFontSizeResources(prefs)));
    }

    // Same reading-text categories as PerekPage (#2461).
    private void UpdateFontSizeResources(PreferencesService prefs)
    {
        var pasukFactor = prefs.PasukFontFactor;
        var perushFactor = prefs.PerushFontFactor;
        Resources["PasukFontSize"] = pasukFactor * 18;
        Resources["PasukNumFontSize"] = pasukFactor * 16;
        Resources["PerushNameFontSize"] = perushFactor * 14;
        Resources["PerushContentFontSize"] = perushFactor * 18;
    }

    private void SubscribeViewModelChanges()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            // When the unit changes via prev/next, refresh articles and nav buttons
            if (e.PropertyName == nameof(MasoraViewModel.Unit) || e.PropertyName == "Unit")
            {
                MainThread.BeginInvokeOnMainThread(OnUnitChangedOnMainThread);
            }
        };
    }

    /// <summary>Refreshes articles and nav-button visuals after a unit change (main thread).</summary>
    private void OnUnitChangedOnMainThread()
    {
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
        if (!FanMenu.IsOpen)
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

        if (_viewModel.Unit == null && !_isLoading)
        {
            _isLoading = true;
            await LoadInitialUnitAsync();
        }
        // Cold-start main-thread work is done — release the deferred e2e
        // search-index warmup so it cannot starve the accessibility snapshot.
        Services.SearchIndexService.NotifyStartupSettled();
    }

    /// <summary>Loads the initial unit and snaps the carousel to it.</summary>
    private async Task LoadInitialUnitAsync()
    {
        try
        {
            // Show loading overlay while the carousel initialises.
            CarouselLoadingOverlay.ShowLoading();

            var unitId = _pendingUnitId;
            if (unitId == null && _pendingPerekId is int perekId)
            {
                unitId = await _viewModel.GetUnitIdForPerekAsync(perekId);
            }
            _pendingUnitId = null;
            _pendingPerekId = null;

            unitId ??= await _viewModel.GetInitialUnitIdAsync();

            // Guard: ignore OnCarouselItemChanged during initial load.
            _carouselInitializing = true;
            await _viewModel.LoadByUnitIdAsync(unitId.Value);

            // CarouselView resets Position to 0 when ItemsSource changes.
            // Force it to the correct position without animation.
            var targetPos = UnitIndexOf(_viewModel.UnitId);
            if (targetPos >= 0)
            {
                MasoraCarousel.ScrollTo(targetPos, animate: false);
                _viewModel.CarouselPosition = targetPos;
            }

            _carouselInitializing = false;

            // Hide loading overlay — carousel is ready
            CarouselLoadingOverlay.Hide();

            // Update articles count badge
            await UpdateArticlesCountAsync();

            // Preload rows for adjacent units so the next swipe is instant
            _ = _viewModel.PreloadAdjacentRowsAsync(_viewModel.UnitId);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: unit load failure surfaces on the retryable overlay (#2084)
        catch (Exception ex) //NOSONAR — unit load failure surfaces on the retryable overlay (#2084).
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Failed to load masora unit: {ex.Message}");
            CarouselLoadingOverlay.ShowError(ex);
        }
        finally
        {
            _isLoading = false;
        }
    }

    /// <summary>Retry button on the load-failure overlay — re-runs the full fresh load.</summary>
    private async void OnUnitLoadRetryClicked(object? sender, EventArgs e)
    {
        if (_isLoading)
        {
            return;
        }
        _isLoading = true;
        await LoadInitialUnitAsync();
    }

    protected override void OnDisappearing()
    {
#if ANDROID
        UnregisterReaderBack();
#endif
#if WINDOWS
        UnregisterReaderKeyboardBack();
#endif
        base.OnDisappearing();
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

        if (e.CurrentItem is not MasoraUnit unit || unit.UnitId <= 0 || unit.UnitId == _viewModel.UnitId)
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

        // Refresh nav button visuals if menu is open (synchronous)
        if (FanMenu.IsOpen)
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

    /// <summary>
    /// Fan open — refresh prev/next enabled state before the satellites fade
    /// in, so a disabled edge button animates to its dimmed opacity.
    /// </summary>
    private void OnFanMenuOpening(object? sender, EventArgs e)
    {
        PrevUnitButton.IsEnabled = _viewModel.CanGoToPreviousUnit;
        NextUnitButton.IsEnabled = _viewModel.CanGoToNextUnit;
    }

    /// <summary>Handles tap on a satellite menu item — the menu closes.</summary>
    private async void OnMenuItemClicked(object? sender, EventArgs e)
    {
        // Command-based buttons already fired their command; just close.
        await FanMenu.CloseAsync();
    }

    /// <summary>Syncs the chevron glyph with the perushim sheet's open state.</summary>
#pragma warning disable S1172 // The XAML event delegate requires the sender parameter.
    private void OnPerushimSheetOpenChanged(object? sender, bool isOpen)
#pragma warning restore S1172
    {
        BottomBar.IsPerushimOpen = isOpen;
    }

    /// <summary>Bottom-bar chevron — toggles the perushim sheet.</summary>
    private async void OnPerushimChevronClicked(object? sender, EventArgs e)
    {
        // Cap the drag-up expansion so the sheet's top edge stays under the
        // status bar/pill: content + toolbar rows already begin below it.
        var toolbarHeight = ReaderToolbar.IsVisible ? ReaderToolbar.Height : 0;
        await PerushimPanel.ToggleAsync(MainGrid.Height, ContentArea.Height + toolbarHeight - 8);
    }

    #endregion

    #region Navigation & Picker

    /// <summary>Title tap — opens the unit picker.</summary>
    private void OnUnitSourceClicked(object? sender, EventArgs e)
    {
        MasoraUnitPickerPopup.Show(_viewModel.UnitId);
    }

    private void OnUnitPickerClicked(object? sender, EventArgs e)
    {
        MasoraUnitPickerPopup.Show(_viewModel.UnitId);
    }

    /// <summary>
    /// Handles unit selection from the picker popup. A confirmed selection
    /// completes the navigation: the picker closes itself and the radial menu
    /// that opened it closes too, leaving the reader undimmed and interactive
    /// (#2476).
    /// </summary>
    private async Task OnUnitPickerSelectedAsync(int unitId)
    {
        if (FanMenu.IsOpen)
        {
            await FanMenu.CloseAsync();
        }

        if (unitId > 0 && unitId != _viewModel.UnitId)
        {
            await _viewModel.NavigateToUnitAsync(unitId);
        }
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
                return;
            }
            await _viewModel.LoadArticlesAsync(unit);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-count badge degrades to hidden
        catch (Exception ex) //NOSONAR — articles-count badge degrades to hidden.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error fetching articles count: {ex.Message}");
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

            PerushimPanel.CloseImmediate();
            _isShowingArticles = true;
            await ShowUnitArticlesAsync();

            MasoraCarousel.IsVisible = false;
            ArticlesCollection.IsVisible = true;

            BottomBar.IsArticlesActive = true;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-button styling failure is log-only
        catch (Exception ex) //NOSONAR — articles-button styling failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Articles] Error in OnArticlesButtonClicked: {ex}");
        }
    }

    /// <summary>Returns to the unit text view.</summary>
    private void ShowUnitView()
    {
        _isShowingArticles = false;
        _viewModel.SelectedArticleId = null;

        ArticlesCollection.IsVisible = false;
        MasoraCarousel.IsVisible = true;

        BottomBar.IsArticlesActive = false;
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
#pragma warning disable S1172 // The XAML event delegate requires the sender parameter.
    private async void OnArticleSelected(object? sender, Article article)
#pragma warning restore S1172
    {
        _viewModel.SelectedArticleId = article.Id;
        try
        {
            await Shell.Current.GoToAsync($"articleDetail?articleId={article.Id}");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: article navigation failure is log-only
        catch (Exception ex) //NOSONAR — article navigation failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error navigating to article: {ex.Message}");
        }
    }

    #endregion

    #region Full Screen

    /// <summary>Text button — returns to the unit view from articles, else
    /// animates the visible unit's vertical content back to its start (#2624).</summary>
    private void OnTextButtonClicked(object? sender, EventArgs e)
    {
        if (_isShowingArticles)
        {
            ShowUnitView();
        }
        else
        {
            ReaderScrollTop.ScrollCurrentUnitToStart(MasoraCarousel, _viewModel.Unit);
        }
    }

    /// <summary>Enters full screen mode - hides top and bottom bars, shows exit button.</summary>
    private void OnFullScreenClicked(object? sender, EventArgs e)
    {
        // Close circular menu if open — snaps to the closed state with no
        // animation so the scrim cannot linger over the fullscreen reader.
        FanMenu.ResetToClosed();

        ReaderToolbar.IsVisible = false;
        BottomBar.IsVisible = false;
        FanMenu.IsVisible = false;
        ExitFullScreenButton.ResetPosition();
        ExitFullScreenButton.IsVisible = true;
    }

    /// <summary>Exits full screen mode - restores navigation and bottom bar.</summary>
    private void OnExitFullScreenClicked(object? sender, EventArgs e) => ExitFullScreen();

    private void ExitFullScreen()
    {
        ExitFullScreenButton.IsVisible = false;
        ReaderToolbar.IsVisible = true;
        BottomBar.IsVisible = true;
        FanMenu.IsVisible = true;
    }

    protected override bool OnBackButtonPressed()
    {
        return TryHandleReaderBack() || base.OnBackButtonPressed();
    }

    private bool TryHandleReaderBack()
    {
        if (ExitFullScreenButton.IsVisible)
        { ExitFullScreen(); return true; }
        return false;
    }

    #endregion
}
