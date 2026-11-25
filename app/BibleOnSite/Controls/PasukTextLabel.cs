using System.Runtime.CompilerServices;
using BibleOnSite.Helpers;

namespace BibleOnSite.Controls;

/// <summary>
/// Pasuk-text label for the pasukim list. On Android the FormattedText spannable
/// bakes every span at the label's font size at the moment it is applied, and a
/// later <see cref="Label.FontSize"/> change only updates the view's text size —
/// the already-baked spans keep the stale size. A recycled CollectionView cell can
/// convert its text before the FontSize binding lands, which is what left shrunken
/// verses after toggling שניים מקרא (#2070). Re-raising <see cref="Label.FormattedText"/>
/// whenever <see cref="Label.FontSize"/> changes forces a re-render at the resolved
/// size, so row text always matches the configured pasuk size.
/// </summary>
public class PasukTextLabel : Label
{
    /// <summary>
    /// The shared scripture-font contract (#2623/#3685): every pasuk label
    /// renders in Al Heperek — the perek, parasha and masora readers, the
    /// focused-pasuk overlay and שניים מקרא rows. Set as a local value so no
    /// implicit Label style can win; spans without their own FontFamily
    /// inherit it on every platform (qri/ktiv, reciting/selected words,
    /// {פ}/{ס} markers). The pasuk-number marker is the deliberate exception
    /// — reader chrome that pins the app's main face, set explicitly by
    /// <see cref="Converters.PasukMarkerTextConverter"/>.
    /// </summary>
    public PasukTextLabel()
    {
        FontFamily = ScriptureFonts.Family;
        // Shared scripture-direction contract (#2964): pasuk text is Hebrew
        // RTL, so the direction is pinned on the control itself instead of
        // relying on ancestor propagation or the device locale. iOS resolves
        // an NSParagraphStyle "natural" base writing direction from the
        // user's language preference — not the string's strong characters —
        // so on an English-locale device a justified pasuk's last/short
        // lines flush left unless the handlers can read a declared RTL here.
        FlowDirection = Microsoft.Maui.FlowDirection.RightToLeft;
    }

    /// <summary>
    /// Fully justify the pasuk text to both edges like the inline commentary
    /// below it (#2402). Platform handlers apply their native justification —
    /// JustificationMode on Android, paragraph-style alignment on iOS/Mac and
    /// TextAlignment.Justify on Windows — keeping the last/short line at its
    /// natural edge.
    /// </summary>
    public static readonly BindableProperty JustifyProperty = BindableProperty.Create(
        nameof(Justify), typeof(bool), typeof(PasukTextLabel), true);

    public bool Justify
    {
        get => (bool)GetValue(JustifyProperty);
        set => SetValue(JustifyProperty, value);
    }

    /// <summary>
    /// Opt-in native text selection, currently honored on Windows where it
    /// maps to TextBlock.IsTextSelectionEnabled (#2766). Deliberately NOT a
    /// default: the reader's pasuk cell carries a five-handler input chain
    /// (tap, double-tap, right-tap, pointer press/release, long-press) and a
    /// selectable TextBlock would compete for the same pointer stream. Only
    /// gesture-free surfaces — the focused-pasuk overlay — set this.
    /// </summary>
    public static readonly BindableProperty SelectableProperty = BindableProperty.Create(
        nameof(Selectable), typeof(bool), typeof(PasukTextLabel), false);

    public bool Selectable
    {
        get => (bool)GetValue(SelectableProperty);
        set => SetValue(SelectableProperty, value);
    }

    protected override void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        base.OnPropertyChanged(propertyName);
        if (propertyName == nameof(FontSize) && FormattedText is not null)
        {
            OnPropertyChanged(nameof(FormattedText));
        }
    }
}
