using System.Globalization;
using System.Runtime.CompilerServices;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Converters;

/// <summary>
/// MultiBinding converter producing the pasukim CollectionView items:
/// values[0] = pasukim list, values[1] = שניים מקרא enabled flag,
/// values[2] = font factor (kept as an input so changing the configured text
/// size rebuilds rows at the new size, and so recycled rows always rebind to
/// the configured size — #2070), values[3] = הסתר שם השם revision (a
/// change-only input: bumping it rebuilds the IList so every realized or
/// recycled row re-reads the freshly masked Pasuk.FormattedText).
/// </summary>
public class PasukDisplayItemsConverter : IMultiValueConverter
{
    private const int MaxCachedListsPerSource = 4;

    // Keyed on the pasukim list instance: Perek.Pasukim is swapped wholesale
    // (never mutated in place), so a repeat evaluation with unchanged inputs —
    // a carousel cell rebinding, a redundant property notification — reuses the
    // built rows instead of reallocating up to 2× pasukim items. The revision
    // sits inside the sub-key on purpose: bumping it still yields a fresh IList
    // so realized/recycled rows re-read Pasuk.FormattedText. Entries die with
    // their source list, keeping the table bounded across carousel swipes.
    private readonly ConditionalWeakTable<IReadOnlyList<Pasuk>, List<CachedItems>> _itemsCache = new();
    private readonly object _itemsCacheGate = new();

    public object Convert(object[] values, Type targetType, object parameter, CultureInfo culture)
    {
        var pesukim = values.Length > 0 ? values[0] as IReadOnlyList<Pasuk> : null;
        var repeat = values.Length > 1 && values[1] is bool flag && flag;
        var fontFactor = values.Length > 2 && values[2] is double factor ? factor : 1.0;
        // values[3] (masking revision) is not an input to item construction —
        // masking lives inside Pasuk.FormattedText. It joins the cache key so a
        // bump produces a new IList (full rows rebuild) rather than reusing the
        // previous instance.
        var revision = values.Length > 3 ? values[3] : null;
        if (pesukim is null || pesukim.Count == 0)
        {
            return PasukDisplayItems.Create(pesukim, repeat, fontFactor);
        }

        lock (_itemsCacheGate)
        {
            var cachedLists = _itemsCache.GetValue(pesukim, static _ => new List<CachedItems>(1));
            foreach (var cached in cachedLists)
            {
                if (cached.Repeat == repeat &&
                    cached.FontFactorBits == BitConverter.DoubleToInt64Bits(fontFactor) &&
                    Equals(cached.Revision, revision))
                {
                    return cached.Items;
                }
            }

            var items = PasukDisplayItems.Create(pesukim, repeat, fontFactor);
            if (cachedLists.Count == MaxCachedListsPerSource)
            {
                cachedLists.RemoveAt(0);
            }
            cachedLists.Add(new CachedItems(repeat, BitConverter.DoubleToInt64Bits(fontFactor), revision, items));
            return items;
        }
    }

    public object[] ConvertBack(object value, Type[] targetTypes, object parameter, CultureInfo culture)
        => throw new NotSupportedException();

    // The font factor rides the key as raw bits — exact cache-key equality
    // without tripping S1244's float == rule.
    private sealed record CachedItems(bool Repeat, long FontFactorBits, object? Revision, List<PasukDisplayItem> Items);
}
