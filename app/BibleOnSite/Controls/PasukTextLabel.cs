using System.Runtime.CompilerServices;

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
    protected override void OnPropertyChanged([CallerMemberName] string? propertyName = null)
    {
        base.OnPropertyChanged(propertyName);
        if (propertyName == nameof(FontSize) && FormattedText is not null)
        {
            OnPropertyChanged(nameof(FormattedText));
        }
    }
}
