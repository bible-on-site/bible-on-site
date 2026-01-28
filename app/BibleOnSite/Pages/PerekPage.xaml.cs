namespace BibleOnSite.Pages;

using BibleOnSite.ViewModels;

/// <summary>
/// Page for displaying a Perek (chapter) with its pasukim (verses).
/// </summary>
public partial class PerekPage : ContentPage
{
    private readonly PerekViewModel _viewModel;
    private bool _isLoading;
    private DateTime _pointerPressedTime;
    private int _pressedPasukNum;
    private CancellationTokenSource? _longPressTokenSource;
    private const int LongPressDurationMs = 500;

    // Circular menu state
    private bool _isMenuOpen;
    private const int AnimationDurationMs = 300;

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

    protected override void OnNavigatedTo(NavigatedToEventArgs args)
    {
        base.OnNavigatedTo(args);

        // Handle navigation parameters if needed
    }

    /// <summary>
    /// Handles tap on pasuk - toggles selection if any pasuk is already selected.
    /// </summary>
    private void OnPasukTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is int pasukNum)
        {
            // If any pasuk is selected, tap toggles selection
            if (_viewModel.SelectedPasukNums.Count > 0 || _viewModel.IsPasukSelected(pasukNum))
            {
                _viewModel.ToggleSelectedPasuk(pasukNum);
                UpdatePasukSelection(sender, pasukNum);
            }
        }
    }

    /// <summary>
    /// Handles pointer/touch press start - begins long press detection.
    /// </summary>
    private void OnPasukPointerPressed(object? sender, PointerEventArgs e)
    {
        if (sender is Grid grid && grid.Parent is Border border)
        {
            var pasuk = border.BindingContext as Models.Pasuk;
            if (pasuk != null)
            {
                _pressedPasukNum = pasuk.PasukNum;
                _pointerPressedTime = DateTime.Now;

                // Start long press detection
                _longPressTokenSource?.Cancel();
                _longPressTokenSource = new CancellationTokenSource();

                _ = DetectLongPressAsync(pasuk.PasukNum, border, _longPressTokenSource.Token);
            }
        }
    }

    /// <summary>
    /// Handles pointer/touch release - cancels long press detection.
    /// </summary>
    private void OnPasukPointerReleased(object? sender, PointerEventArgs e)
    {
        _longPressTokenSource?.Cancel();
        _longPressTokenSource = null;
    }

    /// <summary>
    /// Detects long press and triggers pasuk selection with vibration.
    /// </summary>
    private async Task DetectLongPressAsync(int pasukNum, Border border, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(LongPressDurationMs, cancellationToken);

            if (!cancellationToken.IsCancellationRequested)
            {
                // Long press detected - toggle selection and vibrate
                MainThread.BeginInvokeOnMainThread(() =>
                {
                    _viewModel.ToggleSelectedPasuk(pasukNum);
                    UpdatePasukSelection(border, pasukNum);

                    // Trigger haptic feedback (vibration)
                    TriggerHapticFeedback();
                });
            }
        }
        catch (TaskCanceledException)
        {
            // Long press was cancelled (finger lifted before threshold)
        }
    }

    /// <summary>
    /// Updates the visual selection state of a pasuk.
    /// </summary>
    private void UpdatePasukSelection(object? sender, int pasukNum)
    {
        Border? border = null;

        if (sender is Border b)
        {
            border = b;
        }
        else if (sender is View view)
        {
            border = view.Parent as Border ?? view.Parent?.Parent as Border;
        }

        if (border != null)
        {
            bool isSelected = _viewModel.IsPasukSelected(pasukNum);
            border.BackgroundColor = isSelected
                ? (Application.Current?.RequestedTheme == AppTheme.Dark
                    ? Color.FromArgb("#1E3A5F")
                    : Color.FromArgb("#E3F2FD"))
                : (Application.Current?.RequestedTheme == AppTheme.Dark
                    ? Color.FromArgb("#1C1C1E")
                    : Colors.White);
        }
    }

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
        CircularMenuOverlay.IsVisible = true;
        CircularMenuOverlay.InputTransparent = false;

        // Animate hamburger to X with rotation
        var buttonAnimations = new List<Task>
        {
            CircularMenuButton.RotateTo(180, (uint)AnimationDurationMs, Easing.CubicOut)
        };

        // Change to X (dismiss icon) after rotation starts
        await Task.Delay(AnimationDurationMs / 3);
        CircularMenuButton.Text = "✕"; // X/close
        CircularMenuButton.BackgroundColor = Colors.Red;

        // Animate all menu buttons with staggered timing
        var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };

        for (int i = 0; i < buttons.Length; i++)
        {
            var button = buttons[i];
            button.Opacity = 0;
            button.Scale = 0;

            // Stagger the animations slightly
            var delay = i * 50;

            buttonAnimations.Add(Task.Run(async () =>
            {
                await Task.Delay(delay);
                await MainThread.InvokeOnMainThreadAsync(async () =>
                {
                    var fadeTask = button.FadeTo(1, (uint)(AnimationDurationMs * 0.5));
                    var scaleTask = button.ScaleTo(1, (uint)AnimationDurationMs, Easing.BounceOut);
                    await Task.WhenAll(fadeTask, scaleTask);
                });
            }));
        }

        await Task.WhenAll(buttonAnimations);
    }

    /// <summary>
    /// Closes the circular menu with animated contraction.
    /// </summary>
    private async Task CloseCircularMenuAsync()
    {
        // Animate X back to hamburger with rotation
        var buttonAnimations = new List<Task>
        {
            CircularMenuButton.RotateTo(0, (uint)(AnimationDurationMs * 0.6), Easing.CubicIn)
        };

        // Change back to hamburger (navigation icon) after rotation starts
        await Task.Delay(AnimationDurationMs / 4);
        CircularMenuButton.Text = "☰"; // hamburger menu
        CircularMenuButton.BackgroundColor = Color.FromArgb("#2196F3"); // Primary blue

        var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };

        foreach (var button in buttons)
        {
            buttonAnimations.Add(button.FadeTo(0, (uint)(AnimationDurationMs * 0.3)));
            buttonAnimations.Add(button.ScaleTo(0, (uint)(AnimationDurationMs * 0.5), Easing.CubicIn));
        }

        await Task.WhenAll(buttonAnimations);

        CircularMenuOverlay.IsVisible = false;
        CircularMenuOverlay.InputTransparent = true;
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
    /// Handles menu item click - closes the menu after action.
    /// </summary>
    private async void OnMenuItemClicked(object? sender, EventArgs e)
    {
        _isMenuOpen = false;
        await CloseCircularMenuAsync();
    }

    /// <summary>
    /// Shows the perek picker dialog.
    /// </summary>
    private async void OnPerekPickerClicked(object? sender, EventArgs e)
    {
        _isMenuOpen = false;
        await CloseCircularMenuAsync();

        // Show perek picker - simple input for now
        var result = await DisplayPromptAsync(
            "בחר פרק",
            "הזן מספר פרק (1-929):",
            "עבור",
            "ביטול",
            "1",
            maxLength: 3,
            keyboard: Keyboard.Numeric);

        if (!string.IsNullOrEmpty(result) && int.TryParse(result, out var perekId))
        {
            if (perekId >= 1 && perekId <= 929)
            {
                await _viewModel.LoadByPerekIdAsync(perekId);
            }
            else
            {
                await DisplayAlert("שגיאה", "מספר פרק לא תקין. נא להזין מספר בין 1 ל-929.", "אישור");
            }
        }
    }

    /// <summary>
    /// Handles text button click - scrolls to header/top of perek.
    /// </summary>
    private void OnTextButtonClicked(object? sender, EventArgs e)
    {
        // Scroll to header (top)
        if (_viewModel.Perek?.Pasukim?.Count > 0)
        {
            PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: true);
        }
    }

    /// <summary>
    /// Handles perushim chevron button click - toggles chevron direction.
    /// </summary>
    private bool _isPerushimOpen;
    private void OnPerushimChevronClicked(object? sender, EventArgs e)
    {
        _isPerushimOpen = !_isPerushimOpen;
        // Toggle chevron direction (up vs down) - FluentUI icons
        PerushimChevronButton.Text = _isPerushimOpen ? "\uf2a4" : "\uf2b7"; // chevron_down vs chevron_up

        // TODO: Open/close perushim panel when implemented
    }

    /// <summary>
    /// Handles full screen button click - hides top and bottom bars, shows exit button.
    /// </summary>
    private bool _isFullScreen;
    private void OnFullScreenClicked(object? sender, EventArgs e)
    {
        _isFullScreen = true;
        EnterFullScreen();
    }

    /// <summary>
    /// Handles exit full screen button click - restores normal view.
    /// </summary>
    private void OnExitFullScreenClicked(object? sender, EventArgs e)
    {
        _isFullScreen = false;
        ExitFullScreen();
    }

    #region Swipe Navigation

    /// <summary>
    /// Handles swipe left gesture - navigates to next perek.
    /// Note: In RTL layout, swipe left = forward/next.
    /// </summary>
    private async void OnSwipedLeft(object? sender, SwipedEventArgs e)
    {
        // Don't navigate if we're at the last perek
        if (_viewModel.PerekId >= 929)
            return;

        await _viewModel.LoadNextAsync();
        // Scroll to top after loading new perek
        PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: false);
    }

    /// <summary>
    /// Handles swipe right gesture - navigates to previous perek.
    /// Note: In RTL layout, swipe right = backward/previous.
    /// </summary>
    private async void OnSwipedRight(object? sender, SwipedEventArgs e)
    {
        // Don't navigate if we're at the first perek
        if (_viewModel.PerekId <= 1)
            return;

        await _viewModel.LoadPreviousAsync();
        // Scroll to top after loading new perek
        PasukimCollection.ScrollTo(0, position: ScrollToPosition.Start, animate: false);
    }

    #endregion

    /// <summary>
    /// Enters full screen mode - hides navigation and bottom bar.
    /// </summary>
    private void EnterFullScreen()
    {
        // Hide Shell navigation bars
        Shell.SetNavBarIsVisible(this, false);
        Shell.SetTabBarIsVisible(this, false);

        // Hide bottom bar
        BottomBar.IsVisible = false;

        // Show floating exit button
        ExitFullScreenButton.IsVisible = true;
    }

    /// <summary>
    /// Exits full screen mode - restores navigation and bottom bar.
    /// </summary>
    private void ExitFullScreen()
    {
        // Show Shell navigation bars
        Shell.SetNavBarIsVisible(this, true);
        Shell.SetTabBarIsVisible(this, true);

        // Show bottom bar and ensure correct height
        BottomBar.IsVisible = true;
        BottomBar.HeightRequest = 80;

        // Hide floating exit button
        ExitFullScreenButton.IsVisible = false;
    }

    #endregion
}
