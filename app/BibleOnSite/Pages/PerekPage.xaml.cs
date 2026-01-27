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
    private const double MenuRadius = 80.0;
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

        // Rotate the toggle button
        _ = CircularMenuButton.RotateTo(45, (uint)AnimationDurationMs, Easing.BounceOut);

        // Calculate positions for 4 items in an arc (from ~220° to ~320°)
        var angles = new[] { 220.0, 250.0, 290.0, 320.0 }; // degrees
        var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };

        var animationTasks = new List<Task>();

        for (int i = 0; i < buttons.Length; i++)
        {
            var button = buttons[i];
            var angleRad = angles[i] * Math.PI / 180.0;

            var x = Math.Cos(angleRad) * MenuRadius;
            var y = Math.Sin(angleRad) * MenuRadius;

            // Reset position to center
            button.TranslationX = 0;
            button.TranslationY = 0;

            // Animate to arc position
            animationTasks.Add(button.TranslateTo(x, y, (uint)AnimationDurationMs, Easing.BounceOut));
            animationTasks.Add(button.FadeTo(1, (uint)(AnimationDurationMs * 0.6)));
            animationTasks.Add(button.ScaleTo(1, (uint)AnimationDurationMs, Easing.BounceOut));
        }

        await Task.WhenAll(animationTasks);
    }

    /// <summary>
    /// Closes the circular menu with animated contraction.
    /// </summary>
    private async Task CloseCircularMenuAsync()
    {
        // Rotate the toggle button back
        _ = CircularMenuButton.RotateTo(0, (uint)(AnimationDurationMs * 0.6), Easing.CubicIn);

        var buttons = new[] { PrevPerekButton, TodayButton, PerekPickerButton, NextPerekButton };
        var animationTasks = new List<Task>();

        foreach (var button in buttons)
        {
            animationTasks.Add(button.TranslateTo(0, 0, (uint)(AnimationDurationMs * 0.6), Easing.CubicIn));
            animationTasks.Add(button.FadeTo(0, (uint)(AnimationDurationMs * 0.4)));
            animationTasks.Add(button.ScaleTo(0, (uint)(AnimationDurationMs * 0.6), Easing.CubicIn));
        }

        await Task.WhenAll(animationTasks);

        CircularMenuOverlay.IsVisible = false;
        CircularMenuOverlay.InputTransparent = true;
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
    /// Handles text button click - scrolls to first pasuk.
    /// </summary>
    private void OnTextButtonClicked(object? sender, EventArgs e)
    {
        // Scroll to first pasuk
        if (_viewModel.Perek?.Pasukim?.Count > 0)
        {
            PasukimCollection.ScrollTo(0);
        }
    }

    /// <summary>
    /// Handles expand button click - toggles full screen mode.
    /// </summary>
    private void OnExpandClicked(object? sender, EventArgs e)
    {
        // Toggle shell visibility for immersive mode
        Shell.SetNavBarIsVisible(this, !Shell.GetNavBarIsVisible(this));
        Shell.SetTabBarIsVisible(this, !Shell.GetTabBarIsVisible(this));

        // Update button text
        ExpandButton.Text = Shell.GetNavBarIsVisible(this) ? "⛶" : "⛶";
    }

    #endregion
}
