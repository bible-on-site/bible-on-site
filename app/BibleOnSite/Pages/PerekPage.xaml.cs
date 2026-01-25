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
}
