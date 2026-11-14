namespace BibleOnSite.Pages;

using BibleOnSite.Behaviors;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

/// <summary>
/// Page for displaying a Perek (chapter) with its pasukim (verses).
/// </summary>
public partial class PerekPage : ContentPage, IQueryAttributable, IAnalyticsScreenName
{
    private readonly PerekViewModel _viewModel;
    private bool _isLoading;

    // Resolved once for the fresh load; a retry must aim at the same perek
    // even though GetInitialPerekId consumes its one-shot request sources.
    // Cleared by ApplyQueryAttributes when a genuinely new navigation request
    // arrives, so the new target supersedes a previously failed one.
    private int? _initialPerekId;

    // Generation counter: each app-link request supersedes any earlier one
    // still waiting for the initial load.
    private long _appLinkGeneration;

    // Article from a cold-start app link, opened after the initial load.
    private int? _pendingArticleId;
    private DateTime _lastLongPressTime = DateTime.MinValue;
    private int _pressedPasukNum = -1;
    private CancellationTokenSource? _longPressTokenSource;
    private const int LongPressDurationMs = 600;

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

    // Scroll state tracking - used to prevent long-press during scroll
    private DateTime _lastScrollTime = DateTime.MinValue;
    private const int ScrollCooldownMs = 500; // Don't allow long-press within 500ms of scroll

    /// <summary>
    /// Returns true if the user is currently scrolling or just finished scrolling.
    /// Used by LongPressBehavior to prevent false triggers during scroll.
    /// </summary>
    public bool IsScrolling => (DateTime.Now - _lastScrollTime).TotalMilliseconds < ScrollCooldownMs;

    public PerekPage()
    {
        DebugLog.Write("[Startup] PerekPage InitializeComponent");
        InitializeComponent();
        DebugLog.Write("[Startup] PerekPage binding context");
        _viewModel = new PerekViewModel();
        BindingContext = _viewModel;
        SetupReaderChrome();
        DebugLog.Write("[Startup] PerekPage resources and navigation");
        SubscribeViewModelChanges();
        SetupDisplaySync();
        SetupCarousel();
        SetupCarouselNavigation();
        SubscribeAppLinks();
        SetupPlatformChrome();
        DebugLog.Write("[Startup] PerekPage constructed");
    }

    public PerekPage(PerekViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
        SetupReaderChrome();
        SubscribeViewModelChanges();
        SetupDisplaySync();
        SetupCarousel();
        SetupCarouselNavigation();
        SubscribeAppLinks();
        SetupPlatformChrome();
    }

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
                Carousel = PerekCarousel,
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
    /// division adapters differ: perek ids, perek articles, perek navigation.
    /// </summary>
    private void SetupReaderChrome()
    {
        _chrome = new ReaderChrome(
            new ReaderChromeSurfaces
            {
                BottomBar = BottomBar,
                PerushimSheet = PerushimPanel,
                FanMenu = FanMenu,
                PreviousSatellite = PrevPerekButton,
                NextSatellite = NextPerekButton,
                ExitFullscreenButton = ExitFullScreenButton,
                ArticlesView = ArticlesCollection,
                ReaderContent = PerekCarousel,
                // The perek hairline rides the reading content — the swap
                // hides it while the articles view is up (#3364).
                ReadingProgressIndicator = ReadingProgressBar,
                Toolbar = ReaderToolbar,
                Host = MainGrid,
                ContentArea = ContentArea,
            },
            new ReaderChromeActions
            {
                ReloadArticlesAsync = () => { LoadArticles(); return Task.CompletedTask; },
                CurrentUnit = () => _viewModel.Perek,
                SelectArticle = id => _viewModel.SelectedArticleId = id,
                CanGoPrevious = () => _viewModel.CanGoToPreviousPerek,
                CanGoNext = () => _viewModel.CanGoToNextPerek,
                IsSelectableUnit = perekId => perekId is >= 1 and <= 929,
                CurrentUnitId = () => _viewModel.PerekId,
                NavigateToUnitAsync = perekId => _viewModel.NavigateToPerekAsync(perekId),
                FullscreenStateChanged = OnReaderFullscreenStateChanged,
            });
    }

