namespace BibleOnSite.Pages;

using BibleOnSite.Behaviors;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
#if IOS
using Microsoft.Maui.Controls.PlatformConfiguration.iOSSpecific;
#endif

/// <summary>
/// Page for displaying a Perek (chapter) with its pasukim (verses).
/// </summary>
public partial class PerekPage : ContentPage
{
    private readonly PerekViewModel _viewModel;
    private bool _isLoading;
    private DateTime _lastLongPressTime = DateTime.MinValue;
    private DateTime _pointerPressedTime = DateTime.MinValue;
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
    private static DateTime _lastScrollTime = DateTime.MinValue;
    private const int ScrollCooldownMs = 500; // Don't allow long-press within 500ms of scroll

    /// <summary>
    /// Returns true if the user is currently scrolling or just finished scrolling.
    /// Used by LongPressBehavior to prevent false triggers during scroll.
    /// </summary>
    public static bool IsScrolling => (DateTime.Now - _lastScrollTime).TotalMilliseconds < ScrollCooldownMs;

    /// <summary>
    /// Proxy for article selection highlight binding (avoids XC0045 when binding from Article template).
    /// </summary>
    public int? SelectedArticleId => _viewModel.SelectedArticleId;

    public PerekPage()
    {
        InitializeComponent();
        _viewModel = new PerekViewModel();
        BindingContext = _viewModel;
        ForwardSelectedArticleIdChanged();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupGlobalTouchHandler();
        SetupExitButtonDragHandler();
    }

    public PerekPage(PerekViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
        ForwardSelectedArticleIdChanged();
        SetupFontSizeResources();
        SetupCarouselNavigation();
        SetupGlobalTouchHandler();
        SetupExitButtonDragHandler();
    }

    /// <summary>
    /// Subscribes to ViewModel.NavigationRequested so that programmatic
    /// navigation (prev/next/today/picker) jumps the CarouselView instantly
    /// via ScrollTo(animate:false) instead of animating through every
    /// intermediate position (which would cascade OnCarouselItemChanged).
    /// </summary>
    private void SetupCarouselNavigation()
    {
        _viewModel.NavigationRequested += (_, perekId) =>
        {
            var targetIndex = perekId - 1;
            // Guard: suppress OnCarouselItemChanged while we reposition
            _carouselInitializing = true;
            PerekCarousel.ScrollTo(targetIndex, animate: false);
            _carouselInitializing = false;

            // Post-navigation housekeeping (ViewModel state is already set by
            // NavigateToPerekAsync before this event fires)
            UpdateSelectionBar();
            SetAnalyticsScreenForPerek();
            if (_isMenuOpen) RefreshNavButtonVisuals();
            _ = UpdateArticlesCountAsync();
            _ = _viewModel.PreloadAdjacentPasukimAsync(perekId);
        };
    }

    /// <summary>
    /// Populates page-level DynamicResource entries for font sizes and keeps them
    /// in sync when the user changes the font-factor preference.
    /// DynamicResource is used because x:Reference bindings inside CarouselView
    /// DataTemplates are unreliable on Android.
    /// </summary>
    private void SetupFontSizeResources()
    {
        UpdateFontSizeResources(_viewModel.FontFactor);
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PerekViewModel.FontFactor))
            {
                MainThread.BeginInvokeOnMainThread(() =>
                    UpdateFontSizeResources(_viewModel.FontFactor));
            }
        };
    }

    private void UpdateFontSizeResources(double factor)
    {
        Resources["PasukFontSize"] = factor * 18;
        Resources["PasukNumFontSize"] = factor * 16;
        Resources["PerushNameFontSize"] = factor * 14;
        Resources["PerushContentFontSize"] = factor * 16;
    }

    private void ForwardSelectedArticleIdChanged()
    {
        _viewModel.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(PerekViewModel.SelectedArticleId))
                OnPropertyChanged(nameof(SelectedArticleId));
            // When perek changes via prev/next, refresh articles, badge, and nav button visuals
            if (e.PropertyName == nameof(PerekViewModel.Perek) || e.PropertyName == "Perek")
            {
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    _ = UpdateArticlesCountAsync();
                    if (_isShowingArticles)
                        _ = LoadArticlesAsync();
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
        if (!_isMenuOpen) return;

        var canPrev = _viewModel.CanGoToPreviousPerek;
        var canNext = _viewModel.CanGoToNextPerek;

        PrevPerekButton.IsEnabled = canPrev;
        PrevPerekButton.Opacity = canPrev ? 1.0 : 0.4;

        NextPerekButton.IsEnabled = canNext;
        NextPerekButton.Opacity = canNext ? 1.0 : 0.4;
    }

    /// <summary>
    /// Sets up a global touch handler to catch taps that CollectionView swallows.
    /// </summary>
    private void SetupGlobalTouchHandler()
    {
#if ANDROID
        MainActivity.TapDetected += OnGlobalTapDetected;
#endif
    }

