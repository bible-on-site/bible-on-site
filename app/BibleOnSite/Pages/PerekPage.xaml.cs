namespace BibleOnSite.Pages;

using BibleOnSite.Behaviors;
using BibleOnSite.Controls;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
#if IOS
using Microsoft.Maui.Controls.PlatformConfiguration.iOSSpecific;
#endif

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

    // Articles view state
    private bool _isShowingArticles;

    // Guard: ignore CurrentItemChanged events fired by the CarouselView during
    // initial collection assignment.  Without this, the handler resets the
    // position to bereshit-1 right after we placed it at today's perek.
    private bool _carouselInitializing;

    // Scroll state tracking - used to prevent long-press during scroll
    private DateTime _lastScrollTime = DateTime.MinValue;
    private const int ScrollCooldownMs = 500; // Don't allow long-press within 500ms of scroll

    // Tracks the carousel width so rotation/resize can be detected in SizeChanged.
    private double _carouselWidth = -1;

    // A resize observed while the initial load was running; consumed when it ends.
    private bool _pendingCarouselResnap;

    /// <summary>
    /// Returns true if the user is currently scrolling or just finished scrolling.
    /// Used by LongPressBehavior to prevent false triggers during scroll.
    /// </summary>
    public bool IsScrolling => (DateTime.Now - _lastScrollTime).TotalMilliseconds < ScrollCooldownMs;

    public PerekPage()
    {
        DebugLog.Write("[Startup] PerekPage InitializeComponent");
        InitializeComponent();
#if IOS
        ConfigureReaderSafeArea();
#endif
        DebugLog.Write("[Startup] PerekPage binding context");
        _viewModel = new PerekViewModel();
        BindingContext = _viewModel;
        DebugLog.Write("[Startup] PerekPage resources and navigation");
        SubscribeViewModelChanges();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SubscribeAppLinks();
        SubscribeNotesMaterialization();
        DebugLog.Write("[Startup] PerekPage constructed");
    }

    public PerekPage(PerekViewModel viewModel)
    {
        InitializeComponent();
#if IOS
        ConfigureReaderSafeArea();
#endif
        _viewModel = viewModel;
        BindingContext = _viewModel;
        SubscribeViewModelChanges();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SubscribeAppLinks();
        SubscribeNotesMaterialization();
        NormalNavigationBar.NavigationInterceptor = OnFocusedPasukNavigationIntercepted;
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
    /// Subscribes to ViewModel.NavigationRequested so that programmatic
    /// navigation (prev/next/today/picker) jumps the CarouselView instantly
    /// via ScrollTo(animate:false) instead of animating through every
    /// intermediate position (which would cascade OnCarouselItemChanged).
    /// </summary>
    private void SetupCarouselNavigation()
    {
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
        PerekCarousel.SizeChanged += OnCarouselSizeChanged;
        _viewModel.NavigationRequested += (_, perekId) =>
        {
            ResetRecitationSession();
            var targetIndex = perekId - 1;
            // Guard: suppress OnCarouselItemChanged while we reposition
            _carouselInitializing = true;
            PerekCarousel.ScrollTo(targetIndex, animate: false);
            _carouselInitializing = false;

            // Post-navigation housekeeping (ViewModel state is already set by
            // NavigateToPerekAsync before this event fires, including perushim)
            UpdateSelectionBar();
            SetAnalyticsScreenForPerek();
            if (FanMenu.IsOpen)
            {
                RefreshNavButtonVisuals();
            }

            UpdateArticlesCount();
            _ = _viewModel.PreloadAdjacentPasukimAsync(perekId);
        };
    }

    /// <summary>
    /// Re-snaps the CarouselView when its width changes (device rotation, window
    /// resize). The native carousel keeps the pre-rotation item size, so several
    /// items stay visible side by side until the user swipes. Invalidating the
    /// native layout and re-snapping to the current position restores a single
    /// full-width item immediately.
    /// </summary>
    private void OnCarouselSizeChanged(object? sender, EventArgs e)
    {
        var width = PerekCarousel.Width;
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
        var collectionView = PerekCarousel.Handler?.PlatformView switch
        {
            UIKit.UICollectionView cv => cv,
            UIKit.UIView view => FindDescendantCollectionView(view),
            _ => null,
        };
        collectionView?.CollectionViewLayout.InvalidateLayout();
#elif ANDROID
        if (PerekCarousel.Handler?.PlatformView is AndroidX.RecyclerView.Widget.RecyclerView recyclerView)
        {
            recyclerView.Post(recyclerView.RequestLayout);
        }
#endif
        PerekCarousel.InvalidateMeasure();
        _carouselInitializing = true;
        PerekCarousel.ScrollTo(_viewModel.CarouselPosition, animate: false);
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
    /// Populates page-level DynamicResource entries for font sizes and keeps them
    /// in sync when the user changes the font-factor preference.
    /// DynamicResource is used because x:Reference bindings inside CarouselView
    /// DataTemplates are unreliable on Android.
    /// </summary>
    private void SetupFontSizeResources()
    {
        var prefs = PreferencesService.Instance;
        UpdateFontSizeResources(prefs);
        prefs.PreferencesChanged += (_, _) =>
            MainThread.BeginInvokeOnMainThread(() => UpdateFontSizeResources(prefs));
    }

    // Reading-text category inventory (#2461): פסוקים covers the pasuk body
    // (base 18) and pasuk-number markers (base 16); פירושים covers perush
    // content (base 18 so 100% matches the pasuk body) and perush names
    // (base 14 heading hierarchy).
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
            // When perek changes via prev/next, refresh articles, badge, and nav button visuals
            if (e.PropertyName == nameof(PerekViewModel.Perek) || e.PropertyName == "Perek")
            {
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    UpdateArticlesCount();
                    if (_isShowingArticles)
                    {
                        LoadArticles();
                    }
                    // Force visual refresh of prev/next buttons (workaround for MAUI not updating disabled visual)
                    RefreshNavButtonVisuals();
                });
            }
        };
    }

    /// <summary>
    /// Forces the prev/next buttons to update their visual state.
    /// Workaround for MAUI bug where button disabled visual doesn't refresh in AbsoluteLayout.
    /// We control opacity directly instead of relying on VSM.
    /// </summary>
    private void RefreshNavButtonVisuals()
    {
        // Only update if menu is open (buttons visible)
        if (!FanMenu.IsOpen)
        {
            return;
        }

        var canPrev = _viewModel.CanGoToPreviousPerek;
        var canNext = _viewModel.CanGoToNextPerek;

        PrevPerekButton.IsEnabled = canPrev;
        PrevPerekButton.Opacity = canPrev ? 1.0 : 0.4;

        NextPerekButton.IsEnabled = canNext;
        NextPerekButton.Opacity = canNext ? 1.0 : 0.4;
    }

