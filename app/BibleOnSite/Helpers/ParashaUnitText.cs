using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Pure transform from a פרשה על הפרק unit's canonical ranges to display
/// rows — the parasha reader's counterpart of <see cref="MasoraUnitText"/>:
/// Torah range first, then each ordered Haftarah variant under its own
/// section header, preserving ordered multi-range readings and intentional
/// repeats. Ranges resolve against the existing pesukim corpus through the
/// shared <see cref="IScriptureRange"/> slice decomposition; no scripture
/// is copied or renumbered.
/// </summary>
public static class ParashaUnitText
{
    /// <summary>
    /// Decomposes every range the unit renders (Torah plus each Haftarah
    /// variant) into per-perek slices in display order — the perushim and
    /// articles scope of the unit. Repeated range overlaps keep distinct
    /// slices; callers dedupe by perek id where a set is needed.
    /// </summary>
    public static List<MasoraUnitText.PerekSlice> PerekSlicesForUnit(ParashaUnit unit) =>
        unit.AllRanges().SelectMany(MasoraUnitText.PerekSlicesForRange).ToList();

    /// <summary>Distinct perek ids the unit's readings overlap, in first-appearance order.</summary>
    public static List<int> PerekIdsForUnit(ParashaUnit unit)
    {
        var seen = new HashSet<int>();
        foreach (var slice in PerekSlicesForUnit(unit))
        {
            seen.Add(slice.PerekId);
        }
        return seen.ToList();
    }

    /// <summary>
    /// Builds the display rows for a unit: a "תורה" section header followed
    /// by the Torah range's pesukim, then one "הפטרה - …" section per
    /// ordered variant. Each perek touched by a range gets a subheader and
    /// its pesukim clipped to the canonical bounds (boundary pesukim keep
    /// whole-pasuk granularity; segment indexes, when the contract sets
    /// them, clip through <see cref="MasoraUnitText.ClipPasuk"/>).
    /// </summary>
    /// <param name="unit">The parasha unit.</param>
    /// <param name="loadPasukim">Loads a perek's pesukim (with unclipped segments).</param>
    /// <param name="perekSource">Canonical "sefer perek" label for a perek id.</param>
    /// <param name="fontFactor">User font-scaling factor.</param>
    /// <param name="repeatEachPasuk">שניים מקרא — emit each pasuk twice.</param>
    public static async Task<(List<ParashaDisplayItem> Rows, List<Pasuk> TikkunPasukim)> BuildRowsAsync(
        ParashaUnit unit,
        Func<int, Task<List<Pasuk>>> loadPasukim,
        Func<int, string?> perekSource,
        double fontFactor,
        bool repeatEachPasuk)
    {
        var fontSize = PasukDisplayItems.PasukFontSizeBase * fontFactor;
        var markerFontSize = PasukDisplayItems.PasukMarkerFontSizeBase * fontFactor;
        var rows = new List<ParashaDisplayItem>();
        var tikkunPasukim = new List<Pasuk>();
        var pasukimCache = new Dictionary<int, List<Pasuk>>();

        rows.Add(ParashaDisplayItem.SectionHeader("תורה"));
        await AppendReadingRowsAsync(unit.TorahRange);
        foreach (var haftara in unit.Haftarot)
        {
            rows.Add(ParashaDisplayItem.SectionHeader($"הפטרה - {haftara.Label}"));
            foreach (var range in haftara.Ranges)
            {
                await AppendReadingRowsAsync(range);
            }
        }

        return (rows, tikkunPasukim);

        async Task AppendReadingRowsAsync(ScriptureRange range)
        {
            foreach (var slice in MasoraUnitText.PerekSlicesForRange(range))
            {
                if (!pasukimCache.TryGetValue(slice.PerekId, out var pasukim))
                {
                    pasukim = await loadPasukim(slice.PerekId);
                    pasukimCache[slice.PerekId] = pasukim;
                }
                rows.Add(ParashaDisplayItem.PerekHeader(perekSource(slice.PerekId) ?? string.Empty));
                var endPasuk = Math.Min(slice.EndPasuk, pasukim.Count);
                for (var pasukNum = slice.StartPasuk; pasukNum <= endPasuk; pasukNum++)
                {
                    var pasuk = pasukim[pasukNum - 1];
                    var startIndex = pasukNum == slice.StartPasuk ? slice.StartSegmentIndex : null;
                    var endIndex = pasukNum == slice.EndPasuk ? slice.EndSegmentIndex : null;
                    var clipped = startIndex == null && endIndex == null
                        ? pasuk
                        : MasoraUnitText.ClipPasuk(pasuk, startIndex, endIndex);
                    tikkunPasukim.Add(clipped);
                    // Perushim ride the last copy so שניים מקרא reads
                    // מקרא, מקרא, פירוש — the shared PasukDisplayItem contract.
                    rows.Add(ParashaDisplayItem.PasukItem(new PasukDisplayItem(
                        clipped, isRepeatedCopy: false, isLastCopy: !repeatEachPasuk,
                        fontSize, markerFontSize), slice.PerekId));
                    if (repeatEachPasuk)
                    {
                        rows.Add(ParashaDisplayItem.PasukItem(new PasukDisplayItem(
                            clipped, isRepeatedCopy: true, isLastCopy: true,
                            fontSize, markerFontSize), slice.PerekId));
                    }
                }
            }
        }
    }

    /// <summary>
    /// Formats a range in original references: "בראשית א א" for a single
    /// pasuk, "בראשית א א-ח" inside one perek, "בראשית א א - ו ח" inside
    /// one sefer, and both full sources for a sefer jump
    /// ("ישעיהו מב ה - ירמיהו ב ג").
    /// </summary>
    public static string RangeLabel(
        ScriptureRange range,
        Func<int, string?> perekSource,
        Func<int, (string SeferName, int PerekNumber, int? Additional)?> perekInfo)
    {
        var startSource = perekSource(range.StartPerekId) ?? string.Empty;
        if (range.StartPerekId == range.EndPerekId)
        {
            return range.StartPasuk == range.EndPasuk
                ? $"{startSource} {range.StartPasuk.ToHebrewLetters()}"
                : $"{startSource} {range.StartPasuk.ToHebrewLetters()}-{range.EndPasuk.ToHebrewLetters()}";
        }

        var start = $"{startSource} {range.StartPasuk.ToHebrewLetters()}";
        var startPerek = perekInfo(range.StartPerekId);
        var endPerek = perekInfo(range.EndPerekId);
        var sameSefer = endPerek is not null
            && startPerek is not null
            && endPerek.Value.SeferName == startPerek.Value.SeferName
            && endPerek.Value.Additional == startPerek.Value.Additional;
        var endRef = sameSefer
            ? endPerek!.Value.PerekNumber.ToHebrewLetters()
            : perekSource(range.EndPerekId) ?? string.Empty;
        return $"{start} - {endRef} {range.EndPasuk.ToHebrewLetters()}";
    }
}
