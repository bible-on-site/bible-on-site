using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds the display item list rendered by the pasukim CollectionView.
/// Pure transform: the logical <see cref="Pasuk"/> list is never modified.
/// </summary>
public static class PasukDisplayItems
{
    /// <summary>
    /// Creates one display item per pasuk, or two when <paramref name="repeatEachPasuk"/>
    /// is set (שניים מקרא: pasuk 1, pasuk 1, pasuk 2, pasuk 2...).
    /// </summary>
    public static List<PasukDisplayItem> Create(IReadOnlyList<Pasuk>? pesukim, bool repeatEachPasuk)
    {
        if (pesukim is null || pesukim.Count == 0)
        {
            return [];
        }

        var items = new List<PasukDisplayItem>(pesukim.Count * (repeatEachPasuk ? 2 : 1));
        foreach (var pasuk in pesukim)
        {
            items.Add(new PasukDisplayItem(pasuk, isRepeatedCopy: false));
            if (repeatEachPasuk)
            {
                items.Add(new PasukDisplayItem(pasuk, isRepeatedCopy: true));
            }
        }
        return items;
    }
}
