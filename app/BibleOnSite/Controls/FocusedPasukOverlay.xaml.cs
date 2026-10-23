using System.Collections;

namespace BibleOnSite.Controls;

/// <summary>
/// The reader's focused-pasuk overlay shared by the perek and parasha readers:
/// the pasuk source + text + recitation hint header and the pasuk's perushim
/// list with the IsContentReady flicker gate (#2451). The page owns the data —
/// it sets the pasuk text (including word-tap spans on <see cref="PasukText"/>)
/// and the perushim items, and answers <see cref="PlayRequested"/>.
/// </summary>
public partial class FocusedPasukOverlay : Grid
{
    /// <summary>קריינות play button tapped — the page starts pasuk playback.</summary>
    public event EventHandler? PlayRequested;

    /// <summary>
    /// The pasuk text label — the page sets FormattedText with per-word
    /// tap gestures when word-level recitation is available.
    /// </summary>
    public Label PasukText => PasukTextLabel;

    public FocusedPasukOverlay()
    {
        InitializeComponent();
    }

    /// <summary>Header text — the focused pasuk's full source (sefer/perek/pasuk).</summary>
    public string? SourceText
    {
        get => SourceLabel.Text;
        set => SourceLabel.Text = value;
    }

    /// <summary>Recitation hint under the pasuk text; empty hides it.</summary>
    public string HintText
    {
        get => RecitationHintLabel.Text ?? string.Empty;
        set
        {
            RecitationHintLabel.Text = value;
            RecitationHintLabel.IsVisible = !string.IsNullOrEmpty(value);
        }
    }

    /// <summary>The pasuk's perushim rows.</summary>
    public IEnumerable? PerushimSource
    {
        get => PerushimList.ItemsSource;
        set => PerushimList.ItemsSource = value;
    }

    /// <summary>Shows/hides the קריינות play button (hidden = no recording).</summary>
    public bool PlayButtonVisible
    {
        get => PlayButton.IsVisible;
        set => PlayButton.IsVisible = value;
    }

    /// <summary>Enables/dims the קריינות play button.</summary>
    public bool PlayButtonEnabled
    {
        get => PlayButton.IsEnabled;
        set
        {
            PlayButton.IsEnabled = value;
            PlayButton.Opacity = value ? 1 : 0.4;
        }
    }

    private void OnPlayClicked(object? sender, EventArgs e) =>
        PlayRequested?.Invoke(this, EventArgs.Empty);
}
