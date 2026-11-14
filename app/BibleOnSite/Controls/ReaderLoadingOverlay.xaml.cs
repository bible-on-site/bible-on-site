namespace BibleOnSite.Controls;

/// <summary>
/// The reader's full-area loading overlay shared by the perek, parasha and
/// masora readers: a spinner state while the carousel initialises, and a
/// retryable error state when a bounded load fails (#2084).
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderLoadingOverlay : Grid
#pragma warning restore S2333
{
    /// <summary>Raised when the retry button on the error panel is tapped.</summary>
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    public event EventHandler? RetryRequested;
#pragma warning restore S3264

    public static readonly BindableProperty LoadingTextProperty =
        BindableProperty.Create(nameof(LoadingText), typeof(string), typeof(ReaderLoadingOverlay), string.Empty,
            propertyChanged: (bindable, _, value) => ((ReaderLoadingOverlay)bindable).LoadingLabel.Text = (string)value);

    /// <summary>The "מתחבר לפרק…" style caption under the spinner.</summary>
    public string LoadingText
    {
        get => (string)GetValue(LoadingTextProperty);
        set => SetValue(LoadingTextProperty, value);
    }

    public static readonly BindableProperty ErrorTitleProperty =
        BindableProperty.Create(nameof(ErrorTitle), typeof(string), typeof(ReaderLoadingOverlay), string.Empty,
            propertyChanged: (bindable, _, value) => ((ReaderLoadingOverlay)bindable).ErrorTitleLabel.Text = (string)value);

    /// <summary>The "שגיאה בטעינת הפרק" style heading on the error panel.</summary>
    public string ErrorTitle
    {
        get => (string)GetValue(ErrorTitleProperty);
        set => SetValue(ErrorTitleProperty, value);
    }

    public static readonly BindableProperty AutomationIdPrefixProperty =
        BindableProperty.Create(nameof(AutomationIdPrefix), typeof(string), typeof(ReaderLoadingOverlay), "ReaderLoad",
            propertyChanged: (bindable, _, value) => ((ReaderLoadingOverlay)bindable).ApplyAutomationIdPrefix((string)value));

    /// <summary>
    /// Automation-id prefix for the error panel: "PerekLoad" produces
    /// PerekLoadError / PerekLoadErrorDetail / PerekLoadRetryButton.
    /// </summary>
    public string AutomationIdPrefix
    {
        get => (string)GetValue(AutomationIdPrefixProperty);
        set => SetValue(AutomationIdPrefixProperty, value);
    }

    private bool _showRequested;
    private bool _readerNavigated;

    public ReaderLoadingOverlay()
    {
        InitializeComponent();
        Loaded += (_, _) => ShowIfReady();
    }

    /// <summary>Swaps the overlay to its spinner state (initial load and retry).</summary>
    public void ShowLoading()
    {
        ErrorPanel.IsVisible = false;
        LoadingSpinner.IsRunning = true;
        LoadingIndicator.IsVisible = true;
        Show();
    }

    /// <summary>Swaps the overlay to its retryable error state.</summary>
    public void ShowError(Exception ex)
    {
        LoadingSpinner.IsRunning = false;
        LoadingIndicator.IsVisible = false;
        ErrorDetailLabel.Text = ex.Message;
        ErrorPanel.IsVisible = true;
        Show();
    }

    /// <summary>Hides the overlay once the carousel is ready.</summary>
    public void Hide()
    {
        _showRequested = false;
        LoadingSpinner.IsRunning = false;
        IsVisible = false;
    }

    /// <summary>
    /// Windows must attach the overlay and finish the reader's navigation
    /// before making its composition visual visible. Elapsed time is not a
    /// readiness signal; both lifecycle events may occur in either order.
    /// </summary>
    private void Show()
    {
        _showRequested = true;
        ShowIfReady();
    }

    public void ReaderNavigatedTo()
    {
        _readerNavigated = true;
        ShowIfReady();
    }

    public void ReaderNavigatedFrom()
    {
        _readerNavigated = false;
        IsVisible = false;
    }

    private void ShowIfReady()
    {
        if (_showRequested && ReadyToShow)
        {
            IsVisible = true;
        }
    }

    // Mobile never needs the Windows composition workaround.
    private bool ReadyToShow => !OperatingSystem.IsWindows() || (_readerNavigated && IsLoaded);

    private void ApplyAutomationIdPrefix(string prefix)
    {
        ErrorTitleLabel.AutomationId = prefix + "Error";
        ErrorDetailLabel.AutomationId = prefix + "ErrorDetail";
        RetryButton.AutomationId = prefix + "RetryButton";
    }

    private void OnRetryClicked(object? sender, EventArgs e) =>
        RetryRequested?.Invoke(this, EventArgs.Empty);
}
