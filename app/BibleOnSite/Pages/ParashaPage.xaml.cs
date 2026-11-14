namespace BibleOnSite.Pages;

using BibleOnSite.Behaviors;
using BibleOnSite.Controls;
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

    // Perek requested via query attributes; resolved to its containing
    // parasha only after the parasha service loads.
    private int? _pendingPerekId;

    public ParashaPage()
    {
        InitializeComponent();
        _viewModel = new ParashaViewModel();
        BindingContext = _viewModel;
        FinishSetup();
    }

    public ParashaPage(ParashaViewModel viewModel)
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
        // פרשת השבוע on a festival Shabbat: explain the displaced reading
        // and offer the next regular one instead of jumping silently.
        _viewModel.ConfirmHolidayReading = target =>
            ShellAppNavigator.Instance.DisplayChoiceAsync("פרשת השבוע",
                $"שבת {target.HolidayShabbatDateText} היא {target.HolidayName} ואין בה פרשת שבוע רגילה.\n" +
                $"הקריאה הבאה: {target.ReadingTitle} ({target.ShabbatDateText}).",
                $"עבור ל{target.ReadingTitle}", "ביטול");
        SetupUnitPickerEvents();
        InitializeSearchHeader();
        SetupPlatformChrome();
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
    /// Wires the platform chrome every reader shares (#2573) — iOS safe-area
    /// and edge-back history, Android predictive-Back registration, and the
    /// capsule's enabled-state provider — through the one coordinator. Only
    /// the division plugs differ: which transient surfaces consume Back and
    /// what Back does to them.
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
                Carousel = ParashaCarousel,
                BackSensitiveOverlays = [ReaderMenuOverlay, ExitFullScreenButton],
                SearchSurface = ChapterSearch,
                SelectionSurface = SelectionBar,
                PerushimSheet = PerushimPanel,
                StatusBarColorSource = ReaderToolbar,
            },
            new ReaderPlatformChromeActions
            {
                OwnsReturnSurface = OwnsReaderReturnSurface,
                TryHandleBack = TryHandleReaderBack,
            });
    }

    /// <summary>
    /// Wires the shared reader chrome — bottom bar, perushim sheet, articles
    /// view, fullscreen and fan prev/next refresh plus picker cleanup —
    /// through the one coordinator every reader page uses (#2573). Only the
    /// division adapters differ: unit ids, unit articles, unit navigation.
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
                ReaderContent = ParashaCarousel,
                // This reader has no reading-position indicator yet.
                ReadingProgressIndicator = null,
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
                FullscreenStateChanged = OnReaderFullscreenStateChanged,
            });
    }

    /// <summary>
    /// Parasha extras after a fullscreen transition: the search surface closes
    /// on entry, the reader keeps no native Back affordance, and Android's
    /// predictive-Back callback re-evaluates its overlays.
    /// </summary>
    private void OnReaderFullscreenStateChanged(bool isFullScreen)
    {
        if (isFullScreen)
        {
            ChapterSearch.Close();
        }
        Shell.SetNavBarIsVisible(this, false);
        _platformChrome.RefreshNativeBack();
    }

    /// <summary>
    /// Wires the shared display-sync coordinator (#2573) — font resources,
    /// theme refresh of the realized pesukim and notes-materialization
    /// re-check — through the one implementation every reader page uses. Only
    /// the division plugs differ: which pasuk rows are loaded, the
    /// focused-pasuk extras, and the unit notes reload.
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
                AfterThemeRefresh = () =>
                {
                    if (_focusedPasuk != null)
                    {
                        _focusedPasuk.RefreshForThemeChange();
                        RefreshFocusedRecitation();
                    }
                },
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
    /// implementation every reader page uses. Only the division plugs differ:
    /// the suppression extras (articles/focused pasuk/search) and the
    /// unit-typed long-press arming.
    /// </summary>
    private void SetupCarousel()
    {
        _carousel = new ReaderCarousel(
            new ReaderCarouselSurfaces
            {
                Carousel = ParashaCarousel,
                LoadingOverlay = CarouselLoadingOverlay,
                FanMenu = FanMenu,
                SwipeExcluded = [BottomBar, PerushimPanel, ExitFullScreenButton, ParashaUnitPickerPopup],
                PressExcluded = [FanMenu.ToggleButton, SelectionBar],
            },
            new ReaderCarouselActions
            {
                CurrentPosition = () => _viewModel.CarouselPosition,
                ItemCount = () => _viewModel.CarouselUnits.Count,
                IsLoading = () => _isLoading,
                IsSwipeSuppressed = () => _chrome.IsShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen,
#if ANDROID
                ArmUnreceivedPress = (x, y) => LongPressBehavior.BeginUnreceivedPress(x, y, _viewModel.Unit),
#endif
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
        ParashaUnitPickerPopup.UnitSelected += async (_, unitId) =>
            await _chrome.CompletePickerSelectionAsync(unitId);
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
        _carousel.ScrollToUnit(index);

        ClearAllSelections();
        SetAnalyticsScreenForUnit();
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
        SubscribeRecitation();
        await InitializeRecitationAsync();
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
                    CarouselLoadingOverlay.Hide();
                }
            }
            finally
            {
                _isLoading = false;
                _carousel.ConsumePendingResnap();
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
            await _displaySync.RefreshNotesIfAvailabilityChangedAsync();
            StartSearchIntroduction();
        }
        // Cold-start main-thread work is done — release the deferred e2e
        // search-index warmup so it cannot starve the accessibility snapshot.
        Services.SearchIndexService.NotifyStartupSettled();
        _platformChrome.ScheduleHistoryRefresh();
    }

    private void OnReaderListLoaded(object? sender, EventArgs e) =>
        _platformChrome.ReaderSurfaceRealized();

    protected override void OnDisappearing()
    {
        FinishSearchIntroduction();
        _platformChrome.Disappearing();
        if (!_preserveSearchOnDisappear)
        {
            ChapterSearch.Close();
        }
        ResetRecitationSession();
        PreferencesService.Instance.PreferencesChanged -= OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed -= OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested -= OnPlaybackStopRequested;
        _carousel.Disappearing();
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
        _carousel.IsInitializing = true;
        try
        {
            await _viewModel.LoadByUnitIdAsync(unitId.Value);

            // CarouselView resets Position to 0 when ItemsSource changes.
            // Force it to the correct position without animation.
            var targetPos = ReaderCarousel.IndexOf(_viewModel.CarouselUnits, u => u.UnitId, _viewModel.UnitId);
            if (targetPos >= 0)
            {
                ParashaCarousel.ScrollTo(targetPos, animate: false);
                _viewModel.CarouselPosition = targetPos;
            }
        }
        finally
        {
            _carousel.IsInitializing = false;
        }

        // Hide loading overlay — carousel is ready
        CarouselLoadingOverlay.Hide();

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
    private void ShowCarouselLoading() => CarouselLoadingOverlay.ShowLoading();

    /// <summary>Swaps the loading overlay to its retryable error state.</summary>
    private void ShowParashaLoadError(Exception ex) => CarouselLoadingOverlay.ShowError(ex);

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
                CarouselLoadingOverlay.Hide();
            }
        }
        finally
        {
            _isLoading = false;
            _carousel.ConsumePendingResnap();
        }
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

    /// <summary>
    /// Whether a transient reader surface would consume Back — mirrors
    /// <see cref="TryHandleReaderBack"/>'s ordering without acting on it, so
    /// the capsule's enabled state reflects the same surfaces the shared
    /// back pipeline serves (#2467).
    /// </summary>
    private bool OwnsReaderReturnSurface() =>
        ExitFullScreenButton.IsVisible
        || ReaderMenuOverlay.IsOpen
        || PerushimPanel.IsOpen
        || ChapterSearch.IsSearchOpen
        || ReaderSurfaceState.IsActive(_viewModel.SelectedPasukCount,
            _unitRecitationSelection, _focusedPasuk != null,
            Recitation.Cursor.PlayingKey != null);

    private void OnUnitPickerClicked(object? sender, EventArgs e)
    {
        ParashaUnitPickerPopup.Show(_viewModel.UnitId);
    }

    /// <summary>⋮ reader options menu — toggles the dropdown overlay.</summary>
    private void OnReaderMenuButtonClicked(object? sender, EventArgs e) => ReaderMenuOverlay.Toggle();

    private void OnShnayimMikraTapped(object? sender, EventArgs e) =>
        _viewModel.IsShnayimMikraEnabled = !_viewModel.IsShnayimMikraEnabled;

    private void OnTikkunKorimTapped(object? sender, EventArgs e) =>
        _viewModel.IsTikkunKorimEnabled = !_viewModel.IsTikkunKorimEnabled;

    private void OnDivineNameMaskingTapped(object? sender, EventArgs e) =>
        _viewModel.DivineNameMaskingEnabled = !_viewModel.DivineNameMaskingEnabled;

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

    /// <summary>Feeds the Debug-only תיקון scroll-offset E2E probe (#2624).</summary>
    private void OnTikkunScrolled(object? sender, ScrolledEventArgs e) =>
        ReaderScrollTop.NoteScrollOffset(sender, e);

    /// <summary>Publishes the initial "tsy:0" so the probe is visible at rest (#2624).</summary>
    private void OnTikkunLoaded(object? sender, EventArgs e)
    {
        if (sender is Microsoft.Maui.Controls.ScrollView scrollView)
        {
            ReaderScrollTop.NoteScrollOffset(sender, scrollView.ScrollY);
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

    /// <summary>
    /// Links inside rendered note content: /929/ targets navigate natively,
    /// /pedia/ slugs open the Tanahpedia entry page, the rest open in the
    /// browser (#1227).
    /// </summary>
    private async void OnContentLinkTapped(object? sender, LinkTappedEventArgs e)
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
