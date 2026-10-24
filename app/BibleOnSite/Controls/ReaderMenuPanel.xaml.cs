namespace BibleOnSite.Controls;

/// <summary>
/// The reader's ⋮ options dropdown shared by the perek and parasha readers:
/// שניים מקרא, תיקון קוראים and הסתר שם השם toggles. Tapping an item raises
/// its event and closes the panel; tapping the dimmed page around it just
/// dismisses it.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderMenuPanel : Grid
#pragma warning restore S2333
{
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    /// <summary>שניים מקרא row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? ShnayimMikraToggled;

    /// <summary>תיקון קוראים row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? TikkunKorimToggled;

    /// <summary>הסתר שם השם row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? DivineNameMaskingToggled;
#pragma warning restore S3264

    public ReaderMenuPanel()
    {
        InitializeComponent();
    }

    /// <summary>Whether the dropdown is currently shown.</summary>
    public bool IsOpen => IsVisible;

    /// <summary>Toggles the dropdown's visibility.</summary>
    public void Toggle() => IsVisible = !IsVisible;

    /// <summary>Dismisses the dropdown.</summary>
    public void Close() => IsVisible = false;

    private void OnDismissed(object? sender, TappedEventArgs e) => Close();

    private void OnShnayimMikraTapped(object? sender, TappedEventArgs e)
    {
        Close();
        ShnayimMikraToggled?.Invoke(this, EventArgs.Empty);
    }

    private void OnTikkunKorimTapped(object? sender, TappedEventArgs e)
    {
        Close();
        TikkunKorimToggled?.Invoke(this, EventArgs.Empty);
    }

    private void OnDivineNameMaskingTapped(object? sender, TappedEventArgs e)
    {
        Close();
        DivineNameMaskingToggled?.Invoke(this, EventArgs.Empty);
    }
}
