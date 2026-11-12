using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Pure transform from a moed's DB sections and ordered inclusive ranges to
/// display rows — the מועדים counterpart of <see cref="ParashaUnitText"/>:
/// each section renders its label as a header (with its canonical
/// references), then every ordered range resolves into per-perek subheaders
/// and pasukim clipped to the canonical bounds. Ranges resolve against the
/// existing pesukim corpus through the shared <see cref="IScriptureRange"/>
/// slice decomposition; intentional repeats and cross-sefer ranges keep
/// their declared order, and no scripture is copied or renumbered.
/// </summary>
public static class MoedUnitText
{
    /// <summary>
    /// Decomposes one section's ordered ranges into per-perek slices in
    /// declared range order — the perushim, display and recitation scope of
    /// the section.
    /// </summary>
    public static List<MasoraUnitText.PerekSlice> PerekSlicesForSection(MoedSection section) =>
        section.Ranges.OrderBy(range => range.Position)
            .SelectMany(range => MasoraUnitText.PerekSlicesForRange(range, range.Id)).ToList();

    /// <summary>
    /// Decomposes every section's ranges into per-perek slices in display
    /// order — the perushim, articles and whole-moed recitation scope.
    /// Repeated range overlaps keep distinct slices; callers dedupe by perek
    /// id where a set is needed.
    /// </summary>
    public static List<MasoraUnitText.PerekSlice> PerekSlicesForUnit(MoedUnit moed) =>
        moed.Sections.OrderBy(section => section.Position)
            .SelectMany(PerekSlicesForSection).ToList();

    /// <summary>Distinct perek ids the moed's readings overlap, in first-appearance order.</summary>
    public static List<int> PerekIdsForUnit(MoedUnit moed)
    {
        var seen = new HashSet<int>();
        foreach (var slice in PerekSlicesForUnit(moed))
        {
            seen.Add(slice.PerekId);
        }
        return seen.ToList();
    }

    /// <summary>
    /// Formats a section's ordered ranges as canonical references joined for
    /// the header subtitle (e.g. "איכה א - איכה ה · ירמיהו ב ג-ו").
    /// </summary>
    public static string SectionRefsText(
        MoedSection section,
        Func<int, string?> perekSource,
        Func<int, (string SeferName, int PerekNumber, int? Additional)?> perekInfo) =>
        string.Join(" · ", section.Ranges.OrderBy(range => range.Position)
            .Select(range => ParashaUnitText.RangeLabel(range, perekSource, perekInfo)));

    /// <summary>
    /// Builds the display rows for a moed: one section header per section in
    /// position order — its DB label plus the canonical references of its
    /// ranges — then a perek subheader and the range-clipped pasukim for
    /// every perek each ordered range touches.
    /// </summary>
    /// <param name="moed">The moed unit.</param>
    /// <param name="loadPasukim">Loads a perek's pesukim (with unclipped segments).</param>
    /// <param name="perekSource">Canonical "sefer perek" label for a perek id.</param>
    /// <param name="perekInfo">Sefer identity for cross-perek ref formatting.</param>
    /// <param name="fontFactor">User font-scaling factor.</param>
    public static async Task<List<MoedDisplayRow>> BuildRowsAsync(
        MoedUnit moed,
        Func<int, Task<List<Pasuk>>> loadPasukim,
        Func<int, string?> perekSource,
        Func<int, (string SeferName, int PerekNumber, int? Additional)?> perekInfo,
        double fontFactor)
    {
        var fontSize = PasukDisplayItems.PasukFontSizeBase * fontFactor;
        var markerFontSize = PasukDisplayItems.PasukMarkerFontSizeBase * fontFactor;
        var rows = new List<MoedDisplayRow>();
        // Sections and ranges can share perakim — load each perek once.
        var pasukimCache = new Dictionary<int, List<Pasuk>>();

        foreach (var section in moed.Sections.OrderBy(section => section.Position))
        {
            rows.Add(MoedDisplayRow.SectionHeader(section.Id, section.Label,
                SectionRefsText(section, perekSource, perekInfo)));
            foreach (var range in section.Ranges.OrderBy(range => range.Position))
            {
                foreach (var slice in MasoraUnitText.PerekSlicesForRange(range, range.Id))
                {
                    if (!pasukimCache.TryGetValue(slice.PerekId, out var pasukim))
                    {
                        pasukim = await loadPasukim(slice.PerekId);
                        pasukimCache[slice.PerekId] = pasukim;
                    }
                    rows.Add(MoedDisplayRow.PerekHeader(section.Id,
                        perekSource(slice.PerekId) ?? string.Empty));
                    var endPasuk = Math.Min(slice.EndPasuk, pasukim.Count);
                    for (var pasukNum = slice.StartPasuk; pasukNum <= endPasuk; pasukNum++)
                    {
                        var pasuk = pasukim[pasukNum - 1];
                        var startIndex = pasukNum == slice.StartPasuk ? slice.StartSegmentIndex : null;
                        var endIndex = pasukNum == slice.EndPasuk ? slice.EndSegmentIndex : null;
                        var clipped = startIndex == null && endIndex == null
                            ? pasuk
                            : MasoraUnitText.ClipPasuk(pasuk, startIndex, endIndex);
                        rows.Add(MoedDisplayRow.PasukRow(section.Id, clipped, slice.PerekId,
                            fontSize, markerFontSize, startIndex ?? 0, endIndex ?? int.MaxValue,
                            slice.RangeId));
                    }
                }
            }
        }
        return rows;
    }
}