    /// <summary>
    /// Perek extras after a fullscreen transition: the search surface closes on
    /// entry, the reader keeps no native Back affordance, and Android's
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
    /// the division plugs differ: which pasuk list is loaded, the focused-pasuk
    /// extras, and the perek notes reload.
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
                LoadedPasukim = () => _viewModel.CarouselPerakim
                    .SelectMany(perek => perek.Pasukim ?? Enumerable.Empty<Pasuk>()),
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
                ReloadNotesAsync = () => _viewModel.LoadPerushimAsync(_viewModel.PerekId),
            });
    }

    /// <summary>
    /// Wires the shared carousel coordinator (#2573) — programmatic-scroll
    /// guard, rotation resnap and the Android swipe settle — through the one
    /// implementation every reader page uses. Only the division plugs differ:
    /// the suppression extras (articles/focused pasuk/search) and the
    /// perek-typed long-press arming.
    /// </summary>
    private void SetupCarousel()
    {
        _carousel = new ReaderCarousel(
            new ReaderCarouselSurfaces
            {
                Carousel = PerekCarousel,
                LoadingOverlay = CarouselLoadingOverlay,
                FanMenu = FanMenu,
                SwipeExcluded = [BottomBar, PerushimPanel, ExitFullScreenButton, PerekPickerPopup],
                PressExcluded = [FanMenu.ToggleButton, SelectionBar],
            },
            new ReaderCarouselActions
            {
                CurrentPosition = () => _viewModel.CarouselPosition,
                ItemCount = () => _viewModel.CarouselPerakim.Count,
                IsLoading = () => _isLoading,
                IsSwipeSuppressed = () => _chrome.IsShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen,
#if ANDROID
                ArmUnreceivedPress = (x, y) => LongPressBehavior.BeginUnreceivedPress(x, y, _viewModel.Perek),
#endif
            });
    }

    /// <summary>
    /// Subscribes to ViewModel.NavigationRequested so that programmatic
    /// navigation (prev/next/today/picker) jumps the CarouselView instantly
    /// instead of animating through every intermediate position (which would
    /// cascade OnCarouselItemChanged). The guarded scroll itself is the shared
    /// carousel coordinator's (#2573); the perek id to index mapping is the
    /// division adapter.
    /// </summary>
    private void SetupCarouselNavigation()
    {
        InitializeSearchHeader();
        ChapterSearch.SearchOpenChanged += OnChapterSearchOpenChanged;
        ChapterSearch.SetSource(_viewModel.Source);
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PerekViewModel.Source))
            {
                ChapterSearch.SetSource(_viewModel.Source);
            }
        };
        _viewModel.NavigationRequested += (_, perekId) =>
        {
            ResetRecitationSession();
            _carousel.ScrollToUnit(perekId - 1);

            // Post-navigation housekeeping (ViewModel state is already set by
            // NavigateToPerekAsync before this event fires, including perushim)
            UpdateSelectionBar();
            SetAnalyticsScreenForPerek();
            _chrome.RefreshPrevNext();

            UpdateArticlesCount();
            _ = _viewModel.PreloadAdjacentPasukimAsync(perekId);
        };
    }

    private void SubscribeViewModelChanges()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            // When perek changes via prev/next, refresh articles, badge, and nav button visuals
            if (e.PropertyName == nameof(PerekViewModel.Perek) || e.PropertyName == "Perek")
            {
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    UpdateArticlesCount();
                    if (_chrome.IsShowingArticles)
                    {
                        LoadArticles();
                    }
                    _chrome.RefreshPrevNext();
                });
            }
        };
    }

    protected override void OnDisappearing()
    {
        FinishSearchIntroduction();
        _platformChrome.Disappearing();
        _carousel.Disappearing();
        if (!_preserveSearchOnDisappear)
        {
            ChapterSearch.Close();
        }
        ResetRecitationSession();
        PreferencesService.Instance.PreferencesChanged -= OnRecitationPreferencesChanged;
        RecitationService.Instance.Changed -= OnRecitationPackageChanged;
        RecitationService.Instance.PlaybackStopRequested -= OnPlaybackStopRequested;
        base.OnDisappearing();
    }

    /// <summary>
    /// Tracks scroll events to prevent long-press during scroll, and feeds the
    /// stored-metric reading position (issue #2607).
    /// </summary>
    private void OnPasukimScrolled(object? sender, ItemsViewScrolledEventArgs e)
    {
        _doubleTap.Reset();
        _lastScrollTime = DateTime.Now;
        _longPressTokenSource?.Cancel();
        _pressedPasukNum = -1;
#if !ANDROID
        // Android cancels the active press once its own touch moves beyond slop.
        // A scroll event from a previous fling must not cancel a new hold, and
        // walking every verse behavior on every scroll frame causes jank.
        LongPressBehavior.CancelAllPending();
#endif
        UpdateReadingProgress(sender as CollectionView, e);
    }

    /// <summary>
    /// Maps the virtualized list's item indices onto the stored pasuk metrics:
    /// the first visible pasuk anchors the reading position, and the content
    /// end inside the viewport reads as complete — the app granularity of the
    /// web engine's anchor rule (issue #2607).
    /// </summary>
    private void UpdateReadingProgress(CollectionView? list, ItemsViewScrolledEventArgs e)
    {
        if (list?.ItemsSource is not IReadOnlyList<PasukDisplayItem> items || items.Count == 0)
        {
            return;
        }
        var anchorIndex = Math.Clamp(e.FirstVisibleItemIndex, 0, items.Count - 1);
        var contentEndVisible = e.LastVisibleItemIndex >= items.Count - 1;
        _viewModel.UpdateReadingProgress(items[anchorIndex].PasukNum, contentEndVisible);
    }

    protected override async void OnAppearing()
    {
        DebugLog.Write("[Startup] PerekPage appearing");
        base.OnAppearing();
        _platformChrome.Appearing();
        _carousel.Appearing();
        SubscribeRecitation();
        await InitializeRecitationAsync();
        DebugLog.Write("[Startup] PerekPage recitation initialized");
        // If no perek is loaded, load perek based on preference (today's or last learnt)
        if (_viewModel.Perek == null && !_isLoading)
        {
            _isLoading = true;
            try
            {
                await LoadInitialPerekAsync();
            }
            catch (Exception ex) //NOSONAR — failure boundary: any load failure lands on the retryable error panel instead of crashing the reader.
            {
                // A load that cannot complete surfaces a retryable error instead
                // of leaving the spinner up forever (issue #2084) — unless a
                // newer navigation already put a perek on screen, in which case
                // this failure is stale and must not cover it.
                Console.Error.WriteLine($"Failed to load perek: {ex}");
                if (_viewModel.Perek == null)
                {
                    CarouselLoadingOverlay.ShowError(ex);
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
        else if (_viewModel.PerekId > 0 && !_isLoading)
        {
            // An already-running reader may still get a ?perekId= query
            // (e.g. a calendar day tap): honor it like a fresh load.
            if (_pendingPerekId is int pendingPerek &&
                pendingPerek != _viewModel.PerekId)
            {
                _pendingPerekId = null;
                await _viewModel.NavigateToPerekAsync(pendingPerek);
            }
            else
            {
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

    /// <summary>
    /// Runs the full first-load sequence for this reader: resolve the perek to
    /// open, wait out the bounded ViewModel load, snap the carousel, then apply
    /// the search-reader landing. Throws whatever the load throws — the caller
    /// turns that into the retryable error overlay.
    /// </summary>
    private async Task LoadInitialPerekAsync()
    {
        _initialPerekId ??= GetInitialPerekId();
        var perekId = _initialPerekId.Value;
        DebugLog.Write($"[PerekLoad] fresh load start perekId={perekId}");
        CarouselLoadingOverlay.ShowLoading();

        // Guard: ignore OnCarouselItemChanged during initial load.
        // The CarouselView fires spurious CurrentItemChanged events when it
        // first receives its ItemsSource, which would reset state.
        _carousel.IsInitializing = true;
        long? loadStamp;
        try
        {
            loadStamp = await _viewModel.LoadByPerekIdAsync(perekId);
            if (loadStamp is null)
            {
                // A newer load or navigation superseded this one mid-flight —
                // it owns the reader now, so skip the scroll and landing below.
                return;
            }

            // CarouselView resets Position to 0 when ItemsSource changes.
            // Force it to the correct position without animation.
            var targetPos = _viewModel.PerekId - 1;
            PerekCarousel.ScrollTo(targetPos, animate: false);

            // Yield so the CarouselView processes the scroll + layout pass.
            await Task.Delay(50);

            // A navigation during layout owns the reader now. Check before
            // writing the carousel position as well as the search landing.
            if (_viewModel.ReaderLoadStamp != loadStamp)
            {
                return;
            }

            // Sync the ViewModel position (two-way binding may lag)
            _viewModel.CarouselPosition = targetPos;
        }
        finally
        {
            _carousel.IsInitializing = false;
        }

        // Hide loading overlay — carousel is ready
        CarouselLoadingOverlay.Hide();

        await ApplySearchReaderLocationAsync();
        _ = _viewModel.PreloadAdjacentPasukimAsync(_viewModel.PerekId);
        StartSearchIntroduction();

        // Update articles count badge
        UpdateArticlesCount();

        // A cold-start link may also carry an article to open.
        if (_pendingArticleId is int pendingArticleId)
        {
            _pendingArticleId = null;
            await ShellAppNavigator.Instance.GoToAsync($"articleDetail?articleId={pendingArticleId}");
        }
    }

    /// <summary>
    /// Updates the articles count badge for the current perek from the
    /// StarterService startup counters — a swipe never issues a network request
    /// just to redraw the badge.
    /// </summary>
    private void UpdateArticlesCount()
    {
        try
        {
            BottomBar.ArticlesBadgeCount =
                StarterService.Instance.GetDailyPerekArticlesCount(_viewModel.PerekId, _dailyDateNum);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-count badge degrades to hidden
        catch (Exception ex) //NOSONAR — articles-count badge degrades to hidden.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error updating articles count: {ex.Message}");
            BottomBar.ArticlesBadgeCount = 0;
        }
    }

    /// <summary>Retry button on the load-failure overlay — re-runs the full fresh load.</summary>
    private async void OnPerekLoadRetryClicked(object? sender, EventArgs e)
    {
        if (_isLoading)
        {
            return;
        }

        _isLoading = true;
        try
        {
            await LoadInitialPerekAsync();
        }
        catch (Exception ex) //NOSONAR — failure boundary: a failed retry must land back on the retryable error panel, not crash the reader.
        {
            Console.Error.WriteLine($"Perek load retry failed: {ex}");
            // Same staleness rule as the initial load: a navigation that
            // succeeded meanwhile owns the reader now.
            if (_viewModel.Perek == null)
            {
                CarouselLoadingOverlay.ShowError(ex);
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
    /// An app link that arrived while the reader was open (warm link), or while
    /// a flyout page was on top. Pops back to the reader and jumps to the perek.
    /// </summary>
    /// <summary>
    /// App-link subscription. The handler lives on a static event, so it must be
    /// released when the page unloads — otherwise readers recreated by Shell
    /// keep collecting handlers that navigate obsolete pages.
    /// </summary>
    private void SubscribeAppLinks()
    {
        AppLinkHelper.TargetRequested += OnAppLinkRequested;
        Unloaded += (_, _) => AppLinkHelper.TargetRequested -= OnAppLinkRequested;
    }

    private void OnAppLinkRequested(object? sender, AppLinkHelper.AppLinkTarget target)
    {
        // Only the original reader handles app links; search readers are pushed
        // above it and must not compete to navigate a page that has been popped.
        if (Shell.Current?.Navigation.NavigationStack.OfType<PerekPage>().FirstOrDefault() is { } rootReader && rootReader != this)
        {
            return;
        }
        if (Handler is null)
        {
            // Dead page left over from a Shell recreation; detach instead of
            // navigating an obsolete reader.
            AppLinkHelper.TargetRequested -= OnAppLinkRequested;
            return;
        }

        // Last link wins: a newer request supersedes any earlier one still
        // waiting out the initial load.
        var generation = Interlocked.Increment(ref _appLinkGeneration);
        _ = Dispatcher.DispatchAsync(async () =>
        {
            for (var i = 0; i < 100 && _isLoading && generation == _appLinkGeneration; i++)
            {
                await Task.Delay(100);
            }
            if (generation != _appLinkGeneration)
            {
                return;
            }
            try
            {
                ChapterSearch.Close();
                var shell = Shell.Current;
                if (shell != null &&
                    !shell.CurrentState.Location.OriginalString.EndsWith(AppRoutes.Perek, StringComparison.Ordinal))
                {
                    // A link is dependent navigation, not a repeated tap:
                    // queue behind any in-flight transition so the
                    // return-to-reader request cannot be deduplicated away.
                    await ShellAppNavigator.Instance.GoToQueuedAsync(AppRoutes.FlyoutPage(AppRoutes.Perek));
                }
                if (generation != _appLinkGeneration)
                {
                    // A newer link arrived while this one waited out a
                    // transition or the initial load — it owns the reader now.
                    return;
                }
                // The destination is reached: consume the pending target so a
                // later reader creation cannot re-apply it. Clearing it only
                // here also keeps the target recoverable when navigation fails.
                AppLinkHelper.PendingTarget = null;
                await _viewModel.NavigateToPerekAsync(target.PerekId);
                // A link that landed while the load-failure panel was up replaces
                // it with the freshly navigated perek.
                CarouselLoadingOverlay.Hide();
                if (target.ArticleId is int articleId && Shell.Current != null)
                {
                    await ShellAppNavigator.Instance.GoToQueuedAsync($"articleDetail?articleId={articleId}");
                }
                else if (target.PasukNumber is int pasukNum)
                {
                    // The link names a pasuk (?pasuk=N / #pasuk-N) — land on it
                    // the way a pasuk search result does (#1227).
                    _searchReaderResult = new PasukSearchResult(
                        new Pasuk { PasukNum = pasukNum, Text = string.Empty },
                        target.PerekId, string.Empty);
                    await ApplySearchReaderLocationAsync();
                }
            }
            #pragma warning disable S2221 // Deliberate failure boundary: app-link navigation failure is log-only
            catch (Exception ex) //NOSONAR — app-link navigation failure is log-only.
            {
                #pragma warning restore S2221
                Console.Error.WriteLine($"App-link navigation failed: {ex}");
            }
        });
    }

    private int GetInitialPerekId()
    {
        // A perek explicitly requested by navigation (e.g. calendar day tap)
        // wins over search-reader and preference defaults.
        if (_pendingPerekId is int pendingPerek)
        {
            _pendingPerekId = null;
            return pendingPerek;
        }
        if (_searchReaderResult is { } result)
        {
            return GetSearchPerekId(result);
        }
        // A link that opened the app (cold start) wins over preferences.
        if (AppLinkHelper.PendingTarget is { } pendingTarget)
        {
            AppLinkHelper.PendingTarget = null;
            _pendingArticleId = pendingTarget.ArticleId;
            if (pendingTarget.ArticleId is null && pendingTarget.PasukNumber is int coldPasuk)
            {
                // A pasuk-anchored link lands on the pasuk like a pasuk search
                // result once the initial load settles (#1227).
                _searchReaderResult = new PasukSearchResult(
                    new Pasuk { PasukNum = coldPasuk, Text = string.Empty },
                    pendingTarget.PerekId, string.Empty);
            }
            return pendingTarget.PerekId;
        }

        var prefs = PreferencesService.Instance;
        if (prefs.PerekToLoad == PerekToLoad.Todays)
        {
            if (PerekDataService.Instance.IsLoaded)
            {
                return PerekDataService.Instance.GetTodaysPerekId();
            }

            return 1; // Fallback if tanah not loaded (LoadingPage loads it, but race possible)
        }
        var last = prefs.LastLearntPerek;
        return last is > 0 and <= 929 ? last.Value : 1;
    }

    protected override void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);
        SetAnalyticsScreenForPerek();
    }



    /// <summary>
    /// The reader reports its own logical screen (AlHaperek/{perekId}) from
    /// page lifecycle and carousel swipes — transitions a Shell-level
    /// screen_view would double-count — so the Shell report is suppressed.
    /// </summary>
    public string? AnalyticsScreenName => null;

    /// <summary>
    /// Logs current perek screen to analytics (legacy-style: AlHaperek/{perekId}).
    /// </summary>
    private void SetAnalyticsScreenForPerek()
    {
        var analytics = Microsoft.Maui.Controls.Application.Current?.Handler?.MauiContext?.Services.GetService<IAnalyticsService>();
        analytics?.SetScreen($"AlHaperek/{_viewModel.PerekId}", "PerekPage");
    }

    /// <summary>
    /// Handles tap on pasuk - toggles selection if in selection mode.
    /// </summary>
    private async void OnPasukTapped(object? sender, TappedEventArgs e)
    {
        if (ChapterSearch.IsSearchOpen)
        {
            ChapterSearch.Close();
            return;
        }
#if ANDROID
        // On Android, taps are handled natively via LongPressBehavior.NativeTapped
        // because (a) MAUI's TapGestureRecognizer fails in nested CarouselView >
        // CollectionView and (b) with e.Handled=true on Down the MAUI gesture also
        // fires after a long-press release, immediately undoing the selection.
        await Task.CompletedTask;
        return;
#else
        // Cancel any pending long-press timers
        LongPressBehavior.CancelAllPending();

        // Skip tap if long press just happened (prevents tap-on-release from toggling selection off)
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
        {
            return;
        }

        // If in selection mode, tap toggles selection
        if (e.Parameter is int pasukNum
            && _viewModel.Perek?.Pasukim.FirstOrDefault(p => p.PasukNum == pasukNum) is { } pasuk)
        {
            await HandlePasukTapAsync(pasuk);
        }
#endif
    }

    /// <summary>
    /// Native tap handler fired by LongPressBehavior on Android.
    /// MAUI's TapGestureRecognizer fails inside nested CarouselView > CollectionView
    /// DataTemplates, so we detect taps via the same native Touch event that the
    /// long-press behavior already hooks into.
    /// </summary>
    private async void OnPasukNativeTapped(object? sender, EventArgs e)
    {
        if (ChapterSearch.IsSearchOpen)
        {
            ChapterSearch.Close();
            return;
        }
        // Skip tap if long press just happened
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
        {
            return;
        }

        // Get the Pasuk from the behavior's associated view (the Border)
        if (sender is LongPressBehavior behavior &&
            ResolvePasuk(behavior.AssociatedView?.BindingContext) is { } pasuk)
        {
            await HandlePasukTapAsync(pasuk);
        }
    }

    /// <summary>
    /// Resolves the logical pasuk behind a row's BindingContext — rows bind to
    /// <see cref="PasukDisplayItem"/> so שניים מקרא copies map to the same pasuk.
    /// </summary>
    private static Pasuk? ResolvePasuk(object? bindingContext) => bindingContext switch
    {
        PasukDisplayItem item => item.Pasuk,
        Pasuk pasuk => pasuk,
        _ => null
    };

    /// <summary>
    /// Handles right-click on pasuk - enters selection mode (Windows only).
    /// </summary>
    private void OnPasukRightClicked(object? sender, TappedEventArgs e)
    {
#if WINDOWS
        if (e.Parameter is int pasukNum)
        {
            // Don't set _lastLongPressTime - right-click doesn't need debounce
            // Entering selection must not kill in-flight playback or its moving
            // word marker (#2473).
            ResetRecitationContext(stopPlayback: false);
            var wasEmpty = _viewModel.SelectedPasukNums.Count == 0;
            _viewModel.ToggleSelectedPasuk(pasukNum);
            UpdatePasukSelection();
            // Vibrate when entering selection mode
            if (wasEmpty && _viewModel.SelectedPasukNums.Count > 0)
            {
                TriggerHapticFeedback();
            }
        }
#endif
    }

    /// <summary>
    /// Handles pointer press - starts long-press timer.
    /// </summary>
    private void OnPasukPointerPressed(object? sender, PointerEventArgs e)
    {
        // Mobile platforms use native long-press recognition.
        if (OperatingSystem.IsAndroid() || OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst())
        {
            return;
        }

        // Don't start long-press detection if scrolling
        if (IsScrolling)
        {
            return;
        }

        _longPressTokenSource?.Cancel();
        _longPressTokenSource?.Dispose();
        _longPressTokenSource = new CancellationTokenSource();

        if (sender is Border border && ResolvePasuk(border.BindingContext) is { } pasuk)
        {
            _pressedPasukNum = pasuk.PasukNum;

            // Start long-press detection
            _ = DetectLongPressAsync(pasuk.PasukNum, _longPressTokenSource.Token);
        }
    }

    /// <summary>
    /// Handles pointer release - cancels long-press timer.
    /// </summary>
    private void OnPasukPointerReleased(object? sender, PointerEventArgs e)
    {
        _longPressTokenSource?.Cancel();
        _pressedPasukNum = -1;
    }

    /// <summary>
    /// Detects long press after duration.
    /// </summary>
    private async Task DetectLongPressAsync(int pasukNum, CancellationToken token)
    {
        try
        {
            await Task.Delay(LongPressDurationMs, token);

            // If we get here, the press was held long enough
            // Double-check we're not scrolling and pasuk is still pressed
            if (!token.IsCancellationRequested && _pressedPasukNum == pasukNum && !IsScrolling)
            {
                _lastLongPressTime = DateTime.Now;

                ResetRecitationContext(stopPlayback: false);
                var wasEmpty = _viewModel.SelectedPasukNums.Count == 0;
                _viewModel.ToggleSelectedPasuk(pasukNum);

                // Must run on UI thread
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    UpdateSelectionBar();
                    // Vibrate when entering selection mode
                    if (wasEmpty && _viewModel.SelectedPasukNums.Count > 0)
                    {
                        TriggerHapticFeedback();
                    }
                });
            }
        }
        catch (TaskCanceledException)
        {
            // Press was released before long press duration - ignore
        }
    }

    /// <summary>
    /// Handles long press on pasuk via custom LongPressBehavior - enters selection mode (Android).
    /// </summary>
    private void OnPasukLongPressed(object? sender, EventArgs e)
    {
#if ANDROID || IOS || MACCATALYST
        _lastLongPressTime = DateTime.Now;

        // The sender is the LongPressBehavior - get the Pasuk from the associated view's BindingContext
        if (sender is LongPressBehavior behavior &&
            ResolvePasuk(behavior.AssociatedView?.BindingContext) is { } pasuk)
        {
            ResetRecitationContext(stopPlayback: false);
            var wasEmpty = _viewModel.SelectedPasukNums.Count == 0;
            _viewModel.ToggleSelectedPasuk(pasuk.PasukNum);
            UpdateSelectionBar();
            // Vibrate when entering selection mode
            if (wasEmpty && _viewModel.SelectedPasukNums.Count > 0)
            {
                TriggerHapticFeedback();
            }
        }
#endif
    }

    /// <summary>
    /// Updates the selection bar after selection change.
    /// The visual state is handled by DataTrigger in XAML.
    /// </summary>
    private void UpdatePasukSelection()
    {
        UpdateSelectionBar();
    }

    #region Selection Bar Methods

    private void UpdateSelectionBar()
    {
        if (_viewModel == null)
        {
            return;
        }

        var count = _viewModel.SelectedPasukNums.Count;
        var focused = _focusedPasuk != null;
        // The focused pasuk keeps the shared reader toolbar (full pasuk source,
        // scoped search, #2466); the Back-only selection bar is for the other
        // transient surfaces — a pesukim selection, the chapter recitation
        // mode, or an in-flight clip with no focused pasuk (#2370).
        var selectionBarMode = ReaderSurfaceState.ShowsSelectionBar(count, _chapterRecitationSelection,
            focused, _recitationCursor.PlayingKey != null);
        ChapterSearch.SetFocusedPasukScope(focused);
        var ordinarySelection = count > 0 && !_chapterRecitationSelection && _focusedPasuk == null;
        SelectionBar.SetSelectionActionsVisible(ordinarySelection);
        SelectionBar.SetRecitationVisible(RecitationAvailable);
        var perek = _viewModel.Perek;
        var track = perek == null ? null : RecitationService.Instance.GetTrack(perek.PerekId);
        // An active playback can always be paused — even for a perek whose word
        // timings are still pending (chapter playback needs no alignment).
        var recitationEnabled = !_recitationBusy && perek != null && RecitationService.Instance.HasAudio(perek.PerekId) &&
            track != null && (_recitationCursor.PlayingKey != null ||
                (track.Matches(perek.Pasukim) && (_chapterRecitationSelection || track.AlignmentStatus == "ready")));
        // The glyph must match what the button does: only bar-issued playback
        // pauses, so a word preview still playing shows Play (it starts the
        // chapter at the bookmark), like the website's preview state.
        var recitationVisual =
            RecitationPlayer?.CurrentState == CommunityToolkit.Maui.Core.MediaElementState.Playing && _recitationCursor.BarIssued
                ? ReaderSelectionBar.RecitationVisual.Pause
                : RecitationPlayer?.CurrentState is CommunityToolkit.Maui.Core.MediaElementState.Playing or CommunityToolkit.Maui.Core.MediaElementState.Paused
                    ? ReaderSelectionBar.RecitationVisual.Resume : ReaderSelectionBar.RecitationVisual.Play;
        var hint = _recitationBusy ? "טוען את הקלטת הפרק..." : track == null ? "אין הקלטה לפרק זה" :
            !RecitationService.Instance.HasAudio(track.PerekId) ? "הורידו את הקלטות הספר בהעדפות" :
            !_chapterRecitationSelection && track.AlignmentStatus != "ready" && _recitationCursor.PlayingKey == null ? "הקראת מילים ופסוקים אינה זמינה" :
            recitationEnabled ? "הקראה" : "ההקלטה אינה תואמת לטקסט המותקן";
        SelectionBar.SetRecitationState(recitationEnabled, recitationVisual, hint);

        var searching = ChapterSearch.IsSearchOpen;
        Shell.SetNavBarIsVisible(this, false);
        ReaderToolbar.IsVisible = !ExitFullScreenButton.IsVisible;
        (Shell.Current as AppShell)?.SetPageNavHidden(this, selectionBarMode || searching);
        Shell.SetBackButtonBehavior(this, new BackButtonBehavior { IsVisible = !searching });
        // Selection mode paints the shared accent over the whole band; otherwise
        // bind the reader band colors so a theme flip repaints both surfaces.
        if (selectionBarMode)
        {
            var primary = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];
            Shell.SetBackgroundColor(this, primary);
            ReaderToolbar.BackgroundColor = primary;
        }
        else
        {
            this.SetAppThemeColor(Shell.BackgroundColorProperty, SharedTopBar.BandLight, SharedTopBar.BandDark);
            // SharedTopBar, not VisualElement — the iOS-specific using alias
            // shadows VisualElement on net10.0-ios.
            ReaderToolbar.SetAppThemeColor(SharedTopBar.BackgroundColorProperty, SharedTopBar.BandLight, SharedTopBar.BandDark);
        }
        NormalNavigationBar.BarVisible = !selectionBarMode && !searching;
        // The header names the focused pasuk — sefer, perek and pasuk together —
        // instead of the plain perek source (#2466).
        if (focused)
        {
            NormalNavigationTitle.Text = $"{_viewModel.Source} {_focusedPasuk!.PasukNumHeb}";
        }
        else
        {
            // Selection updates also run before the first chapter finishes loading.
            // Keep the source binding alive so that a null startup value cannot
            // leave the chapter title blank, and later swipes update it as well.
            NormalNavigationTitle.SetBinding(Button.TextProperty, nameof(PerekViewModel.Source));
        }
        // The capsule Back covers the focused-pasuk return on every platform
        // (#2467) — the hamburger glyph and its flyout role never change.
        NormalNavigationBar.RefreshBackState();
        SearchTitleHost.IsVisible = searching;
        SearchTitleHost.Content = searching ? _searchHeader : null;
        ChapterSearch.IsVisible = searching;
        ContentArea.IsVisible = !searching;
        SelectionBar.IsVisible = selectionBarMode && !searching;
        SelectionBar.SetCount(count);
    }

    private void ClearAllSelections()
    {
        // Closing the focused pasuk keeps playback going (the bar is still
        // visible); leaving selection or chapter mode stops it.
        ResetRecitationContext(stopPlayback: _focusedPasuk == null);
        _viewModel.ClearSelected();
        UpdateSelectionBar();
    }

    private void OnSelectionBackClicked(object? sender, EventArgs e)
    {
        ClearAllSelections();
    }

    private async void OnSelectionShareClicked(object? sender, EventArgs e)
    {
        var text = GetSelectedPesukimText();
        if (!string.IsNullOrEmpty(text))
        {
            await Share.RequestAsync(new ShareTextRequest { Text = text, Title = _viewModel.Source });
        }
    }

    private async void OnSelectionCopyClicked(object? sender, EventArgs e)
    {
        var text = GetSelectedPesukimText();
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        await Clipboard.SetTextAsync(text);
        TriggerHapticFeedback();
        await SelectionBar.FlashCopiedAsync();
    }

    private string GetSelectedPesukimText()
    {
        if (_viewModel.Perek == null)
        {
            return string.Empty;
        }

        var selected = _viewModel.Perek.Pasukim?
            .Where(p => _viewModel.IsPasukSelected(p.PasukNum))
            .OrderBy(p => p.PasukNum)
            .ToList();
        if (selected == null || selected.Count == 0)
        {
            return string.Empty;
        }

        var lines = selected.Select(p => $"{p.PasukNumHeb}. {p.Text}");
        return $"{_viewModel.Source}\n\n{string.Join("\n", lines)}";
    }

    #endregion

    /// <summary>
    /// Triggers haptic feedback (vibration) for selection mode entry.
    /// </summary>
    private static void TriggerHapticFeedback()
    {
        try
        {
#if ANDROID
            Vibration.Vibrate(TimeSpan.FromMilliseconds(50));
#elif IOS
            HapticFeedback.Perform(HapticFeedbackType.LongPress);
#endif
        }
        #pragma warning disable S2221 // Deliberate failure boundary: haptic feedback is best-effort
        catch (Exception ex) //NOSONAR — haptic feedback is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Haptic feedback failed: {ex.Message}");
        }
    }

    #region Circular Menu Methods

    /// <summary>
    /// Handles menu item click - keeps menu open (don't close).
    /// </summary>
    private void OnMenuItemClicked(object? sender, EventArgs e)
    {
        // Menu stays open - user can click multiple satellites
        // Menu closes only when clicking the hamburger button again
    }

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
        || ReaderSurfaceState.IsActive(_viewModel.SelectedPasukNums.Count,
            _chapterRecitationSelection, _focusedPasuk != null,
            _recitationCursor.PlayingKey != null);

    /// <summary>
    /// Opens/closes the reader options menu (הקראות, שניים מקרא, תיקון קוראים).
    /// </summary>
    private void OnReaderMenuButtonClicked(object? sender, EventArgs e) => ReaderMenuOverlay.Toggle();

    /// <summary>
    /// קריינות header play button - plays the whole perek's recording.
    /// </summary>
    private async void OnHeaderPlayClicked(object? sender, EventArgs e)
    {
        if (_viewModel.Perek is { } perek)
        {
            await PlayRecitationAsync($"chapter:{perek.PerekId}");
        }
    }

    /// <summary>
    /// שניים מקרא menu item - toggles double rendering of every pasuk.
    /// </summary>
    private void OnShnayimMikraTapped(object? sender, EventArgs e)
    {
        _viewModel.IsShnayimMikraEnabled = !_viewModel.IsShnayimMikraEnabled;
    }

    /// <summary>
    /// תיקון קוראים menu item - toggles the continuous reading flow.
    /// </summary>
    private void OnTikkunKorimTapped(object? sender, EventArgs e)
    {
        _viewModel.IsTikkunKorimEnabled = !_viewModel.IsTikkunKorimEnabled;
    }

    /// <summary>
    /// הסתר שם השם menu item - toggles divine-name display masking. The change
    /// persists through PreferencesService and bumps DivineNameMasking.Revision,
    /// which the pasukim MultiBinding and TikkunFlowView pick up to re-render.
    /// </summary>
    private void OnDivineNameMaskingTapped(object? sender, EventArgs e)
    {
        _viewModel.DivineNameMaskingEnabled = !_viewModel.DivineNameMaskingEnabled;
    }

    /// <summary>
    /// Tap on the תיקון קוראים text - toggles niqqud+taamim for the entire perek.
    /// Runs on a dedicated view so it cannot trigger selection, playback or navigation.
    /// </summary>
    private void OnTikkunTextTapped(object? sender, TappedEventArgs e)
    {
#if ANDROID
        // On Android, taps are handled natively via LongPressBehavior.NativeTapped —
        // MAUI's TapGestureRecognizer fails inside nested CarouselView templates.
        return;
#else
        _viewModel.TikkunMarksHidden = !_viewModel.TikkunMarksHidden;
#endif
    }

    /// <summary>
    /// Native tap on the תיקון קוראים flow — fires from LongPressBehavior on Android.
    /// </summary>
    private void OnTikkunNativeTapped(object? sender, EventArgs e)
    {
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

    /// <summary>
    /// Shows the perek picker popup.
    /// </summary>
    private void OnPerekPickerClicked(object? sender, EventArgs e)
    {
        // Menu stays open - don't close
        // Show the cascading perek picker popup with current perek pre-selected
        PerekPickerPopup.Show(_viewModel.PerekId);
    }

    /// <summary>
    /// Handles perek selection from the picker popup — the shared chrome
    /// completes the cleanup (fan closes) and navigates via the perek adapter.
    /// </summary>
    private async void OnPerekPickerSelected(int perekId) =>
        await _chrome.CompletePickerSelectionAsync(perekId);

    /// <summary>
    /// Loads articles for the current perek from the StarterService snapshot —
    /// same Priority ordering and Author wiring the GraphQL query produced.
    /// The shared chrome calls this through its ReloadArticlesAsync adapter
    /// when the articles view opens or the perek changes underneath it.
    /// </summary>
    private void LoadArticles()
    {
        try
        {
            ArticlesCollection.ItemsSource = StarterService.Instance.GetDailyArticles(_viewModel.PerekId, _dailyDateNum);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles list degrades to empty
        catch (Exception ex) //NOSONAR — articles list degrades to empty.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error loading articles: {ex.Message}");
            ArticlesCollection.ItemsSource = new List<Article>();
        }
    }

    /// <summary>
    /// Handles carousel item changed after a swipe.
    /// The carousel collection is NEVER modified here - all items are pre-loaded in the window.
    /// This avoids MAUI CarouselView position/item desync bugs.
    /// </summary>
    private async void OnCarouselItemChanged(object? sender, CurrentItemChangedEventArgs e)
    {
        // During initial collection assignment the CarouselView fires spurious
        // CurrentItemChanged events (e.g. for position-0 / bereshit-1).
        // Ignore them — the ViewModel already holds the correct perek.
        if (_carousel.IsInitializing)
        {
            DebugLog.Write($"[Carousel] OnChanged IGNORED (initializing)");
            return;
        }

        var incomingId = (e.CurrentItem as Perek)?.PerekId ?? -1;
        var previousId = (e.PreviousItem as Perek)?.PerekId ?? -1;

        if (e.CurrentItem is not Perek perek || perek.PerekId <= 0 || perek.PerekId == _viewModel.PerekId)
        {
            DebugLog.Write($"[Carousel] OnChanged SKIPPED incoming={incomingId} vmPerek={_viewModel.PerekId}");
            return;
        }

        LongPressBehavior.CancelAllPending();
        _longPressTokenSource?.Cancel();
        _pressedPasukNum = -1;

        ResetRecitationSession();

        var hasPasukim = perek.Pasukim != null && perek.Pasukim.Count > 0;
        DebugLog.Write($"[Carousel] OnChanged PROCESS incoming={incomingId} prev={previousId} vmPerek={_viewModel.PerekId} pos={_viewModel.CarouselPosition} hasPasukim={hasPasukim}");

        // Lazy-load pasukim if not yet loaded (~5ms from SQLite, non-blocking)
        if (!hasPasukim)
        {
            await _viewModel.EnsurePasukimLoadedAsync(perek);
        }

        // A timed-out fresh-load attempt may still be running detached — it is
        // now obsolete and must not overwrite the perek this swipe landed on.
        _viewModel.InvalidatePendingLoads();

        // Synchronous state update — fast, no guard needed.
        // The carousel collection is NEVER modified here, so no re-entrancy risk.
        _viewModel.Perek = perek;
        _viewModel.ClearSelected();
        UpdateSelectionBar();
        SetAnalyticsScreenForPerek();

        // Persist the current perek as last learnt so the user can resume here
        _viewModel.SaveLastLearntPerek();

        _chrome.RefreshPrevNext();

        DebugLog.Write($"[Carousel] OnChanged DONE vmPerek={_viewModel.PerekId} pos={_viewModel.CarouselPosition}");

        // Fire async tasks in the background — never block the next swipe
        UpdateArticlesCount();
        _ = _viewModel.LoadPerushimAsync(perek.PerekId);
        _ = _viewModel.PreloadAdjacentPasukimAsync(perek.PerekId);
        if (_chrome.IsShowingArticles)
        {
            LoadArticles();
        }
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
