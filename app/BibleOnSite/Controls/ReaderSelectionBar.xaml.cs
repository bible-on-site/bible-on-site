namespace BibleOnSite.Controls;

/// <summary>
/// The reader's selection-mode action bar shared by the perek and parasha
/// readers: back, a selected-pasukim count badge, and recitation/share/copy
/// actions. The page decides when the bar shows and what each action does;
/// the control owns the row layout, the copied-glyph feedback flash, and the
/// recitation button's play/pause/headphones glyph states.
/// </summary>
#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class ReaderSelectionBar : Grid
#pragma warning restore S2333
{
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    /// <summary>Back (right-arrow) button tapped — the page clears selection.</summary>
    public event EventHandler? BackRequested;

    /// <summary>Recitation (play/pause/headphones) button tapped.</summary>
    public event EventHandler? RecitationRequested;

    /// <summary>Share button tapped.</summary>
    public event EventHandler? ShareRequested;

    /// <summary>Copy button tapped.</summary>
    public event EventHandler? CopyRequested;
#pragma warning restore S3264

    /// <summary>Recitation button state mirrored by the page each update.</summary>
    public enum RecitationVisual
    {
        /// <summary>Ready to start playback.</summary>
        Play,
        /// <summary>Bar-issued playback is in progress — tapping pauses.</summary>
        Pause,
        /// <summary>Playback exists but was not issued from the bar — tapping resumes.</summary>
        Resume,
    }

    public ReaderSelectionBar()
    {
        InitializeComponent();
    }

    /// <summary>Number shown inside the count badge.</summary>
    public void SetCount(int count) => CountLabel.Text = count.ToString();

    /// <summary>
    /// Ordinary-selection affordances: the count badge and the share/copy
    /// buttons (hidden while a pasuk is focused or a unit recitation plays).
    /// </summary>
    public void SetSelectionActionsVisible(bool visible)
    {
        CountBadge.IsVisible = visible;
        ShareButton.IsVisible = visible;
        CopyButton.IsVisible = visible;
    }

    /// <summary>Shows or hides the recitation button.</summary>
    public void SetRecitationVisible(bool visible) => RecitationButton.IsVisible = visible;

    /// <summary>
    /// Applies the recitation button's enabled/opacity/glyph/hint — the glyph
    /// must match what the button does (only bar-issued playback pauses).
    /// </summary>
    public void SetRecitationState(bool enabled, RecitationVisual visual, string hint)
    {
        RecitationButton.IsEnabled = enabled;
        RecitationButton.Opacity = enabled ? 1 : 0.4;
        RecitationButton.Text = visual switch
        {
            RecitationVisual.Pause => Fonts.FluentUI.pause_24_regular,
            RecitationVisual.Resume => Fonts.FluentUI.play_24_regular,
            _ => Fonts.FluentUI.headphones_24_regular
        };
        ToolTipProperties.SetText(RecitationButton, hint);
        SemanticProperties.SetDescription(RecitationButton, hint);
    }

    /// <summary>
    /// Inline copied feedback: the clipboard-checkmark glyph flashes for 1.5s
    /// then restores the copy glyph.
    /// </summary>
    public async Task FlashCopiedAsync()
    {
        CopyButton.Text = "\ue34c"; // clipboard_checkmark_24_regular
        await Task.Delay(1500);
        CopyButton.Text = "\uf32b"; // copy_20_regular — the glyph declared in XAML
    }

    private void OnBackClicked(object? sender, EventArgs e) =>
        BackRequested?.Invoke(this, EventArgs.Empty);

    private void OnRecitationClicked(object? sender, EventArgs e) =>
        RecitationRequested?.Invoke(this, EventArgs.Empty);

    private void OnShareClicked(object? sender, EventArgs e) =>
        ShareRequested?.Invoke(this, EventArgs.Empty);

    private void OnCopyClicked(object? sender, EventArgs e) =>
        CopyRequested?.Invoke(this, EventArgs.Empty);
}