#if ANDROID
    private readonly SwipeNavigationTracker _swipe = new();

    private void OnTouchStarted(object? sender, TouchPosition position)
    {
        _swipe.Cancel();
        if (_carouselInitializing || CarouselLoadingOverlay.IsVisible || FanMenu.IsOpen || _isShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen ||
            !ContainsTouch(PerekCarousel, position) || ContainsTouch(BottomBar, position) ||
            ContainsTouch(ExitFullScreenButton, position))
        {
            return;
        }
        _swipe.Begin(position, PerekCarousel.Position);
    }

    private void OnTouchDispatched(object? sender, TouchPosition position)
    {
        if (_carouselInitializing || CarouselLoadingOverlay.IsVisible || FanMenu.IsOpen || _isShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen ||
            !ContainsTouch(PerekCarousel, position) || ContainsTouch(BottomBar, position) ||
            ContainsTouch(ExitFullScreenButton, position) || ContainsTouch(FanMenu.ToggleButton, position) ||
            ContainsTouch(SelectionBar, position))
        {
            return;
        }

        LongPressBehavior.BeginUnreceivedPress(position.X, position.Y, _viewModel.Perek);
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
        var slop = PerekCarousel.Handler?.PlatformView is Android.Views.View view
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
        if (PerekCarousel.Handler?.PlatformView is not Android.Views.View view)
        {
            return;
        }

        var configuration = Android.Views.ViewConfiguration.Get(view.Context!);
        var target = _swipe.End(position, view.Width, configuration?.ScaledTouchSlop ?? 12,
            configuration?.ScaledMinimumFlingVelocity ?? 50,
            view.LayoutDirection == Android.Views.LayoutDirection.Rtl, _viewModel.CarouselPerakim.Count);
        if (target is int index)
        {
            // Run after native dispatch, so an intercepted Up/Cancel cannot stop
            // the final snap. ScrollTo also resets MAUI's current snap target.
            PerekCarousel.ScrollTo(index, position: ScrollToPosition.Center, animate: true);
        }
    }
#endif

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
#if IOS
        // A page pushed above gets its native edge-back back (#2432).
        RestoreIosInteractiveBack();
#endif
        base.OnDisappearing();
    }

    /// <summary>
    /// Tracks scroll events to prevent long-press during scroll.
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
    }

    protected override async void OnAppearing()
    {
        DebugLog.Write("[Startup] PerekPage appearing");
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
        DebugLog.Write("[Startup] PerekPage recitation initialized");
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
                if (_pendingCarouselResnap)
                {
                    _pendingCarouselResnap = false;
                    Dispatcher.Dispatch(ResnapCarousel);
                }
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
            await RefreshPerushimIfAvailabilityChangedAsync();
            StartSearchIntroduction();
        }
        // Cold-start main-thread work is done — release the deferred e2e
        // search-index warmup so it cannot starve the accessibility snapshot.
        Services.SearchIndexService.NotifyStartupSettled();
#if IOS
        Dispatcher.Dispatch(ConfigureIosReaderHistory);