#if ANDROID
    private void OnGlobalTapDetected(object? sender, (float X, float Y) position)
    {
        // Only process taps in selection mode
        if (_viewModel.SelectedPasukNums.Count == 0)
            return;

        // Note: With CarouselView, FindTappedPasuk is disabled as we can't directly access
        // the inner CollectionView. Regular tap gestures on individual pasukim still work.
        // If needed, this could be re-enabled by finding the current carousel item's CollectionView.
    }

    /// <summary>
    /// Finds which pasuk was tapped by checking bounds of visible items.
    /// Note: Disabled with CarouselView - tap gestures on pasukim work directly.
    /// </summary>
    private int FindTappedPasuk(float screenX, float screenY)
    {
        return -1; // Disabled with CarouselView
    }
#endif

    /// <summary>
    /// Tracks scroll events to prevent long-press during scroll.
    /// </summary>
    private void OnPasukimScrolled(object? sender, ItemsViewScrolledEventArgs e)
    {
        _lastScrollTime = DateTime.Now;
        // Cancel any pending long-press (pointer-based for Windows)
        _longPressTokenSource?.Cancel();
        _pressedPasukNum = -1;
        // Cancel any pending long-press (behavior-based for Android)
        LongPressBehavior.CancelAllPending();
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
#if IOS
        ApplyBottomBarSafeArea();
#endif
        // If no perek is loaded, load perek based on preference (today's or last learnt)
        if (_viewModel.Perek == null && !_isLoading)
        {
            _isLoading = true;
            try
            {
                var perekId = GetInitialPerekId();

                // Show loading overlay while the carousel initialises.
                CarouselLoadingOverlay.IsVisible = true;

                // Guard: ignore OnCarouselItemChanged during initial load.
                // The CarouselView fires spurious CurrentItemChanged events when it
                // first receives its ItemsSource, which would reset state.
                _carouselInitializing = true;
                await _viewModel.LoadByPerekIdAsync(perekId);

                // CarouselView resets Position to 0 when ItemsSource changes.
                // Force it to the correct position without animation.
                var targetPos = _viewModel.PerekId - 1;
                PerekCarousel.ScrollTo(targetPos, animate: false);

                // Yield so the CarouselView processes the scroll + layout pass.
                await Task.Delay(50);

                // Sync the ViewModel position (two-way binding may lag)
                _viewModel.CarouselPosition = targetPos;

                _carouselInitializing = false;

                // Hide loading overlay — carousel is ready
                CarouselLoadingOverlay.IsVisible = false;

                // Update articles count badge
                await UpdateArticlesCountAsync();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Failed to load perek: {ex.Message}");
                await DisplayAlert("Error", $"Failed to load perek: {ex.Message}", "OK");
            }
            finally
            {
                _isLoading = false;
            }
        }
    }

    private static int GetInitialPerekId()
    {
        var prefs = PreferencesService.Instance;
        if (prefs.PerekToLoad == PerekToLoad.Todays)
        {
            if (PerekDataService.Instance.IsLoaded)
                return PerekDataService.Instance.GetTodaysPerekId();
            return 1; // Fallback if tanah not loaded (LoadingPage loads it, but race possible)
        }
        var last = prefs.LastLearntPerek;
        return last is > 0 and <= 929 ? last.Value : 1;
    }

    /// <summary>
    /// Updates the articles count badge for the current perek.
    /// </summary>
    private async Task UpdateArticlesCountAsync()
    {
        try
        {
            var articles = await ArticleService.Instance.GetArticlesByPerekIdAsync(_viewModel.PerekId);
            var count = articles.Count;

            // Update badge visibility and text
            ArticlesBadge.IsVisible = count > 0;
            if (count > 0 && ArticlesBadge.Content is Label badgeLabel)
            {
                badgeLabel.Text = count.ToString();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error fetching articles count: {ex.Message}");
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
    /// Extends the bottom bar to the physical bottom on iOS (safe area) so there is no gap.
    /// </summary>
    private void ApplyBottomBarSafeArea()
    {
        var insets = Microsoft.Maui.Controls.PlatformConfiguration.iOSSpecific.Page.GetSafeAreaInsets(this);
        var bottom = insets.Bottom;
        if (bottom <= 0)
            return;
        BottomBar.Padding = new Thickness(0, 0, 0, bottom);
        BottomBar.HeightRequest = 90 + bottom;
        // Note: PasukimFooterSpacer is inside a CarouselView DataTemplate and cannot be
        // referenced by x:Name. Its HeightRequest is set statically in XAML.
        ArticlesFooterSpacer.HeightRequest = 90 + bottom;
    }
#endif

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
    /// <summary>
    /// Resolves the pasuk number from a gesture event.
    /// Prefers CommandParameter (fast), falls back to the sender's BindingContext
    /// which is more reliable inside nested CarouselView > CollectionView templates
    /// where CommandParameter binding can silently fail.
    /// </summary>
    private static int ResolvePasukNum(object? sender, object? commandParameter)
    {
        if (commandParameter is int p)
            return p;

        // Fallback: sender is the Border whose BindingContext is the Pasuk
        if (sender is BindableObject bo && bo.BindingContext is Pasuk pasuk)
            return pasuk.PasukNum;

        return -1;
    }

    private void OnPasukTapped(object? sender, TappedEventArgs e)
    {
        // Cancel any pending long-press timers (Android doesn't receive Up events in CollectionView)
        LongPressBehavior.CancelAllPending();

        // Skip tap if long press just happened (prevents tap-on-release from toggling selection off)
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 300)
            return;

        var pasukNum = ResolvePasukNum(sender, e.Parameter);
        if (pasukNum <= 0) return;

        // If in selection mode, tap toggles selection
        if (_viewModel.SelectedPasukNums.Count > 0)
        {
            _viewModel.ToggleSelectedPasuk(pasukNum);
            UpdatePasukSelection(sender, pasukNum);
        }
    }

    /// <summary>
    /// Handles right-click on pasuk - enters selection mode (Windows only).
    /// </summary>
    private void OnPasukRightClicked(object? sender, TappedEventArgs e)
    {
#if WINDOWS
        var pasukNum = ResolvePasukNum(sender, e.Parameter);
        if (pasukNum <= 0) return;

        // Don't set _lastLongPressTime - right-click doesn't need debounce
        var wasEmpty = _viewModel.SelectedPasukNums.Count == 0;
        _viewModel.ToggleSelectedPasuk(pasukNum);
        UpdatePasukSelection(sender, pasukNum);
        // Vibrate when entering selection mode
        if (wasEmpty && _viewModel.SelectedPasukNums.Count > 0)
        {
            TriggerHapticFeedback();
        }
#endif
    }

    /// <summary>
    /// Handles pointer press - starts long-press timer.
    /// </summary>
    private void OnPasukPointerPressed(object? sender, PointerEventArgs e)
    {
        // Don't start long-press detection if scrolling
        if (IsScrolling)
            return;

        _longPressTokenSource?.Cancel();
        _longPressTokenSource = new CancellationTokenSource();

        if (sender is Border border && border.BindingContext is Pasuk pasuk)
        {
            _pressedPasukNum = pasuk.PasukNum;
            _pointerPressedTime = DateTime.Now;

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
#if ANDROID
        _lastLongPressTime = DateTime.Now;

        // The sender is the LongPressBehavior - get the Pasuk from the associated view's BindingContext
        if (sender is LongPressBehavior behavior &&
            behavior.AssociatedView?.BindingContext is Pasuk pasuk)
        {
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
    private void UpdatePasukSelection(object? sender, int pasukNum)
    {
        UpdateSelectionBar();
    }

    #region Selection Bar Methods

    private void UpdateSelectionBar()
    {
        var count = _viewModel.SelectedPasukNums.Count;
        var isSelectionMode = count > 0;

        Shell.SetNavBarIsVisible(this, !isSelectionMode);
        SelectionBar.IsVisible = isSelectionMode;
        SelectionCountLabel.Text = count.ToString();
    }

    private void ClearAllSelections()
    {
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
        if (string.IsNullOrEmpty(text)) return;

        await Clipboard.SetTextAsync(text);
        TriggerHapticFeedback();
        // Inline feedback: show clipboard-checkmark icon for 1.5s then restore copy icon
        SelectionCopyButton.Text = "\ue34c"; // clipboard_checkmark_24_regular
        await Task.Delay(1500);
        SelectionCopyButton.Text = "\uf32b"; // copy_24_regular
    }

    private string GetSelectedPesukimText()
    {
        if (_viewModel.Perek == null) return string.Empty;
        var selected = _viewModel.Perek.Pasukim?
            .Where(p => _viewModel.IsPasukSelected(p.PasukNum))
            .OrderBy(p => p.PasukNum)
            .ToList();
        if (selected == null || selected.Count == 0) return string.Empty;
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
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Haptic feedback failed: {ex.Message}");
        }
    }

    #region Circular Menu Methods

    /// <summary>
    /// Toggles the circular menu open/closed state with animation.
    /// </summary>
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

        // Change FAB icon to X
        CircularMenuButton.Text = "✕";
        CircularMenuButton.BackgroundColor = Colors.Red;

        // Animate FAB rotation and fade in all buttons (disabled = 0.4, enabled = 1)
        var animations = new List<Task>
        {
            CircularMenuButton.RotateTo(180, 250, Easing.SpringOut)
        };

        foreach (var button in buttons)
        {
            var targetOpacity = button.IsEnabled ? 1.0 : 0.4;
            animations.Add(button.FadeTo(targetOpacity, 200));
        }

        await Task.WhenAll(animations);
    }

    /// <summary>
    /// Closes the circular menu with animated contraction.
    /// </summary>
    private async Task CloseCircularMenuAsync()
    {
        var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };

        // Change back to hamburger
        CircularMenuButton.Text = "☰";
        CircularMenuButton.BackgroundColor = (Color)Application.Current!.Resources["Primary"];

        // Animate FAB rotation and fade out all buttons
        var animations = new List<Task>
        {
            CircularMenuButton.RotateTo(0, 200, Easing.SpringOut)
        };

        foreach (var button in buttons)
        {
            animations.Add(button.FadeTo(0, 150));
        }

        await Task.WhenAll(animations);

        // Disable clicks on hidden buttons
        foreach (var button in buttons)
        {
            button.InputTransparent = true;
        }
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
    /// Shows the perek picker popup.
    /// </summary>
    private void OnPerekPickerClicked(object? sender, EventArgs e)
    {
        // Menu stays open - don't close
        // Show the cascading perek picker popup with current perek pre-selected
        PerekPickerPopup.Show(_viewModel.PerekId);
    }

    /// <summary>
    /// Handles perek selection from the picker popup.
    /// </summary>
    private async void OnPerekPickerSelected(object? sender, int perekId)
    {
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
    private async void OnArticlesButtonClicked(object? sender, EventArgs e)
    {
        try
        {
            Console.WriteLine("[Articles] Button clicked, _isShowingArticles=" + _isShowingArticles);

            if (_isShowingArticles)
            {
                // Already showing articles, do nothing or toggle back
                return;
            }

            await ShowArticlesViewAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Articles] Error in OnArticlesButtonClicked: {ex}");
        }
    }

    /// <summary>
    /// Shows the articles view with flip animation.
    /// </summary>
    private async Task ShowArticlesViewAsync()
    {
        try
        {
            Console.WriteLine("[Articles] ShowArticlesViewAsync starting...");
            _isShowingArticles = true;

            // Load articles for the current perek (header stays the same)
            Console.WriteLine("[Articles] Loading articles...");
            await LoadArticlesAsync();
            Console.WriteLine("[Articles] Articles loaded");

            // Simple visibility swap instead of animation (animation may crash on Windows)
            Console.WriteLine("[Articles] Switching visibility...");
            PerekCarousel.IsVisible = false;
            ArticlesCollection.IsVisible = true;
            Console.WriteLine("[Articles] Visibility switched");

            // Update button states - highlight articles button
            Console.WriteLine("[Articles] Updating button color...");
            ArticlesButton.TextColor = Microsoft.Maui.Controls.Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb("#BB86FC")
                : Color.FromArgb("#512BD4");
            Console.WriteLine("[Articles] ShowArticlesViewAsync complete");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[Articles] Error in ShowArticlesViewAsync: {ex}");
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
        catch (Exception ex)
        {
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
            await fromView.ScaleXTo(0, duration, Easing.CubicIn);

            // Switch visibility at midpoint
            fromView.IsVisible = false;
            toView.IsVisible = true;
            toView.ScaleX = 0;

            // Second half - rotate in
            await toView.ScaleXTo(1, duration, Easing.CubicOut);
        }
        catch (Exception ex)
        {
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
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Error navigating to article: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Loads articles for the current perek.
    /// </summary>
    private async Task LoadArticlesAsync()
    {
        try
        {
            var articles = await ArticleService.Instance.GetArticlesByPerekIdAsync(_viewModel.PerekId);
            ArticlesCollection.ItemsSource = articles;
        }
        catch (Exception ex)
        {
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

    private void OnPerushCheckboxChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (sender is not CheckBox checkBox)
            return;
        var grid = checkBox.Parent as Grid;
        var perush = grid?.BindingContext as Perush;
        if (perush != null)
        {
            _viewModel.ToggleCheckedPerush(perush.Id);
        }
    }

    private async void OnDownloadPerushimClicked(object? sender, EventArgs e)
    {
        if (sender is Button btn)
            btn.IsEnabled = false;
        try
        {
            var ok = await PerushimNotesService.Instance.TryDownloadNotesAsync();
            if (ok && _viewModel.PerekId > 0)
            {
                await _viewModel.LoadPerushimAsync(_viewModel.PerekId);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Download perushim failed: {ex.Message}");
            await DisplayAlert("שגיאה", "לא ניתן להוריד פירושים. נסו שוב מאוחר יותר.", "אישור");
        }
        finally
        {
            if (sender is Button b)
                b.IsEnabled = true;
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
        // TODO: Calculate expanded height based on inner perushim rows occupation
        _perushimPanelExpandedHeight = totalHeight - 50; // Full screen minus top margin

        // Animate perushim panel slide up/down
        if (_isPerushimOpen)
        {
            // Set height and make visible, start below
            PerushimPanel.HeightRequest = _perushimPanelHeight;
            PerushimPanel.TranslationY = _perushimPanelHeight;
            PerushimPanel.IsVisible = true;

            // Slide up
            await PerushimPanel.TranslateTo(0, 0, 250, Easing.CubicOut);
        }
        else
        {
            // Slide down then hide
            await PerushimPanel.TranslateTo(0, _perushimPanelHeight, 250, Easing.CubicIn);
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
        if (!_isPerushimOpen) return;

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
                            await PerushimPanel.TranslateTo(0, _perushimPanelHeight, 200, Easing.CubicIn);
                            PerushimPanel.IsVisible = false;
                            _isPerushimOpen = false;
                            _isPerushimExpanded = false;
                            PerushimChevronButton.Text = "\uf2b7"; // chevron_up
                        }
                        else
                        {
                            // Snap back to open position
                            await PerushimPanel.TranslateTo(0, 0, 200, Easing.CubicOut);
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
        if (e.Event is not { } motion) return;

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
            Console.WriteLine($"[Carousel] OnChanged IGNORED (initializing)");
            return;
        }

        var incomingId = (e.CurrentItem as Perek)?.PerekId ?? -1;
        var previousId = (e.PreviousItem as Perek)?.PerekId ?? -1;

        if (e.CurrentItem is not Perek perek || perek.PerekId <= 0 || perek.PerekId == _viewModel.PerekId)
        {
            Console.WriteLine($"[Carousel] OnChanged SKIPPED incoming={incomingId} vmPerek={_viewModel.PerekId}");
            return;
        }

        var hasPasukim = perek.Pasukim != null && perek.Pasukim.Count > 0;
        Console.WriteLine($"[Carousel] OnChanged PROCESS incoming={incomingId} prev={previousId} vmPerek={_viewModel.PerekId} pos={_viewModel.CarouselPosition} hasPasukim={hasPasukim}");

        // Lazy-load pasukim if not yet loaded (~5ms from SQLite, non-blocking)
        if (!hasPasukim)
        {
            await _viewModel.EnsurePasukimLoadedAsync(perek);
        }

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

        Console.WriteLine($"[Carousel] OnChanged DONE vmPerek={_viewModel.PerekId} pos={_viewModel.CarouselPosition}");

        // Fire async tasks in the background — never block the next swipe
        _ = UpdateArticlesCountAsync();
        _ = _viewModel.PreloadAdjacentPasukimAsync(perek.PerekId);
        if (_isShowingArticles)
        {
            _ = LoadArticlesAsync();
        }
    }

    /// <summary>
    /// Enters full screen mode - hides navigation and bottom bar.
    /// </summary>
    private void EnterFullScreen()
    {
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
            CircularMenuButton.Text = "☰";
            CircularMenuButton.BackgroundColor = (Color)Application.Current!.Resources["Primary"];
            CircularMenuButton.Rotation = 0;
        }

        // Hide Shell navigation bar (no TabBar in this app - single page per FlyoutItem)
        Shell.SetNavBarIsVisible(this, false);

        // Hide bottom bar completely
        BottomBar.IsVisible = false;
        FloatingMenuContainer.IsVisible = false;

        // Show floating exit button (reset position first)
        ExitFullScreenButton.TranslationX = 0;
        ExitFullScreenButton.TranslationY = 0;
        ExitFullScreenButton.IsVisible = true;
    }

    /// <summary>
    /// Exits full screen mode - restores navigation and bottom bar.
    /// </summary>
    private void ExitFullScreen()
    {
        // Hide floating exit button first
        ExitFullScreenButton.IsVisible = false;

        // Show Shell navigation bar (no TabBar in this app - single page per FlyoutItem)
        Shell.SetNavBarIsVisible(this, true);

        // Show bottom bar
        BottomBar.IsVisible = true;
        FloatingMenuContainer.IsVisible = true;
    }

    #endregion
}
