namespace BibleOnSite.Pages;

using BibleOnSite.Behaviors;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using Microsoft.Maui.Layouts;
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

    // Circular menu state
    private bool _isMenuOpen;
    private const int AnimationDurationMs = 300;

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

    /// <summary>
    /// Proxy for article selection highlight binding (avoids XC0045 when binding from Article template).
    /// </summary>
    public int? SelectedArticleId => _viewModel.SelectedArticleId;

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
        ForwardSelectedArticleIdChanged();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupCircularMenuLayout();
        SetupExitButtonDragHandler();
        SubscribeAppLinks();
        SubscribePerushimSearch();
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
        ForwardSelectedArticleIdChanged();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupCircularMenuLayout();
        SetupExitButtonDragHandler();
        SubscribeAppLinks();
        SubscribePerushimSearch();
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
            if (_isMenuOpen)
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

    private void ForwardSelectedArticleIdChanged()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PerekViewModel.SelectedArticleId))
            {
                OnPropertyChanged(nameof(SelectedArticleId));
            }
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
        if (!_isMenuOpen)
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
        if (_carouselInitializing || CarouselLoadingOverlay.IsVisible || _isMenuOpen || _isShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen ||
            !ContainsTouch(PerekCarousel, position) || ContainsTouch(BottomBar, position) ||
            ContainsTouch(ExitFullScreenButton, position))
        {
            return;
        }
        _swipe.Begin(position, PerekCarousel.Position);
    }

    private void OnTouchDispatched(object? sender, TouchPosition position)
    {
        if (_carouselInitializing || CarouselLoadingOverlay.IsVisible || _isMenuOpen || _isShowingArticles || _focusedPasuk != null || ChapterSearch.IsSearchOpen ||
            !ContainsTouch(PerekCarousel, position) || ContainsTouch(BottomBar, position) ||
            ContainsTouch(ExitFullScreenButton, position) || ContainsTouch(CircularMenuButton, position) ||
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
                    ShowPerekLoadError(ex);
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
        ShowCarouselLoading();

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
        CarouselLoadingOverlay.IsVisible = false;

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

    /// <summary>Swaps the loading overlay to its spinner state (initial load and retry).</summary>
    private void ShowCarouselLoading()
    {
        CarouselLoadErrorPanel.IsVisible = false;
        CarouselLoadingIndicator.IsVisible = true;
        CarouselLoadingOverlay.IsVisible = true;
    }

    /// <summary>Swaps the loading overlay to its retryable error state.</summary>
    private void ShowPerekLoadError(Exception ex)
    {
        CarouselLoadingIndicator.IsVisible = false;
        CarouselLoadErrorDetail.Text = ex.Message;
        CarouselLoadErrorPanel.IsVisible = true;
        CarouselLoadingOverlay.IsVisible = true;
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
                ShowPerekLoadError(ex);
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
            CarouselLoadingOverlay.IsVisible = false;
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

    /// <summary>
    /// Updates the articles count badge for the current perek from the
    /// StarterService startup counters — a swipe never issues a network request
    /// just to redraw the badge.
    /// </summary>
    private void UpdateArticlesCount()
    {
        try
        {
            var count = StarterService.Instance.GetPerekArticlesCount(_viewModel.PerekId);

            // Update badge visibility and text
            ArticlesBadge.IsVisible = count > 0;
            if (count > 0 && ArticlesBadge.Content is Label badgeLabel)
            {
                badgeLabel.Text = count.ToString();
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: articles-count badge degrades to hidden
        catch (Exception ex) //NOSONAR — articles-count badge degrades to hidden.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Error updating articles count: {ex.Message}");
            ArticlesBadge.IsVisible = false;
        }
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
        FloatingMenuContainer.TranslationY = bottom;
        FloatingMenuContainer.Padding = new Thickness(0, 0, 0, bottom);
        this.Padding = new Thickness(0, 0, 0, -bottom);
        Resources["BottomBarTotalHeight"] = totalHeight;

        // Padding changes the arrange area without firing SizeChanged.
        LayoutCircularMenu();
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
        SelectionCountBadge.IsVisible = ordinarySelection;
        SelectionShareButton.IsVisible = ordinarySelection;
        SelectionCopyButton.IsVisible = ordinarySelection;
        SelectionRecitationButton.IsVisible = RecitationAvailable;
        var perek = _viewModel.Perek;
        var track = perek == null ? null : RecitationService.Instance.GetTrack(perek.PerekId);
        // An active playback can always be paused — even for a perek whose word
        // timings are still pending (chapter playback needs no alignment).
        SelectionRecitationButton.IsEnabled = !_recitationBusy && perek != null && RecitationService.Instance.HasAudio(perek.PerekId) &&
            track != null && (_recitationCursor.PlayingKey != null ||
                (track.Matches(perek.Pasukim) && (_chapterRecitationSelection || track.AlignmentStatus == "ready")));
        SelectionRecitationButton.Opacity = SelectionRecitationButton.IsEnabled ? 1 : 0.4;
        // The glyph must match what the button does: only bar-issued playback
        // pauses, so a word preview still playing shows Play (it starts the
        // chapter at the bookmark), like the website's preview state.
        SelectionRecitationButton.Text =
            RecitationPlayer?.CurrentState == CommunityToolkit.Maui.Core.MediaElementState.Playing && _recitationCursor.BarIssued
                ? Fonts.FluentUI.pause_24_regular
                : RecitationPlayer?.CurrentState is CommunityToolkit.Maui.Core.MediaElementState.Playing or CommunityToolkit.Maui.Core.MediaElementState.Paused
                    ? Fonts.FluentUI.play_24_regular : Fonts.FluentUI.headphones_24_regular;
        var hint = _recitationBusy ? "טוען את הקלטת הפרק..." : track == null ? "אין הקלטה לפרק זה" :
            !RecitationService.Instance.HasAudio(track.PerekId) ? "הורידו את הקלטות הספר בהעדפות" :
            !_chapterRecitationSelection && track.AlignmentStatus != "ready" && _recitationCursor.PlayingKey == null ? "הקראת מילים ופסוקים עדיין בהכנה" :
            SelectionRecitationButton.IsEnabled ? "הקראה" : "ההקלטה אינה תואמת לטקסט המותקן";
        ToolTipProperties.SetText(SelectionRecitationButton, hint);
        SemanticProperties.SetDescription(SelectionRecitationButton, hint);

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
        SelectionCountLabel.Text = count.ToString();
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
        // Inline feedback: show clipboard-checkmark icon for 1.5s then restore copy icon
        SelectionCopyButton.Text = "\ue34c"; // clipboard_checkmark_24_regular
        await Task.Delay(1500);
        SelectionCopyButton.Text = "\uf32b"; // copy_24_regular
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
    /// Recomputes the floating menu's button positions whenever the container's
    /// arrange area changes: device rotation, window resize, and (on iOS) the
    /// safe-area padding applied by ApplyBottomBarSafeArea.
    /// </summary>
    private void SetupCircularMenuLayout()
    {
        FloatingMenuContainer.SizeChanged += (_, _) => LayoutCircularMenu();
    }

    /// <summary>
    /// Positions the toggle and the four satellite buttons on the elliptical
    /// fan computed by <see cref="FanMenuGeometry"/>. The container's padding is
    /// the system safe-area inset, so positions are computed in the remaining
    /// usable canvas and stay inside the safe area automatically.
    /// </summary>
    private void LayoutCircularMenu()
    {
        var width = FloatingMenuContainer.Width - FloatingMenuContainer.Padding.HorizontalThickness;
        var height = FloatingMenuContainer.Height - FloatingMenuContainer.Padding.VerticalThickness;
        if (width <= 0 || height <= 0)
        {
            return;
        }

        var satellites = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };
        var layout = FanMenuGeometry.Compute(width, height, satellites.Length);
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

    private void OnCircularMenuPressed(object? sender, EventArgs e) =>
        DebugLog.Write($"[CircularMenu] Pressed: open={_isMenuOpen}");

    private void OnCircularMenuReleased(object? sender, EventArgs e) =>
        DebugLog.Write($"[CircularMenu] Released: open={_isMenuOpen}");

    /// <summary>
    /// Toggles the circular menu open/closed state with animation.
    /// </summary>
    private async void OnCircularMenuClicked(object? sender, EventArgs e)
    {
        _isMenuOpen = !_isMenuOpen;
        DebugLog.Write($"[CircularMenu] Clicked: open={_isMenuOpen}");

        if (_isMenuOpen)
        {
            await OpenCircularMenuAsync();
        }
        else
        {
            await CloseCircularMenuAsync();
        }
    }

    /// <summary>
    /// Opens the circular menu with animated expansion.
    /// </summary>
    private async Task OpenCircularMenuAsync()
    {
        var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };

        // Set prev/next enabled state before animating
        PrevPerekButton.IsEnabled = _viewModel.CanGoToPreviousPerek;
        NextPerekButton.IsEnabled = _viewModel.CanGoToNextPerek;

        // Enable clicks and set initial opacity (buttons at final positions via AbsoluteLayout)
        foreach (var button in buttons)
        {
            button.InputTransparent = false;
            button.Opacity = 0;
        }

        CircularMenuScrim.IsVisible = true;

        // Change FAB icon to X
        CircularMenuButton.Text = Fonts.FluentUI.dismiss_24_regular;
        CircularMenuButton.BackgroundColor = Colors.Red;

        // Animate FAB rotation and fade in all buttons (disabled = 0.4, enabled = 1)
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
        DebugLog.Write($"[CircularMenu] Open animation complete: open={_isMenuOpen}");
    }

    /// <summary>
    /// Closes the circular menu with animated contraction.
    /// </summary>
    private async Task CloseCircularMenuAsync()
    {
        var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };

        // Change back to hamburger
        CircularMenuButton.Text = Fonts.FluentUI.navigation_24_regular;
        CircularMenuButton.BackgroundColor = (Color)Microsoft.Maui.Controls.Application.Current!.Resources["Primary"];

        // Animate FAB rotation and fade out all buttons
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

        // Disable clicks on hidden buttons
        foreach (var button in buttons)
        {
            button.InputTransparent = true;
        }
        DebugLog.Write($"[CircularMenu] Close animation complete: open={_isMenuOpen}");
    }

    /// <summary>
    /// Handles tap on overlay background - closes the menu.
    /// </summary>
    private async void OnOverlayTapped(object? sender, TappedEventArgs e)
    {
        if (_isMenuOpen)
        {
            _isMenuOpen = false;
            await CloseCircularMenuAsync();
        }
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
    private void OnReaderMenuButtonClicked(object? sender, EventArgs e)
    {
        ReaderMenuOverlay.IsVisible = !ReaderMenuOverlay.IsVisible;
    }

    /// <summary>
    /// Dismisses the reader menu when tapping outside the panel.
    /// </summary>
    private void OnReaderMenuDismissed(object? sender, TappedEventArgs e)
    {
        ReaderMenuOverlay.IsVisible = false;
    }

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
    private void OnShnayimMikraTapped(object? sender, TappedEventArgs e)
    {
        _viewModel.IsShnayimMikraEnabled = !_viewModel.IsShnayimMikraEnabled;
    }

    /// <summary>
    /// תיקון קוראים menu item - toggles the continuous reading flow.
    /// </summary>
    private void OnTikkunKorimTapped(object? sender, TappedEventArgs e)
    {
        _viewModel.IsTikkunKorimEnabled = !_viewModel.IsTikkunKorimEnabled;
    }

    /// <summary>
    /// הסתר שם השם menu item - toggles divine-name display masking. The change
    /// persists through PreferencesService and bumps DivineNameMasking.Revision,
    /// which the pasukim MultiBinding and TikkunFlowView pick up to re-render.
    /// </summary>
    private void OnDivineNameMaskingTapped(object? sender, TappedEventArgs e)
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
        if (_isMenuOpen)
        {
            _isMenuOpen = false;
            await CloseCircularMenuAsync();
        }

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
            ArticlesButton.TextColor = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#BB86FC")
                : Color.FromArgb("#512BD4");
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
            ArticlesButton.TextColor = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#9CA3AF")
                : Color.FromArgb("#6B7280");

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
    /// Performs a flip animation between two views.
    /// </summary>
    private async Task AnimateFlipAsync(View fromView, View toView)
    {
        try
        {
            const uint duration = 200;

            // First half - rotate out (scale X to simulate flip)
            await fromView.ScaleXToAsync(0, duration, Easing.CubicIn);

            // Switch visibility at midpoint
            fromView.IsVisible = false;
            toView.IsVisible = true;
            toView.ScaleX = 0;

            // Second half - rotate in
            await toView.ScaleXToAsync(1, duration, Easing.CubicOut);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: flip animation falls back to a visibility swap
        catch (Exception ex) //NOSONAR — flip animation falls back to a visibility swap.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"[Articles] Error in AnimateFlipAsync: {ex}");
            // Fallback: just swap visibility
            fromView.IsVisible = false;
            toView.IsVisible = true;
        }
    }

    /// <summary>
    /// Handles article selection - navigates to article detail.
    /// </summary>
    private async void OnArticleSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is Article article)
        {
            _viewModel.SelectedArticleId = article.Id;
            // Clear selection (highlight remains via SelectedArticleId until navigation)
            ArticlesCollection.SelectedItem = null;

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
    private bool _isPerushimOpen;
    private bool _isPerushimExpanded;
    private double _perushimPanelHeight;
    private double _perushimPanelExpandedHeight;
    private double _perushimPanStartY;
    private double _perushimPanStartHeight;
    private double _perushimLastPanY;
    private DateTime _perushimLastPanTime;

    private bool _isTogglingPerush;

    private void OnPerushCheckboxChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (_isTogglingPerush)
        {
            return;
        }
        if (sender is not CheckBox checkBox)
        {
            return;
        }
        var grid = checkBox.Parent as Grid;
        var perush = grid?.BindingContext as Perush;
        if (perush == null)
        {
            return;
        }

        bool wantChecked = e.Value;
        bool alreadyChecked = _viewModel.IsPerushChecked(perush.Id);
        if (wantChecked == alreadyChecked)
        {
            return;
        }

        PerushSearchBar.Unfocus();
        _isTogglingPerush = true;
        try
        {
            _viewModel.ToggleCheckedPerush(perush.Id);
            checkBox.IsChecked = _viewModel.IsPerushChecked(perush.Id);
        }
        finally
        {
            _isTogglingPerush = false;
        }
    }

    /// <summary>
    /// Perushim search navigates instead of filtering — the full list stays
    /// visible and each keystroke scrolls the first matching perush into view.
    /// </summary>
    private void SubscribePerushimSearch()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PerekViewModel.PerushNameFilter) && _isPerushimOpen)
            {
                var match = _viewModel.FilteredPerushim.FirstOrDefault();
                if (match != null)
                {
                    PerushimCollection.ScrollTo(match, position: ScrollToPosition.Start, animate: false);
                }
            }
        };
    }

    private void OnPerushSearchSubmitted(object? sender, EventArgs e) => _ = HidePerushimKeyboardAsync();

    /// <summary>Dismisses the soft keyboard — iOS leaves it over the list otherwise.</summary>
    private async Task HidePerushimKeyboardAsync()
    {
        try
        {
            // Unfocus alone can leave the floating keyboard over the list.
            await PerushSearchBar.HideSoftInputAsync(CancellationToken.None);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — failure boundary: keyboard dismissal is best-effort and must not crash the reader.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Could not dismiss perushim search keyboard: {ex}");
        }
        PerushSearchBar.Unfocus();
    }

    private async void OnGoToPerushimSettingsClicked(object? sender, EventArgs e)
    {
        try
        {
            await Shell.Current.GoToAsync(AppRoutes.ExtensionPacks);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: settings navigation failure is log-only
        catch (Exception ex) //NOSONAR — settings navigation failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Navigate to perushim settings failed: {ex}");
        }
    }

    private async void OnPerushimChevronClicked(object? sender, EventArgs e)
    {
        _isPerushimOpen = !_isPerushimOpen;
        _isPerushimExpanded = false;

        // Toggle chevron icon: up (\uf2b7) vs down (\uf2a4)
        PerushimChevronButton.Text = _isPerushimOpen ? "\uf2a4" : "\uf2b7";

        // Calculate panel heights
        var totalHeight = MainGrid.Height;
        _perushimPanelHeight = (totalHeight * 0.33) + 90; // Default: 33% + bottom bar
        // Cap the drag-up expansion so the sheet's top edge stays under the
        // status bar/pill: content + toolbar rows already begin below it.
        var toolbarHeight = ReaderToolbar.IsVisible ? ReaderToolbar.Height : 0;
        _perushimPanelExpandedHeight = Math.Max(_perushimPanelHeight,
            ContentArea.Height + toolbarHeight - 8);

        // Animate perushim panel slide up/down
        if (_isPerushimOpen)
        {
            // Set height and make visible, start below
            PerushimPanel.HeightRequest = _perushimPanelHeight;
            PerushimPanel.TranslationY = _perushimPanelHeight;
            PerushimPanel.IsVisible = true;

            // Slide up
            await PerushimPanel.TranslateToAsync(0, 0, 250, Easing.CubicOut);
        }
        else
        {
            // Slide down then hide
            PerushSearchBar.Unfocus();
            await PerushimPanel.TranslateToAsync(0, _perushimPanelHeight, 250, Easing.CubicIn);
            PerushimPanel.IsVisible = false;
        }
    }

    /// <summary>
    /// Handles pan gesture on the perushim panel header for drag-to-dismiss or expand.
    /// Supports velocity-based gestures and bi-directional dragging.
    /// When expanded, dragging down first collapses to middle size before dismissing.
    /// </summary>
    private async void OnPerushimPanelPan(object? sender, PanUpdatedEventArgs e)
    {
        if (!_isPerushimOpen)
        {
            return;
        }

        const double dismissThreshold = 0.3; // Position threshold: 30% of panel height
        const double velocityThreshold = 800; // Velocity threshold: pixels per second

        switch (e.StatusType)
        {
            case GestureStatus.Started:
                _perushimPanStartY = PerushimPanel.TranslationY;
                _perushimPanStartHeight = PerushimPanel.HeightRequest;
                _perushimLastPanY = 0;
                _perushimLastPanTime = DateTime.Now;
                // Cancel any ongoing animations
                PerushimPanel.CancelAnimations();
                break;

            case GestureStatus.Running:
                // Track velocity
                _perushimLastPanY = e.TotalY;
                _perushimLastPanTime = DateTime.Now;

                if (e.TotalY > 0)
                {
                    if (_isPerushimExpanded)
                    {
                        // When expanded, dragging down shrinks height first
                        var newHeight = Math.Max(_perushimPanelHeight,
                            _perushimPanStartHeight - e.TotalY);
                        PerushimPanel.HeightRequest = newHeight;
                    }
                    else
                    {
                        // When at default size, dragging down translates (toward dismiss)
                        PerushimPanel.TranslationY = e.TotalY;
                    }
                }
                else
                {
                    // Dragging up: expand panel height (toward full screen)
                    var newHeight = Math.Min(_perushimPanelExpandedHeight,
                        _perushimPanStartHeight - e.TotalY);
                    PerushimPanel.HeightRequest = newHeight;
                }
                break;

            case GestureStatus.Completed:
            case GestureStatus.Canceled:
                // Calculate velocity (approximate using last movement)
                var elapsedMs = (DateTime.Now - _perushimLastPanTime).TotalMilliseconds;
                var velocity = elapsedMs > 0 ? Math.Abs(_perushimLastPanY) / (elapsedMs / 1000.0) : 0;

                var dragY = PerushimPanel.TranslationY;
                var currentHeight = PerushimPanel.HeightRequest;

                // Check if dragging down
                if (_perushimLastPanY > 0)
                {
                    if (_isPerushimExpanded)
                    {
                        // When expanded and dragging down: collapse to middle size first
                        var collapseThreshold = (_perushimPanelExpandedHeight - _perushimPanelHeight) * dismissThreshold;
                        var heightDecrease = _perushimPanStartHeight - currentHeight;
                        var shouldCollapse = heightDecrease > collapseThreshold || velocity > velocityThreshold;

                        if (shouldCollapse)
                        {
                            // Collapse to middle/default size
                            _isPerushimExpanded = false;
                            var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                                currentHeight, _perushimPanelHeight);
                            animation.Commit(PerushimPanel, "CollapsePerushim", length: 200, easing: Easing.CubicOut);
                        }
                        else
                        {
                            // Snap back to expanded
                            var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                                currentHeight, _perushimPanelExpandedHeight);
                            animation.Commit(PerushimPanel, "SnapExpandedPerushim", length: 200, easing: Easing.CubicOut);
                        }
                    }
                    else
                    {
                        // When at default size and dragging down: dismiss
                        var positionThreshold = _perushimPanelHeight * dismissThreshold;
                        var shouldDismiss = dragY > positionThreshold || velocity > velocityThreshold;

                        if (shouldDismiss)
                        {
                            // Dismiss: complete the slide down
                            PerushSearchBar.Unfocus();
                            await PerushimPanel.TranslateToAsync(0, _perushimPanelHeight, 200, Easing.CubicIn);
                            PerushimPanel.IsVisible = false;
                            _isPerushimOpen = false;
                            _isPerushimExpanded = false;
                            PerushimChevronButton.Text = "\uf2b7"; // chevron_up
                        }
                        else
                        {
                            // Snap back to open position
                            await PerushimPanel.TranslateToAsync(0, 0, 200, Easing.CubicOut);
                        }
                    }
                }
                else
                {
                    // Dragging up (expand direction)
                    var expandThreshold = (_perushimPanelExpandedHeight - _perushimPanelHeight) * 0.3;
                    var heightIncrease = currentHeight - _perushimPanelHeight;
                    var shouldExpand = heightIncrease > expandThreshold || velocity > velocityThreshold;

                    if (shouldExpand && !_isPerushimExpanded)
                    {
                        // Expand to full screen
                        _isPerushimExpanded = true;
                        var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                            currentHeight, _perushimPanelExpandedHeight);
                        animation.Commit(PerushimPanel, "ExpandPerushim", length: 200, easing: Easing.CubicOut);
                    }
                    else if (!shouldExpand && _isPerushimExpanded)
                    {
                        // Snap back to expanded
                        var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                            currentHeight, _perushimPanelExpandedHeight);
                        animation.Commit(PerushimPanel, "SnapExpandedPerushim", length: 200, easing: Easing.CubicOut);
                    }
                    else if (!shouldExpand)
                    {
                        // Snap back to default size
                        var animation = new Animation(v => PerushimPanel.HeightRequest = v,
                            currentHeight, _perushimPanelHeight);
                        animation.Commit(PerushimPanel, "SnapPerushim", length: 200, easing: Easing.CubicOut);
                    }
                }
                break;

            default:
                // Other gesture statuses need no panel handling.
                break;
        }
    }

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
    /// Sets up drag handling for the exit fullscreen button.
    /// On Android: uses native touch with raw screen coordinates for pixel-perfect tracking.
    /// On other platforms: uses MAUI gesture recognizers.
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
        if (_isMenuOpen)
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
        // Close circular menu if open
        if (_isMenuOpen)
        {
            _isMenuOpen = false;
            var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };
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

        // Hide Shell navigation bar (no TabBar in this app - single page per FlyoutItem)
        Shell.SetNavBarIsVisible(this, false);
        ReaderToolbar.IsVisible = false;

        // Hide bottom bar completely
        BottomBar.IsVisible = false;
        FloatingMenuContainer.IsVisible = false;

        // Show floating exit button (reset position first)
        ExitFullScreenButton.TranslationX = 0;
        ExitFullScreenButton.TranslationY = 0;
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
        FloatingMenuContainer.IsVisible = true;
#if ANDROID
        UpdateReaderBack();
#endif
    }

    #endregion
}
