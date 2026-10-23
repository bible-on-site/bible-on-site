namespace BibleOnSite.Controls;

/// <summary>
/// The reader's ⋮ options dropdown shared by the perek and parasha readers:
/// שניים מקרא, תיקון קוראים and הסתר שם השם toggles. Tapping an item raises
/// its event and closes the panel; tapping the dimmed page around it just
/// dismisses it.
/// </summary>
public partial class ReaderMenuPanel : Grid
{
    /// <summary>שניים מקרא row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? ShnayimMikraToggled;

    /// <summary>תיקון קוראים row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? TikkunKorimToggled;

    /// <summary>הסתר שם השם row tapped — the page flips the view-model flag.</summary>
    public event EventHandler? DivineNameMaskingToggled;

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
