namespace BibleOnSite.Controls;

/// <summary>
/// The reader's full-area loading overlay shared by the perek, parasha and
/// masora readers: a spinner state while the carousel initialises, and a
/// retryable error state when a bounded load fails (#2084).
/// </summary>
public partial class ReaderLoadingOverlay : Grid
{
    /// <summary>Raised when the retry button on the error panel is tapped.</summary>
    public event EventHandler? RetryRequested;

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

    public ReaderLoadingOverlay()
    {
        InitializeComponent();
    }

    /// <summary>Swaps the overlay to its spinner state (initial load and retry).</summary>
    public void ShowLoading()
    {
        ErrorPanel.IsVisible = false;
        LoadingIndicator.IsVisible = true;
        IsVisible = true;
    }

    /// <summary>Swaps the overlay to its retryable error state.</summary>
    public void ShowError(Exception ex)
    {
        LoadingIndicator.IsVisible = false;
        ErrorDetailLabel.Text = ex.Message;
        ErrorPanel.IsVisible = true;
        IsVisible = true;
    }

    /// <summary>Hides the overlay once the carousel is ready.</summary>
    public void Hide() => IsVisible = false;

    private void ApplyAutomationIdPrefix(string prefix)
    {
        ErrorTitleLabel.AutomationId = prefix + "Error";
        ErrorDetailLabel.AutomationId = prefix + "ErrorDetail";
        RetryButton.AutomationId = prefix + "RetryButton";
    }

    private void OnRetryClicked(object? sender, EventArgs e) =>
        RetryRequested?.Invoke(this, EventArgs.Empty);
}
