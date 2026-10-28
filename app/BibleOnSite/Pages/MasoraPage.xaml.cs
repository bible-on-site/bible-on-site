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

    // Articles view state is owned by the shared reader chrome (#2573).
    private ReaderChrome _chrome = null!;

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
#if IOS
        ConfigureReaderSafeArea();
#endif
        _viewModel = new MasoraViewModel();
        BindingContext = _viewModel;
        FinishSetup();
    }

    public MasoraPage(MasoraViewModel viewModel)
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
        SetupReaderChrome();
        SubscribeViewModelChanges();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupUnitPickerEvents();
        SubscribeNotesMaterialization();
        SubscribeThemeChange();
        WireReaderBackChrome();
    }

    /// <summary>
    /// Wires the shared reader chrome — bottom bar, perushim sheet, articles
    /// view, fullscreen and fan prev/next refresh plus picker cleanup —
    /// through the one coordinator every reader page uses (#2573). Only the
    /// division adapters differ: unit ids, unit articles, unit navigation.
    /// The masora reader needs no FullscreenStateChanged extras: Android's
    /// Back callback already re-evaluates on ExitFullScreenButton visibility.
    /// </summary>
    private void SetupReaderChrome()
    {
        _chrome = new ReaderChrome(
            new ReaderChromeSurfaces
            {
                BottomBar = BottomBar,
                PerushimSheet = PerushimPanel,
                FanMenu = FanMenu,
                PreviousSatellite = PrevUnitButton,
                NextSatellite = NextUnitButton,
                ExitFullscreenButton = ExitFullScreenButton,
                ArticlesView = ArticlesCollection,
                ReaderContent = MasoraCarousel,
                Toolbar = ReaderToolbar,
                Host = MainGrid,
                ContentArea = ContentArea,
            },
            new ReaderChromeActions
            {
                ReloadArticlesAsync = ShowUnitArticlesAsync,
                CurrentUnit = () => _viewModel.Unit,
                SelectArticle = id => _viewModel.SelectedArticleId = id,
                CanGoPrevious = () => _viewModel.CanGoToPreviousUnit,
                CanGoNext = () => _viewModel.CanGoToNextUnit,
                IsSelectableUnit = unitId => unitId > 0,
                CurrentUnitId = () => _viewModel.UnitId,
                NavigateToUnitAsync = unitId => _viewModel.NavigateToUnitAsync(unitId),
            });
    }

    /// <summary>
    /// The capsule Back owns the fullscreen return affordance (#2467): it
    /// stays enabled while the floating exit control is up — the same
    /// surface <see cref="TryHandleReaderBack"/> serves.
    /// </summary>
    private void WireReaderBackChrome()
    {
        NormalNavigationBar.BackStateProvider = () => ExitFullScreenButton.IsVisible || PerushimPanel.IsOpen;
        ExitFullScreenButton.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(IsVisible))
            {
                NormalNavigationBar.RefreshBackState();
            }
        };
        // The perushim sheet owns Back while open (#2766) — keep the
        // affordance state in sync without relying on IsVisible flips.
        PerushimPanel.IsOpenChanged += (_, _) => NormalNavigationBar.RefreshBackState();
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
    /// The shared chrome completes the selection: it closes the fan that opened
    /// the picker and navigates a valid, different unit id (#2476).
    /// </summary>
    private void SetupUnitPickerEvents()
    {
        MasoraUnitPickerPopup.UnitSelected += async (_, unitId) =>
            await _chrome.CompletePickerSelectionAsync(unitId);
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

        _chrome.RefreshPrevNext();

        _ = UpdateArticlesCountAsync();
        _ = _viewModel.PreloadAdjacentRowsAsync(_viewModel.UnitId);
        if (_chrome.IsShowingArticles)
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
        if (_chrome.IsShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
        _chrome.RefreshPrevNext();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
#if ANDROID
        RegisterReaderBack();
#endif
#if IOS
        ApplyBottomBarSafeArea();
        SizeChanged -= OnPageSizeChanged;
        SizeChanged += OnPageSizeChanged;
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
        _chrome.RefreshPrevNext();

        // Fire async tasks in the background — never block the next swipe
        _ = UpdateArticlesCountAsync();
        _ = _viewModel.LoadPerushimAsync(unit);
        _ = _viewModel.PreloadAdjacentRowsAsync(unit.UnitId);
        if (_chrome.IsShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
    }

    #region Circular Menu

    /// <summary>Handles tap on a satellite menu item — the menu closes.</summary>
    private async void OnMenuItemClicked(object? sender, EventArgs e)
    {
        // Command-based buttons already fired their command; just close.
        await FanMenu.CloseAsync();
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

    /// <summary>
    /// Pushes the unit's loaded articles into the articles grid — the shared
    /// chrome calls this through its ReloadArticlesAsync adapter when the
    /// articles view opens or the unit changes underneath it.
    /// </summary>
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

    #endregion

    #region Back

    protected override bool OnBackButtonPressed()
    {
        return TryHandleReaderBack() || base.OnBackButtonPressed();
    }

    private bool TryHandleReaderBack()
    {
        // Topmost transient surfaces own Back first (#2766): fullscreen,
        // then the unit picker and the open fan menu previously fell
        // through to page navigation while still visible.
        if (ExitFullScreenButton.IsVisible)
        { _chrome.ExitFullScreen(); return true; }
        if (MasoraUnitPickerPopup.IsVisible)
        { MasoraUnitPickerPopup.Hide(); return true; }
        if (FanMenu.IsOpen)
        { _ = FanMenu.CloseAsync(); return true; }
        if (PerushimPanel.IsOpen)
        { PerushimPanel.CloseImmediate(); return true; }
        return false;
    }

    #endregion

#if IOS
    /// <summary>
    /// MAUI pads every Layout inside the device safe area by default
    /// (SafeAreaEdges = Container), and each Layout pads independently -
    /// clearing it only on MainGrid just moves the padding to ContentArea,
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
        // #2721: without this the fan's satellites stay laid out over the inset
        // area their accessibility bounds report - taps land on the shifted
        // geometry instead of the rendered buttons.
        var totalHeight = Controls.ReaderBottomBar.TotalHeight + bottom;
        BottomBar.TranslationY = bottom;
        BottomBar.Padding = new Thickness(0, 0, 0, bottom);
        BottomBar.HeightRequest = totalHeight;
        FanMenu.SetBottomInset(bottom);
        this.Padding = new Thickness(0, 0, 0, -bottom);
        Resources["BottomBarTotalHeight"] = totalHeight;
    }
#endif
}
