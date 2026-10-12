using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds the display item list rendered by the pasukim CollectionView.
/// Pure transform: the logical <see cref="Pasuk"/> list is never modified.
/// </summary>
public static class PasukDisplayItems
{
    /// <summary>Base pasuk text size (before the user's font factor).</summary>
    public static double PasukFontSizeBase { get; } = 18;

    /// <summary>Base pasuk-number marker size (before the user's font factor).</summary>
    public static double PasukMarkerFontSizeBase { get; } = 16;

    /// <summary>
    /// Creates one display item per pasuk, or two when <paramref name="repeatEachPasuk"/>
    /// is set (שניים מקרא: pasuk 1, pasuk 1, pasuk 2, pasuk 2...). Each item carries
    /// the resolved text sizes so every row — including recycled ones — renders at
    /// the configured size no matter how often the mode is toggled.
    /// </summary>
    /// <param name="pesukim">The logical pesukim of the perek.</param>
    /// <param name="repeatEachPasuk">שניים מקרא — emit each pasuk twice.</param>
    public static List<PasukDisplayItem> Create(IReadOnlyList<Pasuk>? pesukim, bool repeatEachPasuk) =>
        Create(pesukim, repeatEachPasuk, fontFactor: 1.0);

    /// <param name="pesukim">The logical pesukim of the perek.</param>
    /// <param name="repeatEachPasuk">שניים מקרא — emit each pasuk twice.</param>
    /// <param name="fontFactor">User font-scaling factor; sizes mirror the page's
    /// PasukFontSize/PasukNumFontSize resources (factor × 18 / factor × 16).</param>
    public static List<PasukDisplayItem> Create(IReadOnlyList<Pasuk>? pesukim, bool repeatEachPasuk,
        double fontFactor)
    {
        if (pesukim is null || pesukim.Count == 0)
        {
            return [];
        }

        var fontSize = PasukFontSizeBase * fontFactor;
        var markerFontSize = PasukMarkerFontSizeBase * fontFactor;
        var items = new List<PasukDisplayItem>(pesukim.Count * (repeatEachPasuk ? 2 : 1));
        foreach (var pasuk in pesukim)
        {
            items.Add(new PasukDisplayItem(pasuk, isRepeatedCopy: false, fontSize, markerFontSize));
            if (repeatEachPasuk)
            {
                items.Add(new PasukDisplayItem(pasuk, isRepeatedCopy: true, fontSize, markerFontSize));
            }
        }
        return items;
    }
}
