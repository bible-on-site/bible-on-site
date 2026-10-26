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
    /// The shared scripture-font contract (#2623): every pasuk label renders in
    /// Taamey D — the perek, parasha and masora readers, the focused-pasuk
    /// overlay and שניים מקרא rows. Set as a local value so the implicit Label
    /// style's OpenSansRegular can never win; spans without their own
    /// FontFamily inherit it on every platform (qri/ktiv, reciting/selected
    /// words, pasuk-number and {פ}/{ס} markers).
    /// </summary>
    public PasukTextLabel()
    {
        FontFamily = ScriptureFonts.Family;
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

    protected override void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        base.OnPropertyChanged(propertyName);
        if (propertyName == nameof(FontSize) && FormattedText is not null)
        {
            OnPropertyChanged(nameof(FormattedText));
        }
    }
}
