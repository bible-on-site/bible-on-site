namespace BibleOnSite.Controls;

using BibleOnSite.Helpers;

/// <summary>
/// The reader's ⋮ options dropdown shared by the perek and parasha readers:
/// שניים מקרא, תיקון קוראים and הסתר שם השם toggles. Tapping an item raises
/// its event and closes the panel; tapping the dimmed page around it just
/// dismisses it. In articles mode (<see cref="IsArticlesMode"/>) only the
/// הסתר שם השם row is available — the scripture reading modes do not apply
/// to an article catalogue (#3401).
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderMenuPanel : Grid, IReaderMenuSurface
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

    public static readonly BindableProperty IsArticlesModeProperty =
        BindableProperty.Create(nameof(IsArticlesMode), typeof(bool), typeof(ReaderMenuPanel), false);

    /// <summary>
    /// Whether the active content is the articles view. The shared reader
    /// chrome drives this with its articles/text swap; the XAML rows bind
    /// their visibility to it so a hidden action leaves no layout space,
    /// hit target, focus stop or accessibility node (#3401).
    /// </summary>
    public bool IsArticlesMode
    {
        get => (bool)GetValue(IsArticlesModeProperty);
        set => SetValue(IsArticlesModeProperty, value);
    }

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

    // Internal so unit tests drive the same activation the XAML's
    // Activated="…" wiring raises (the TappableView.SendActivated contract).
    internal void OnShnayimMikraTapped(object? sender, TappedEventArgs e)
    {
        Close();
        // A stale callback must not flip a scripture mode while articles are
        // shown — the hidden row has no live hit target of its own (#3401).
        if (IsArticlesMode)
        {
            return;
        }

        ShnayimMikraToggled?.Invoke(this, EventArgs.Empty);
    }

    internal void OnTikkunKorimTapped(object? sender, TappedEventArgs e)
    {
        Close();
        if (IsArticlesMode)
        {
            return;
        }

        TikkunKorimToggled?.Invoke(this, EventArgs.Empty);
    }

    internal void OnDivineNameMaskingTapped(object? sender, TappedEventArgs e)
    {
        Close();
        DivineNameMaskingToggled?.Invoke(this, EventArgs.Empty);
    }
}