#endif
    }

    private void OnReaderListLoaded(object? sender, EventArgs e)
    {
#if IOS
        // Newly realized verse lists must yield the edge gesture to history.
        ConfigureIosReaderHistory();
#endif
    }

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
        _carouselInitializing = true;
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
            _carouselInitializing = false;
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
            await Shell.Current.GoToAsync($"articleDetail?articleId={pendingArticleId}");
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
                StarterService.Instance.GetPerekArticlesCount(_viewModel.PerekId);
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
            if (_pendingCarouselResnap)
            {
                _pendingCarouselResnap = false;
                Dispatcher.Dispatch(ResnapCarousel);
            }
        }
    }

    /// <summary>
    /// Reloads perushim for the current perek when notes-availability changed since the last load
    /// (e.g. the user downloaded the package in Preferences and returned to this page).
    /// </summary>
    private async Task RefreshPerushimIfAvailabilityChangedAsync()
    {
        try
        {
            await PerushimNotesService.Instance.InitializeAsync();
            if (PerushimNotesService.Instance.IsAvailable != _viewModel.PerushimNotesAvailable
                || _viewModel.PerushimNotesPending)
            {
                await _viewModel.LoadPerushimAsync(_viewModel.PerekId);
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: on-appearing refresh is best-effort
        catch (Exception ex) //NOSONAR — on-appearing refresh is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Refresh perushim on appearing failed: {ex}");
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
            AppLinkHelper.PendingTarget = null;
            ChapterSearch.Close();
            var shell = Shell.Current;
            if (shell != null &&
                !shell.CurrentState.Location.OriginalString.EndsWith(AppRoutes.Perek, StringComparison.Ordinal))
            {
                await shell.GoToAsync(AppRoutes.FlyoutPage(AppRoutes.Perek));
            }
            await _viewModel.NavigateToPerekAsync(target.PerekId);
            // A link that landed while the load-failure panel was up replaces
            // it with the freshly navigated perek.
            CarouselLoadingOverlay.Hide();
            if (target.ArticleId is int articleId && Shell.Current != null)
            {
                await Shell.Current.GoToAsync($"articleDetail?articleId={articleId}");
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

#if IOS
    /// <summary>
    /// MAUI pads every Layout inside the device safe area by default
    /// (SafeAreaEdges = Container), and each Layout pads independently —
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
        var totalHeight = 90 + bottom;
        BottomBar.TranslationY = bottom;
        BottomBar.Padding = new Thickness(0, 0, 0, bottom);
        BottomBar.HeightRequest = totalHeight;
        FanMenu.SetBottomInset(bottom);
        this.Padding = new Thickness(0, 0, 0, -bottom);
        Resources["BottomBarTotalHeight"] = totalHeight;

        _ = ScheduleA11yDump();
    }

    // TEMP-DIAG: dump the native a11y flags hiding row-1 elements from XCTest.
    private int _a11yDumpCount;
    private async Task ScheduleA11yDump()
    {
        if (_a11yDumpCount > 0) { return; }
        var delays = new[] { 3000, 12000, 40000 };
        while (_a11yDumpCount < delays.Length)
        {
            var delay = delays[_a11yDumpCount];
            _a11yDumpCount++;
            await Task.Delay(delay);
            var n = _a11yDumpCount;
            MainThread.BeginInvokeOnMainThread(() => DumpA11yTree($"pass{n}"));
        }
    }

    private void DumpA11yTree(string tag)
    {
        try
        {
            var window = UIKit.UIApplication.SharedApplication?.ConnectedScenes
                .OfType<UIKit.UIWindowScene>()
                .FirstOrDefault()?.Windows.FirstOrDefault(w => w.IsKeyWindow);
            if (window is null) { DebugLog.Write($"[A11yDump {tag}] no window"); return; }

            foreach (var w in UIKit.UIApplication.SharedApplication?.Windows ?? System.Linq.Enumerable.Empty<UIKit.UIWindow>())
            {
                var wf = w.Frame;
                DebugLog.Write($"[A11yDump {tag}] win {w.GetType().Name} f={wf.X:0},{wf.Y:0},{wf.Width:0}x{wf.Height:0} " +
                    $"hidden={w.Hidden} alpha={w.Alpha:0.##} lvl={w.WindowLevel} key={w.IsKeyWindow} " +
                    $"eh={KvoBool(w, "accessibilityElementsHidden")} modal={KvoBool(w, "accessibilityViewIsModal")}");
            }

            var carView = PerekCarousel.Handler?.PlatformView as UIKit.UIView;
            var bbView = BottomBar.Handler?.PlatformView as UIKit.UIView;
            DebugLog.Write($"[A11yDump {tag}] PerekId={_viewModel.PerekId} pos={_viewModel.CarouselPosition} " +
                $"perek.Flag={_viewModel.Perek?.IsOffscreenCarouselPage} cur.Flag={_viewModel.CurrentCarouselPerek?.IsOffscreenCarouselPage} " +
                $"cur.Id={_viewModel.CurrentCarouselPerek?.PerekId} carExcluded={AutomationProperties.GetExcludedWithChildren(PerekCarousel)} " +
                $"carEH={(carView is null ? "-" : KvoBool(carView, "accessibilityElementsHidden").ToString())} " +
                $"bbEH={(bbView is null ? "-" : KvoBool(bbView, "accessibilityElementsHidden").ToString())}");
            if (_viewModel.Perek is { } p && _viewModel.CarouselPerakim is { } list)
            {
                var idx = list.IndexOf(p);
                DebugLog.Write($"[A11yDump {tag}] perekInList idx={idx} n={list.Count} " +
                    $"f299={(list.Count > 299 ? list[299].IsOffscreenCarouselPage.ToString() : "-")} " +
                    $"f300={(list.Count > 300 ? list[300].IsOffscreenCarouselPage.ToString() : "-")} " +
                    $"f301={(list.Count > 301 ? list[301].IsOffscreenCarouselPage.ToString() : "-")}");
            }

            var found = DumpViewFlags(window, 0, tag);
            DebugLog.Write($"[A11yDump {tag}] flagged={found}");

            // TEMP-DIAG: force the AX server to recompute visibility — if WDA's
            // displayed flips after this pass the server cache was stale.
            // LayoutChanged (unlike ScreenChanged) invalidates AXElement caches —
            // cachedVisibleFrame/cachedRemoteParent — for the whole subtree.
            UIKit.UIAccessibility.PostNotification(UIKit.UIAccessibilityPostNotification.LayoutChanged, window);
            UIKit.UIAccessibility.PostNotification(UIKit.UIAccessibilityPostNotification.ScreenChanged, (Foundation.NSObject?)null);
            DebugLog.Write($"[A11yDump {tag}] posted LayoutChanged+ScreenChanged notifications");

            foreach (var id in new[] { "PasukText", "PasukimCollection", "PerekHeader", "PerushimChevronButton", "TextButton", "CircularMenuButton", "PerekSource" })
            {
                var target = FindVisibleViewById(window, id);
                if (target is null)
                {
                    DebugLog.Write($"[A11yDump {tag}] no on-screen view for {id}");
                    continue;
                }
                DumpAncestorChain(target, tag, id);
                ProbeAxHitTest(window, target, tag, id);
            }
        }
#pragma warning disable S2221 // TEMP-DIAG: investigation boundary, any failure is logged not thrown.
        catch (Exception ex) { DebugLog.Write($"[A11yDump {tag}] failed: {ex}"); } //NOSONAR
#pragma warning restore S2221
    }

    private static bool KvoBool(UIKit.UIView view, string key)
    {
        try
        {
            return view.ValueForKey(new Foundation.NSString(key)) is Foundation.NSNumber n && n.BoolValue;
        }
#pragma warning disable S2221 // TEMP-DIAG: KVC probe must never throw.
        catch { return false; } //NOSONAR
#pragma warning restore S2221
    }

    private static int DumpViewFlags(UIKit.UIView view, int depth, string tag)
    {
        if (depth > 40) { return 0; }
        var count = 0;
        var modal = KvoBool(view, "accessibilityViewIsModal");
        var elemHidden = KvoBool(view, "accessibilityElementsHidden");
        var hidden = view.Hidden || view.Alpha < 0.01f;
        var isAE = KvoBool(view, "isAccessibilityElement");
        var full = view.Frame.Width >= 400 && view.Frame.Height >= 800;
        if (modal || elemHidden || (hidden && full) || view is UIKit.UIToolbar || (isAE && full))
        {
            count++;
            var f = view.Frame;
            DebugLog.Write($"[A11yDump {tag}] d{depth} {view.GetType().Name} f={f.X:0},{f.Y:0},{f.Width:0}x{f.Height:0} " +
                $"modal={modal} elemHidden={elemHidden} hidden={view.Hidden} alpha={view.Alpha:0.##} isAE={isAE} " +
                $"uie={view.UserInteractionEnabled} id={view.AccessibilityIdentifier ?? "-"}");
        }
        foreach (var sub in view.Subviews)
        {
            count += DumpViewFlags(sub, depth + 1, tag);
        }
        return count;
    }

    private static UIKit.UIView? FindVisibleViewById(UIKit.UIView root, string id)
    {
        UIKit.UIView? onScreen = null;
        CollectVisibleById(root, id, root, ref onScreen);
        return onScreen;
    }

    private static void CollectVisibleById(UIKit.UIView view, string id, UIKit.UIView root, ref UIKit.UIView? onScreen)
    {
        if (onScreen is null && view.AccessibilityIdentifier == id)
        {
            var f = view.ConvertRectToView(view.Bounds, root);
            if (!view.Hidden && f.IntersectsWith(root.Bounds) && f.Width > 1 && f.Height > 1)
            {
                onScreen = view;
            }
        }
        foreach (var sub in view.Subviews)
        {
            CollectVisibleById(sub, id, root, ref onScreen);
        }
    }

    private static void DumpAncestorChain(UIKit.UIView view, string tag, string id)
    {
        var d = 0;
        for (var v = (UIKit.UIView?)view; v is not null && d < 40; v = v.Superview, d++)
        {
            var f = v.Frame;
            var af = KvoRect(v, "accessibilityFrame");
            var avf = KvoRect(v, "accessibilityVisibleFrame");
            var fics = KvoRect(v, "accessibilityFrameInContainerSpace");
            var zOrder = v.Superview is null ? -1 : Array.IndexOf(v.Superview.Subviews, v);
            var sibCount = v.Superview?.Subviews.Length ?? -1;
            DebugLog.Write($"[A11yChain {tag}] {id} d{d} {v.GetType().Name} f={f.X:0},{f.Y:0},{f.Width:0}x{f.Height:0} " +
                $"z={zOrder}/{sibCount} " +
                $"af={af} avf={avf} fics={fics} " +
                $"modal={KvoBool(v, "accessibilityViewIsModal")} elemHidden={KvoBool(v, "accessibilityElementsHidden")} " +
                $"hidden={v.Hidden} alpha={v.Alpha:0.##} isAE={KvoBool(v, "isAccessibilityElement")} " +
                $"clip={v.ClipsToBounds} uie={v.UserInteractionEnabled} id={v.AccessibilityIdentifier ?? "-"}" +
                $" pc={KvoObjStr(v, "accessibilityContainer")} ct={KvoObjStr(v, "accessibilityContainerType")}" +
                $" sgac={KvoBool(v, "shouldGroupAccessibilityChildren")} navStyle={KvoObjStr(v, "accessibilityNavigationStyle")}" +
                $" axp={AxParentStr(v)} aec={KvoObjStr(v, "accessibilityElementCount")}" +
                $" opaq={KvoObjStr(v, "_accessibilityIsOpaqueElementProvider")} ae={AccElemSummary(v)}" +
                $" isVis={AxSendInt(v, "_accessibilityIsVisible")} viewVis={AxSendInt(v, "_accessibilityViewIsVisible")}" +
                $" uvf={AxSendRect(v, "_accessibilityVisibleFrame")} uvp={AxSendPoint(v, "_accessibilityVisiblePoint")}" +
                $" uva={AxUva(v)}");
        }
    }

    private static void ProbeAxHitTest(UIKit.UIView window, UIKit.UIView target, string tag, string id)
    {
        try
        {
            var f = target.ConvertRectToView(target.Bounds, window);
            var mid = new CoreGraphics.CGPoint(f.X + f.Width / 2, f.Y + f.Height / 2);
            var selPub = new ObjCRuntime.Selector("accessibilityHitTest:withEvent:");
            var selPriv = new ObjCRuntime.Selector("_accessibilityHitTest:withEvent:");
            if (window.RespondsToSelector(selPub))
            {
                DumpHitObj("pub", ObjcMsgSendPointObj(window.Handle, selPub.Handle, mid, IntPtr.Zero), mid, tag, id);
            }
            else
            {
                DebugLog.Write($"[AXHit {tag}] {id} pub unresponded");
            }
            if (window.RespondsToSelector(selPriv))
            {
                DumpHitObj("priv", ObjcMsgSendPointObj(window.Handle, selPriv.Handle, mid, IntPtr.Zero), mid, tag, id);
            }
            else
            {
                DebugLog.Write($"[AXHit {tag}] {id} priv unresponded");
            }
        }
#pragma warning disable S2221 // TEMP-DIAG: KVC probe must never throw.
        catch (Exception ex) { DebugLog.Write($"[AXHit {tag}] {id} err {ex.Message[..Math.Min(80, ex.Message.Length)]}"); } //NOSONAR
#pragma warning restore S2221
    }

    private static string AxParentStr(UIKit.UIView view)
    {
        var p = KvoObjStr(view, "_AXParent");
        if (p is "?" or "-") { p = KvoObjStr(view, "accessibilityParent"); }
        return p;
    }

    private static void DumpHitObj(string kind, IntPtr hitPtr, CoreGraphics.CGPoint mid, string tag, string id)
    {
        var hitObj = hitPtr == IntPtr.Zero ? null : ObjCRuntime.Runtime.GetNSObject(hitPtr);
        var hitId = hitObj is null ? "-" : KvoObjStr(hitObj, "accessibilityIdentifier");
        var hitAf = hitObj is null ? "-" : KvoObjRect(hitObj, "accessibilityFrame");
        var hitDesc = hitObj?.ToString() ?? "nil";
        if (hitDesc.Length > 120) { hitDesc = hitDesc[..120]; }
        DebugLog.Write($"[AXHit {tag}] {id} {kind} mid={mid.X:0},{mid.Y:0} -> id={hitId} af={hitAf} {hitDesc}");
    }

    [System.Runtime.InteropServices.DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern IntPtr ObjcMsgSendPointObj(IntPtr receiver, IntPtr selector, CoreGraphics.CGPoint point, IntPtr arg);

    [System.Runtime.InteropServices.DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern IntPtr MsgSendObj(IntPtr receiver, IntPtr selector);

    [System.Runtime.InteropServices.DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern int MsgSendInt(IntPtr receiver, IntPtr selector);

    [System.Runtime.InteropServices.DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern CoreGraphics.CGRect MsgSendCGRect(IntPtr receiver, IntPtr selector);

    [System.Runtime.InteropServices.DllImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static extern CoreGraphics.CGPoint MsgSendCGPoint(IntPtr receiver, IntPtr selector);

    private static string AxSendInt(Foundation.NSObject obj, string sel)
    {
        try
        {
            var s = new ObjCRuntime.Selector(sel);
            return obj.RespondsToSelector(s) ? MsgSendInt(obj.Handle, s.Handle).ToString() : "?";
        }
#pragma warning disable S2221 // TEMP-DIAG: msgSend probe must never throw.
        catch { return "err"; } //NOSONAR
#pragma warning restore S2221
    }

    private static string AxSendRect(Foundation.NSObject obj, string sel)
    {
        try
        {
            var s = new ObjCRuntime.Selector(sel);
            if (!obj.RespondsToSelector(s)) { return "?"; }
            var r = MsgSendCGRect(obj.Handle, s.Handle);
            return $"{r.X:0},{r.Y:0},{r.Width:0}x{r.Height:0}";
        }
#pragma warning disable S2221 // TEMP-DIAG: msgSend probe must never throw.
        catch { return "err"; } //NOSONAR
#pragma warning restore S2221
    }

    private static string AxSendPoint(Foundation.NSObject obj, string sel)
    {
        try
        {
            var s = new ObjCRuntime.Selector(sel);
            if (!obj.RespondsToSelector(s)) { return "?"; }
            var p = MsgSendCGPoint(obj.Handle, s.Handle);
            return $"{p.X:0},{p.Y:0}";
        }
#pragma warning disable S2221 // TEMP-DIAG: msgSend probe must never throw.
        catch { return "err"; } //NOSONAR
#pragma warning restore S2221
    }

    private static string AxUva(Foundation.NSObject obj)
    {
        try
        {
            var s = new ObjCRuntime.Selector("_accessibilityUserTestingVisibleAncestor");
            if (!obj.RespondsToSelector(s)) { return "?"; }
            var p = MsgSendObj(obj.Handle, s.Handle);
            if (p == IntPtr.Zero) { return "nil"; }
            if (ObjCRuntime.Runtime.GetNSObject(p) is not { } o) { return "?"; }
            var desc = o.ToString() ?? "-";
            if (desc.Length > 60) { desc = desc[..60]; }
            return $"{o.GetType().Name}@{KvoObjRect(o, "accessibilityFrame")} id={KvoObjStr(o, "accessibilityIdentifier")} {desc}";
        }
#pragma warning disable S2221 // TEMP-DIAG: msgSend probe must never throw.
        catch { return "err"; } //NOSONAR
#pragma warning restore S2221
    }

    private static string AccElemSummary(UIKit.UIView view)
    {
        try
        {
            if (view.ValueForKey(new Foundation.NSString("accessibilityElements")) is not Foundation.NSArray elems)
            {
                return "nil";
            }
            var sb = new System.Text.StringBuilder($"{elems.Count}[");
            for (nuint i = 0; i < elems.Count && i < 4; i++)
            {
                if (elems.GetItem<Foundation.NSObject>(i) is not { } obj) { continue; }
                sb.Append($"{obj.GetType().Name}@{KvoObjRect(obj, "accessibilityFrame")}" +
                    $" id={KvoObjStr(obj, "accessibilityIdentifier")} c={KvoObjStr(obj, "accessibilityContainer")};");
            }
            return sb.Append(']').ToString();
        }
#pragma warning disable S2221 // TEMP-DIAG: KVC probe must never throw.
        catch (Exception ex) { return $"err:{ex.Message[..Math.Min(40, ex.Message.Length)]}"; } //NOSONAR
#pragma warning restore S2221
    }

    private static string KvoObjRect(Foundation.NSObject obj, string key)
    {
        try
        {
            return obj.ValueForKey(new Foundation.NSString(key)) is Foundation.NSValue v
                ? $"{v.CGRectValue.X:0},{v.CGRectValue.Y:0},{v.CGRectValue.Width:0}x{v.CGRectValue.Height:0}"
                : "-";
        }
#pragma warning disable S2221 // TEMP-DIAG: KVC probe must never throw.
        catch { return "?"; } //NOSONAR
#pragma warning restore S2221
    }

    private static string KvoObjStr(Foundation.NSObject obj, string key)
    {
        try
        {
            return obj.ValueForKey(new Foundation.NSString(key))?.ToString() ?? "-";
        }
#pragma warning disable S2221 // TEMP-DIAG: KVC probe must never throw.
        catch { return "?"; } //NOSONAR
#pragma warning restore S2221
    }

    private static string KvoRect(UIKit.UIView view, string key)
    {
        try
        {
            return view.ValueForKey(new Foundation.NSString(key)) is Foundation.NSValue n
                ? $"{n.CGRectValue.X:0},{n.CGRectValue.Y:0},{n.CGRectValue.Width:0}x{n.CGRectValue.Height:0}"
                : "-";
        }
#pragma warning disable S2221 // TEMP-DIAG: KVC probe must never throw.
        catch { return "?"; } //NOSONAR
#pragma warning restore S2221
    }
#endif

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

        if (e.Parameter is int pasukNum)
        {
            // If in selection mode, tap toggles selection
            if (_viewModel.Perek?.Pasukim.FirstOrDefault(p => p.PasukNum == pasukNum) is { } pasuk)
            {
                await HandlePasukTapAsync(pasuk);
            }
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
            !_chapterRecitationSelection && track.AlignmentStatus != "ready" && _recitationCursor.PlayingKey == null ? "הקראת מילים ופסוקים עדיין בהכנה" :
            recitationEnabled ? "הקראה" : "ההקלטה אינה תואמת לטקסט המותקן";
        SelectionBar.SetRecitationState(recitationEnabled, recitationVisual, hint);

        var searching = ChapterSearch.IsSearchOpen;
        Shell.SetNavBarIsVisible(this, false);
        ReaderToolbar.IsVisible = !ExitFullScreenButton.IsVisible;
        Shell.SetFlyoutBehavior(this, selectionBarMode || searching ? FlyoutBehavior.Disabled : FlyoutBehavior.Flyout);
        Shell.SetBackButtonBehavior(this, new BackButtonBehavior { IsVisible = !searching });
        var shellBackground = selectionBarMode
            ? (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"]
            : Microsoft.Maui.Controls.Application.Current!.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#20304A")
                : Color.FromArgb("#F2F7FE");
        Shell.SetBackgroundColor(this, shellBackground);
        ReaderToolbar.BackgroundColor = shellBackground;
        NormalNavigationBar.BarVisible = !selectionBarMode && !searching;
        // The header names the focused pasuk — sefer, perek and pasuk together —
        // instead of the plain perek source (#2466).
        NormalNavigationTitle.Text = focused && _viewModel.Source != null
            ? $"{_viewModel.Source} {_focusedPasuk!.PasukNumHeb}"
            : _viewModel.Source;
        // iOS has no system Back for the overlay, so the navigation slot turns
        // into the close control there; platforms with system Back keep the
        // shared hamburger (#2467).
        var focusedNavIsBack = focused && (OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst());
        NormalNavigationBar.NavigationButton.Text = focusedNavIsBack
            ? Fonts.FluentUI.arrow_right_24_regular
            : Fonts.FluentUI.navigation_24_regular;
        SemanticProperties.SetDescription(NormalNavigationBar.NavigationButton,
            focusedNavIsBack ? "סגירת הפסוק הממוקד" : "פתיחת תפריט הניווט");
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
    /// The fan refreshes each satellite's enabled state as it opens, so
    /// prev/next fade in dimmed at the perek edges.
    /// </summary>
    private void OnFanMenuOpening(object? sender, EventArgs e)
    {
        PrevPerekButton.IsEnabled = _viewModel.CanGoToPreviousPerek;
        NextPerekButton.IsEnabled = _viewModel.CanGoToNextPerek;
    }

    /// <summary>
    /// Handles menu item click - keeps menu open (don't close).
    /// </summary>
    private void OnMenuItemClicked(object? sender, EventArgs e)
    {
        // Menu stays open - user can click multiple satellites
        // Menu closes only when clicking the hamburger button again
    }

    /// <summary>
    /// iOS has no system Back for the focused-pasuk overlay — the toolbar's
    /// navigation slot acts as its close control there (#2466).
    /// </summary>
    private bool OnFocusedPasukNavigationIntercepted()
    {
        if (_focusedPasuk == null || !(OperatingSystem.IsIOS() || OperatingSystem.IsMacCatalyst()))
        {
            return false;
        }
        ClearAllSelections();
        return true;
    }

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
    /// Handles perek selection from the picker popup. A confirmed selection
    /// completes the navigation: the picker closes itself and the radial menu
    /// that opened it closes too, leaving the reader undimmed and interactive.
    /// </summary>
    private async void OnPerekPickerSelected(int perekId)
    {
        await FanMenu.CloseAsync();

        if (perekId >= 1 && perekId <= 929 && perekId != _viewModel.PerekId)
        {
            await _viewModel.NavigateToPerekAsync(perekId);
        }
    }

    /// <summary>
    /// Handles text button click - returns to perek view if showing articles,
    /// otherwise scrolls to header/top of perek.
    /// </summary>
    private void OnTextButtonClicked(object? sender, EventArgs e)
    {
        if (_isShowingArticles)
        {
            // Return to perek view
            ShowPerekView();
        }
        else
        {
            // Scroll the pasukim CollectionView to top within the current carousel item
            PerekCarousel.ScrollTo(_viewModel.CarouselPosition, position: ScrollToPosition.Start, animate: false);
        }
    }

    /// <summary>
    /// Handles articles button click - shows articles view.
    /// </summary>
    private void OnArticlesButtonClicked(object? sender, EventArgs e)
    {
        try
        {
            DebugLog.Write("[Articles] Button clicked, _isShowingArticles=" + _isShowingArticles);

            if (_isShowingArticles)
            {
                // Already showing articles, do nothing or toggle back
                return;
            }

            ShowArticlesView();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-view transition must not crash the reader
        catch (Exception ex) //NOSONAR — articles-view transition must not crash the reader.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Articles] Error in OnArticlesButtonClicked: {ex}");
        }
    }

    /// <summary>
    /// Shows the articles view with flip animation.
    /// </summary>
    private void ShowArticlesView()
    {
        try
        {
            DebugLog.Write("[Articles] ShowArticlesView starting...");
            _isShowingArticles = true;

            // Load articles for the current perek (header stays the same)
            DebugLog.Write("[Articles] Loading articles...");
            LoadArticles();
            DebugLog.Write("[Articles] Articles loaded");

            // Simple visibility swap instead of animation (animation may crash on Windows)
            DebugLog.Write("[Articles] Switching visibility...");
            PerekCarousel.IsVisible = false;
            ArticlesCollection.IsVisible = true;
            DebugLog.Write("[Articles] Visibility switched");

            // Update button states - highlight articles button
            DebugLog.Write("[Articles] Updating button color...");
            BottomBar.IsArticlesActive = true;
            DebugLog.Write("[Articles] ShowArticlesView complete");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-view transition must not crash the reader
        catch (Exception ex) //NOSONAR — articles-view transition must not crash the reader.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Articles] Error in ShowArticlesView: {ex}");
        }
    }

    /// <summary>
    /// Returns to the perek view with flip animation.
    /// </summary>
    private async void ShowPerekView()
    {
        try
        {
            _isShowingArticles = false;
            _viewModel.SelectedArticleId = null;

            // Simple visibility swap instead of animation
            ArticlesCollection.IsVisible = false;
            PerekCarousel.IsVisible = true;

            // Reset button color
            BottomBar.IsArticlesActive = false;

            await Task.CompletedTask; // Keep async signature
        }
        #pragma warning disable S2221 // Deliberate failure boundary: perek-view styling failure is log-only
        catch (Exception ex) //NOSONAR — perek-view styling failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Articles] Error in ShowPerekView: {ex}");
        }
    }

    /// <summary>
    /// Handles article selection - navigates to article detail.
    /// </summary>
#pragma warning disable S1172 // The XAML event delegate requires the sender parameter.
    private async void OnArticleSelected(object? sender, Article article)
#pragma warning restore S1172
    {
        _viewModel.SelectedArticleId = article.Id;

        // Navigate to article detail page
        try
        {
            await Shell.Current.GoToAsync($"articleDetail?articleId={article.Id}");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles list degrades to empty
        catch (Exception ex) //NOSONAR — articles list degrades to empty.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error navigating to article: {ex.Message}");
        }
    }

    /// <summary>
    /// Loads articles for the current perek from the StarterService snapshot —
    /// same Priority ordering and Author wiring the GraphQL query produced.
    /// </summary>
    private void LoadArticles()
    {
        try
        {
            ArticlesCollection.ItemsSource = StarterService.Instance.GetArticlesByPerekId(_viewModel.PerekId);
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
    /// Handles perushim chevron button click - toggles the perushim sliding panel.
    /// </summary>
    private async void OnPerushimChevronClicked(object? sender, EventArgs e)
    {
        // Cap the drag-up expansion so the sheet's top edge stays under the
        // status bar/pill: content + toolbar rows already begin below it.
        var toolbarHeight = ReaderToolbar.IsVisible ? ReaderToolbar.Height : 0;
        await PerushimPanel.ToggleAsync(MainGrid.Height, ContentArea.Height + toolbarHeight - 8);
    }

    /// <summary>Mirrors the sheet's open state onto the chevron glyph.</summary>
#pragma warning disable S1172 // The XAML event delegate requires the sender parameter.
    private void OnPerushimSheetOpenChanged(object? sender, bool isOpen) =>
#pragma warning restore S1172
        BottomBar.IsPerushimOpen = isOpen;

    /// <summary>
    /// Handles full screen button click - hides top and bottom bars, shows exit button.
    /// </summary>
    private void OnFullScreenClicked(object? sender, EventArgs e)
    {
        EnterFullScreen();
    }

    /// <summary>
    /// Handles exit full screen button click - restores normal view.
    /// </summary>
    private void OnExitFullScreenClicked(object? sender, EventArgs e)
    {
        ExitFullScreen();
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
        if (_carouselInitializing)
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

        // Refresh nav button visuals if menu is open (synchronous)
        if (FanMenu.IsOpen)
        {
            RefreshNavButtonVisuals();
        }

        DebugLog.Write($"[Carousel] OnChanged DONE vmPerek={_viewModel.PerekId} pos={_viewModel.CarouselPosition}");

        // Fire async tasks in the background — never block the next swipe
        UpdateArticlesCount();
        _ = _viewModel.LoadPerushimAsync(perek.PerekId);
        _ = _viewModel.PreloadAdjacentPasukimAsync(perek.PerekId);
        if (_isShowingArticles)
        {
            LoadArticles();
        }
    }

    /// <summary>
    /// Enters full screen mode - hides navigation and bottom bar.
    /// </summary>
    private void EnterFullScreen()
    {
        ChapterSearch.Close();
        // Snap the fan closed without animation so nothing stays dimmed
        FanMenu.ResetToClosed();

        // Hide Shell navigation bar (no TabBar in this app - single page per FlyoutItem)
        Shell.SetNavBarIsVisible(this, false);
        ReaderToolbar.IsVisible = false;

        // Hide bottom bar completely
        BottomBar.IsVisible = false;
        FanMenu.IsVisible = false;

        // Show floating exit button (reset position first)
        ExitFullScreenButton.ResetPosition();
        ExitFullScreenButton.IsVisible = true;
#if ANDROID
        UpdateReaderBack();
#endif
    }

    /// <summary>
    /// Exits full screen mode - restores navigation and bottom bar.
    /// </summary>
    private void ExitFullScreen()
    {
        // Hide floating exit button first
        ExitFullScreenButton.IsVisible = false;

        // Restore the reader toolbar without introducing a native Back button.
        Shell.SetNavBarIsVisible(this, false);
        ReaderToolbar.IsVisible = true;

        // Show bottom bar
        BottomBar.IsVisible = true;
        FanMenu.IsVisible = true;
#if ANDROID
        UpdateReaderBack();
#endif
    }

    #endregion
}
