namespace BibleOnSite.Pages;

using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

/// <summary>
/// Page for displaying a Perek (chapter) with its pasukim (verses).
/// </summary>
public partial class PerekPage : ContentPage
{
    private readonly PerekViewModel _viewModel;
    private bool _isLoading;
    private DateTime _lastLongPressTime = DateTime.MinValue;

    // Circular menu state
    private bool _isMenuOpen;
    private const int AnimationDurationMs = 300;

    // Articles view state
    private bool _isShowingArticles;

    public PerekPage()
    {
        InitializeComponent();
        _viewModel = new PerekViewModel();
        BindingContext = _viewModel;
    }

    public PerekPage(PerekViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        // If no perek is loaded, load perek 1
        if (_viewModel.Perek == null && !_isLoading)
        {
            _isLoading = true;
            try
            {
                // Load data from SQLite database
                await _viewModel.LoadByPerekIdAsync(1);
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

        // Handle navigation parameters if needed
    }

    /// <summary>
    /// Handles tap on pasuk - toggles selection if in selection mode.
    /// </summary>
    private void OnPasukTapped(object? sender, TappedEventArgs e)
    {
        // Skip tap if long press just happened (within 800ms)
        if ((DateTime.Now - _lastLongPressTime).TotalMilliseconds < 800)
            return;

        if (e.Parameter is int pasukNum)
        {
            // If in selection mode, tap toggles selection
            if (_viewModel.SelectedPasukNums.Count > 0)
            {
                _viewModel.ToggleSelectedPasuk(pasukNum);
                UpdatePasukSelection(sender, pasukNum);
            }
        }
    }

    /// <summary>
    /// Handles right-click on pasuk - enters selection mode (Windows).
    /// </summary>
    private void OnPasukRightClicked(object? sender, TappedEventArgs e)
    {
        try
        {
            if (e.Parameter is int pasukNum)
            {
                _lastLongPressTime = DateTime.Now;
                _viewModel.ToggleSelectedPasuk(pasukNum);
                UpdatePasukSelection(sender, pasukNum);
                TriggerHapticFeedback();
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"OnPasukRightClicked error: {ex.Message}");
        }
    }

    /// <summary>
    /// Handles long press on pasuk via TouchBehavior - enters selection mode.
    /// </summary>
    private void OnPasukLongPress(object? sender, CommunityToolkit.Maui.Core.LongPressCompletedEventArgs e)
    {
        _lastLongPressTime = DateTime.Now;

        // The sender is the TouchBehavior - get the Pasuk from BindingContext
        if (sender is BindableObject bindable && bindable.BindingContext is Pasuk pasuk)
        {
            _viewModel.ToggleSelectedPasuk(pasuk.PasukNum);
            UpdateSelectionBar();
            TriggerHapticFeedback();
        }
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
        if (!string.IsNullOrEmpty(text))
        {
            await Clipboard.SetTextAsync(text);
            SelectionCopyButton.Text = "\uf32a";
            TriggerHapticFeedback();
            await DisplayAlert("", "בחירה הועתקה ללוח", "אישור");
            SelectionCopyButton.Text = "\uf32b";
        }
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
    /// Triggers haptic feedback (vibration) for long press.
    /// </summary>
    private static void TriggerHapticFeedback()
    {
        try
        {
#if ANDROID || IOS
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

        // Enable clicks and fade in (buttons are already at final positions via AbsoluteLayout)
        foreach (var button in buttons)
        {
            button.InputTransparent = false;
        }

        // Change FAB icon to X
        CircularMenuButton.Text = "✕";
        CircularMenuButton.BackgroundColor = Colors.Red;

        // Animate FAB rotation and fade in all buttons
        var animations = new List<Task>
        {
            CircularMenuButton.RotateTo(180, 250, Easing.SpringOut)
        };

        foreach (var button in buttons)
        {
            animations.Add(button.FadeTo(1, 200));
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
        CircularMenuButton.BackgroundColor = Color.FromArgb("#512BD4");

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
            await _viewModel.LoadByPerekIdAsync(perekId);
            // Scroll to top after loading new perek
            PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: false);
            // Update articles badge
            await UpdateArticlesCountAsync();

            // If showing articles, reload them for the new perek
            if (_isShowingArticles)
            {
                await LoadArticlesAsync();
            }
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
            // Scroll to header (top)
            if (_viewModel.Perek?.Pasukim?.Count > 0)
            {
                PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: true);
            }
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
            PasukimCollection.IsVisible = false;
            ArticlesCollection.IsVisible = true;
            Console.WriteLine("[Articles] Visibility switched");

            // Update button states - highlight articles button
            Console.WriteLine("[Articles] Updating button color...");
            ArticlesButton.TextColor = Application.Current?.RequestedTheme == AppTheme.Dark
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

            // Simple visibility swap instead of animation
            ArticlesCollection.IsVisible = false;
            PasukimCollection.IsVisible = true;

            // Reset button color
            ArticlesButton.TextColor = Application.Current?.RequestedTheme == AppTheme.Dark
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
            // Clear selection
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
    private double _perushimPanelHeight;

    private async void OnPerushimChevronClicked(object? sender, EventArgs e)
    {
        _isPerushimOpen = !_isPerushimOpen;

        // Toggle chevron icon: up (\uf2b7) vs down (\uf2a4)
        PerushimChevronButton.Text = _isPerushimOpen ? "\uf2a4" : "\uf2b7";

        // Calculate panel height: 33% of total page height + bottom bar (90)
        // This ensures panel extends to the bottom of the viewport
        var totalHeight = MainGrid.Height;
        _perushimPanelHeight = (totalHeight * 0.33) + 90; // 90 = bottom bar height

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

    private double _exitButtonPanX;
    private double _exitButtonPanY;

    /// <summary>
    /// Handles pan gesture on exit full screen button - allows dragging.
    /// Note: X is negated to account for RTL layout coordinate inversion.
    /// </summary>
    private void OnExitFullScreenButtonPan(object? sender, PanUpdatedEventArgs e)
    {
        switch (e.StatusType)
        {
            case GestureStatus.Running:
                // Negate X for RTL layout
                ExitFullScreenButton.TranslationX = _exitButtonPanX - e.TotalX;
                ExitFullScreenButton.TranslationY = _exitButtonPanY + e.TotalY;
                break;
            case GestureStatus.Completed:
                _exitButtonPanX = ExitFullScreenButton.TranslationX;
                _exitButtonPanY = ExitFullScreenButton.TranslationY;
                break;
        }
    }

    #region Swipe Navigation

    private bool _isNavigating;

    /// <summary>
    /// Handles swipe left gesture - navigates to previous perek.
    /// In RTL layout, swipe left = backward/previous (like turning page forward in Hebrew book).
    /// </summary>
    private void OnSwipedLeft(object? sender, SwipedEventArgs e)
    {
        if (_isShowingArticles || _isNavigating) return;

        // Don't navigate if we're at the first perek
        if (_viewModel.PerekId <= 1)
            return;

        _isNavigating = true;
        MainThread.BeginInvokeOnMainThread(async () =>
        {
            try
            {
                await _viewModel.LoadPreviousAsync();
                await Task.Delay(50); // Small delay to let binding update
                PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: false);
                _ = UpdateArticlesCountAsync();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Swipe left error: {ex.Message}");
            }
            finally
            {
                _isNavigating = false;
            }
        });
    }

    /// <summary>
    /// Handles swipe right gesture - navigates to next perek.
    /// In RTL layout, swipe right = forward/next (like turning page backward in Hebrew book).
    /// </summary>
    private void OnSwipedRight(object? sender, SwipedEventArgs e)
    {
        if (_isShowingArticles || _isNavigating) return;

        // Don't navigate if we're at the last perek
        if (_viewModel.PerekId >= 929)
            return;

        _isNavigating = true;
        MainThread.BeginInvokeOnMainThread(async () =>
        {
            try
            {
                await _viewModel.LoadNextAsync();
                await Task.Delay(50); // Small delay to let binding update
                PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: false);
                _ = UpdateArticlesCountAsync();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Swipe right error: {ex.Message}");
            }
            finally
            {
                _isNavigating = false;
            }
        });
    }

    /// <summary>
    /// Navigates to another perek with swipe animation.
    /// </summary>
    private async Task NavigateWithSwipeAnimationAsync(SwipeDirection direction, Func<Task> loadAction)
    {
        _isNavigating = true;
        const uint duration = 150;
        const double slideDistance = 300; // Fixed distance instead of dynamic

        // Determine slide direction
        var endX = direction == SwipeDirection.Left ? slideDistance : -slideDistance;
        var newStartX = direction == SwipeDirection.Left ? -slideDistance : slideDistance;

        try
        {
            // Fade and slide out current content
            var slideOut = PasukimCollection.TranslateTo(endX, 0, duration, Easing.CubicIn);
            var fadeOut = PasukimCollection.FadeTo(0.3, duration);
            await Task.WhenAll(slideOut, fadeOut);

            // Load new content
            await loadAction();

            // Position for slide in
            PasukimCollection.TranslationX = newStartX;
            PasukimCollection.Opacity = 0.3;

            // Scroll to top
            PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: false);

            // Slide and fade in new content
            var slideIn = PasukimCollection.TranslateTo(0, 0, duration, Easing.CubicOut);
            var fadeIn = PasukimCollection.FadeTo(1, duration);
            await Task.WhenAll(slideIn, fadeIn);

            // Update articles badge
            _ = UpdateArticlesCountAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Swipe animation error: {ex.Message}");
            // Reset state on error
            PasukimCollection.TranslationX = 0;
            PasukimCollection.Opacity = 1;
        }
        finally
        {
            _isNavigating = false;
        }
    }

    #endregion

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
            CircularMenuButton.BackgroundColor = Color.FromArgb("#512BD4");
            CircularMenuButton.Rotation = 0;
        }

        // Hide Shell navigation bar (no TabBar in this app - single page per FlyoutItem)
        Shell.SetNavBarIsVisible(this, false);

        // Hide bottom bar completely
        BottomBar.IsVisible = false;
        FloatingMenuContainer.IsVisible = false;

        // Remove footer spacers since bottom bar is hidden
        PasukimFooterSpacer.HeightRequest = 0;
        ArticlesFooterSpacer.HeightRequest = 0;

        // Show floating exit button (reset position first)
        _exitButtonPanX = 0;
        _exitButtonPanY = 0;
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

        // Restore footer spacers for bottom bar
        PasukimFooterSpacer.HeightRequest = 90;
        ArticlesFooterSpacer.HeightRequest = 90;
    }

    #endregion
}
