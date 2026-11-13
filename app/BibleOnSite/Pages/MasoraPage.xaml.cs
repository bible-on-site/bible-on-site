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

    // Native safe-area + Back plumbing is owned by the shared platform
    // chrome coordinator (#2573).
    private ReaderPlatformChrome _platformChrome = null!;

    // Font/theme/notes availability sync is owned by the shared display-sync
    // coordinator (#2573).
    private ReaderDisplaySync _displaySync = null!;

    // The programmatic-scroll guard, rotation resnap and Android swipe settle
    // are owned by the shared carousel coordinator (#2573).
    private ReaderCarousel _carousel = null!;

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
        FinishSetup();
    }

    public MasoraPage(MasoraViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
        FinishSetup();
    }

    private void FinishSetup()
    {
        SetupReaderChrome();
        SubscribeViewModelChanges();
        SetupDisplaySync();
        SetupCarousel();
        SetupCarouselNavigation();
        SetupUnitPickerEvents();
        SetupPlatformChrome();
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
    /// Wires the platform chrome every reader shares (#2573) — iOS safe-area
    /// and edge-back history, Android predictive-Back registration, and the
    /// capsule's enabled-state provider — through the one coordinator.
    /// Masora's transient return surfaces are fullscreen and the perushim
    /// sheet (#2766): the capsule stays enabled while either is up — the
    /// same surfaces <see cref="TryHandleReaderBack"/> serves (#2467).
    /// </summary>
    private void SetupPlatformChrome()
    {
        _platformChrome = new ReaderPlatformChrome(
            new ReaderPlatformChromeSurfaces
            {
                Page = this,
                Root = MainGrid,
                NavigationBar = NormalNavigationBar,
                BottomBar = BottomBar,
                FanMenu = FanMenu,
                Carousel = MasoraCarousel,
                BackSensitiveOverlays = [ExitFullScreenButton],
                PerushimSheet = PerushimPanel,
                StatusBarColorSource = ReaderToolbar,
            },
            new ReaderPlatformChromeActions
            {
                OwnsReturnSurface = () => ExitFullScreenButton.IsVisible || PerushimPanel.IsOpen,
                TryHandleBack = TryHandleReaderBack,
            });
    }

    /// <summary>
    /// Wires the shared display-sync coordinator (#2573) — font resources,
    /// theme refresh of the realized pesukim and notes-materialization
    /// re-check — through the one implementation every reader page uses. Only
    /// the division plugs differ: which pasuk rows are loaded and the unit
    /// notes reload. Masora has no focused-pasuk extras.
    /// </summary>
    private void SetupDisplaySync()
    {
        _displaySync = new ReaderDisplaySync(
            new ReaderDisplaySyncSurfaces
            {
                Page = this,
                Notes = PerushimNotesService.Instance,
                Preferences = PreferencesService.Instance,
            },
            new ReaderDisplaySyncActions
            {
                LoadedPasukim = () => _viewModel.CarouselUnits
                    .SelectMany(unit => unit.Rows)
                    .Select(row => row.Pasuk)
                    .OfType<Pasuk>(),
                NotesAvailable = () => _viewModel.PerushimNotesAvailable,
                NotesPending = () => _viewModel.PerushimNotesPending,
                ReloadNotesAsync = () => _viewModel.Unit is { } unit
                    ? _viewModel.LoadPerushimAsync(unit)
                    : Task.CompletedTask,
            });
    }

    /// <summary>
    /// Wires the shared carousel coordinator (#2573) — programmatic-scroll
    /// guard, rotation resnap and the Android swipe settle — through the one
    /// implementation every reader page uses. Masora rows carry no long-press
    /// arming, so the dispatched-touch plug stays unwired; the articles view
    /// still suppresses swipe tracking while it shows.
    /// </summary>
    private void SetupCarousel()
    {
        _carousel = new ReaderCarousel(
            new ReaderCarouselSurfaces
            {
                Carousel = MasoraCarousel,
                LoadingOverlay = CarouselLoadingOverlay,
                FanMenu = FanMenu,
                SwipeExcluded = [BottomBar, PerushimPanel, ExitFullScreenButton, MasoraUnitPickerPopup],
            },
            new ReaderCarouselActions
            {
                CurrentPosition = () => _viewModel.CarouselPosition,
                ItemCount = () => _viewModel.CarouselUnits.Count,
                IsLoading = () => _isLoading,
                IsSwipeSuppressed = () => _chrome.IsShowingArticles,
            });
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
        _carousel.ScrollToUnit(index);

        _chrome.RefreshPrevNext();

        _ = UpdateArticlesCountAsync();
        _ = _viewModel.PreloadAdjacentRowsAsync(_viewModel.UnitId);
        if (_chrome.IsShowingArticles)
        {
            _ = ShowUnitArticlesAsync();
        }
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
        _platformChrome.Appearing();
        _carousel.Appearing();

        if (_viewModel.Unit == null && !_isLoading)
        {
            _isLoading = true;
            await LoadInitialUnitAsync();
        }
        else if (_viewModel.UnitId > 0 && !_isLoading)
        {
            // Perushim may have been installed (downloaded in Preferences) or cleared by the OS
            // since this page last appeared. Re-check and reload so they show without an app restart.
            await _displaySync.RefreshNotesIfAvailabilityChangedAsync();
        }
        // Cold-start main-thread work is done — release the deferred e2e
        // search-index warmup so it cannot starve the accessibility snapshot.
        Services.SearchIndexService.NotifyStartupSettled();
        _platformChrome.ScheduleHistoryRefresh();
    }

    private void OnReaderListLoaded(object? sender, EventArgs e) =>
        _platformChrome.ReaderSurfaceRealized();

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
            _carousel.IsInitializing = true;
            try
            {
                await _viewModel.LoadByUnitIdAsync(unitId.Value);

                // CarouselView resets Position to 0 when ItemsSource changes.
                // Force it to the correct position without animation.
                var targetPos = ReaderCarousel.IndexOf(_viewModel.CarouselUnits, u => u.UnitId, _viewModel.UnitId);
                if (targetPos >= 0)
                {
                    MasoraCarousel.ScrollTo(targetPos, animate: false);
                    _viewModel.CarouselPosition = targetPos;
                }
            }
            finally
            {
                _carousel.IsInitializing = false;
            }

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
            _carousel.ConsumePendingResnap();
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
        _platformChrome.Disappearing();
        _carousel.Disappearing();
        base.OnDisappearing();
    }

    /// <summary>
    /// Carousel swipe: lazy-load the incoming unit's clipped rows, then update
    /// state and kick off perushim/articles/preload in the background — never
    /// block the next swipe.
    /// </summary>
    private async void OnCarouselItemChanged(object? sender, CurrentItemChangedEventArgs e)
    {
        if (_carousel.IsInitializing)
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
        // through to page navigation while still visible. The shared policy
        // ranks them foreground-first — the masora reader has no search or
        // focused-pasuk overlay, so those ranks never fire here (#3307).
        var owner = ReaderBackPolicy.Resolve(
            exitFullScreenVisible: ExitFullScreenButton.IsVisible,
            unitPickerOpen: MasoraUnitPickerPopup.IsVisible,
            fanMenuOpen: FanMenu.IsOpen,
            menuOverlayOpen: false,
            chapterSearchOpen: false,
            focusedPasuk: false,
            perushimSheetOpen: PerushimPanel.IsOpen,
            selectionSurfacesActive: false);
        switch (owner)
        {
            case ReaderBackSurface.ExitFullScreen:
                _chrome.ExitFullScreen();
                return true;
            case ReaderBackSurface.UnitPicker:
                MasoraUnitPickerPopup.Hide();
                return true;
            case ReaderBackSurface.FanMenu:
                _ = FanMenu.CloseAsync();
                return true;
            case ReaderBackSurface.PerushimSheet:
                PerushimPanel.CloseImmediate();
                return true;
            default:
                return false;
        }
    }

    /// <summary>
    /// Links inside rendered note content: /929/ targets navigate natively,
    /// /pedia/ slugs open the Tanahpedia entry page, the rest open in the
    /// browser (#1227).
    /// </summary>
    private async void OnContentLinkTapped(object? sender, Controls.LinkTappedEventArgs e)
    {
        e.Handled = true;
        try
        {
            await AppLinkHelper.FollowHtmlLinkAsync(e.Url, Launcher.Default, ShellAppNavigator.Instance);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: link navigation/launcher failure must not crash the reader
        catch (Exception ex) //NOSONAR — link navigation/launcher failure must not crash the reader.
        {
            #pragma warning restore S2221
            // async void - an unhandled navigation/launcher exception is a crash.
            Console.Error.WriteLine($"Content link navigation failed for {e.Url}: {ex}");
        }
    }

    #endregion

}
