using BibleOnSite.Models;
using System.Text;

namespace BibleOnSite.Helpers;

/// <summary>
/// Pure transform from a Masoretic unit's canonical ranges to display rows —
/// the app-side port of the website's range resolution
/// (web/bible-on-site/src/lib/reading/ranges.ts). Ranges resolve against the
/// existing pesukim corpus; no scripture is copied or renumbered.
/// </summary>
public static class MasoraUnitText
{
    /// <summary>
    /// The pasuk-level slice of a range within one perek — the display and
    /// commentary granularity. Verse-addressed content attaches to whole
    /// pesukim, so a boundary pasuk belongs to every unit it touches; segment
    /// indexes keep the intra-pasuk text bounds for clipping. An EndPasuk of
    /// <see cref="int.MaxValue"/> means "through the end of the perek" and is
    /// clipped to the loaded pasuk count.
    /// </summary>
    public sealed class PerekSlice
    {
        public int PerekId { get; init; }
        /// <summary>1-based first pasuk of the slice inside the perek.</summary>
        public int StartPasuk { get; init; }
        /// <summary>1-based last pasuk of the slice inside the perek (int.MaxValue = perek end).</summary>
        public int EndPasuk { get; init; }
        /// <summary>First included segment in StartPasuk, when the range starts mid-pasuk.</summary>
        public int? StartSegmentIndex { get; init; }
        /// <summary>Last included segment in EndPasuk, when the range ends mid-pasuk.</summary>
        public int? EndSegmentIndex { get; init; }
    }

    /// <summary>
    /// Decomposes a range into ordered per-perek slices in canonical order.
    /// Interior perakim are sliced whole ([1 .. perek end]); segment bounds
    /// attach only to the range's own start/end coordinates. Shared by every
    /// division whose units carry the contract's inclusive range shape.
    /// </summary>
    public static List<PerekSlice> PerekSlicesForRange(IScriptureRange range)
    {
        var slices = new List<PerekSlice>();
        for (var perekId = range.StartPerekId; perekId <= range.EndPerekId; perekId++)
        {
            slices.Add(new PerekSlice
            {
                PerekId = perekId,
                StartPasuk = perekId == range.StartPerekId ? range.StartPasuk : 1,
                EndPasuk = perekId == range.EndPerekId ? range.EndPasuk : int.MaxValue,
                StartSegmentIndex = perekId == range.StartPerekId ? range.StartSegmentIndex : null,
                EndSegmentIndex = perekId == range.EndPerekId ? range.EndSegmentIndex : null,
            });
        }
        return slices;
    }

    /// <summary>
    /// Decomposes all of a unit's primary ranges into per-perek slices in
    /// declared range order (mirrors rangesPerekSlices).
    /// </summary>
    public static List<PerekSlice> PerekSlicesForUnit(MasoraUnit unit) =>
        unit.Ranges.SelectMany(PerekSlicesForRange).ToList();

    /// <summary>Distinct perek ids a unit's ranges overlap, in first-appearance order.</summary>
    public static List<int> PerekIdsForUnit(MasoraUnit unit)
    {
        var seen = new HashSet<int>();
        foreach (var slice in PerekSlicesForUnit(unit))
        {
            seen.Add(slice.PerekId);
        }
        return seen.ToList();
    }

    /// <summary>Whether a unit's primary ranges span more than one canonical perek.</summary>
    public static bool IsMultiPerek(MasoraUnit unit) => PerekIdsForUnit(unit).Count > 1;

    /// <summary>
    /// Clips a loaded pasuk to the unit's segment bounds, producing a new
    /// display pasuk whose <see cref="Pasuk.Segments"/> start/end at the
    /// recorded indexes. Whole-pasuk edges (null) keep the full segment list.
    /// </summary>
    public static Pasuk ClipPasuk(Pasuk source, int? startSegmentIndex, int? endSegmentIndex)
    {
        var start = startSegmentIndex ?? 0;
        var end = Math.Min(endSegmentIndex ?? int.MaxValue, source.Segments.Count - 1);
        var clipped = source.Segments.Skip(start).Take(end - start + 1).ToList();
        return new Pasuk
        {
            PasukNum = source.PasukNum,
            Text = BuildText(clipped),
            Segments = clipped
        };
    }

    /// <summary>
    /// Rebuilds a pasuk's plain text from its segments — the same join rules
    /// <see cref="Services.PerekDataService"/> applies when loading a perek:
    /// words separated by spaces (except after newlines/maqaf), ptuha/stuma
    /// markers become line breaks.
    /// </summary>
    public static string BuildText(IReadOnlyList<PasukSegment> segments)
    {
        var text = new StringBuilder();
        foreach (var segment in segments)
        {
            PerekDataServiceText.AppendSegmentText(text, segment.Type, segment.Value);
        }
        return text.ToString().TrimEnd();
    }

    /// <summary>
    /// Builds the display rows for a unit: pasukim clipped to slice bounds.
    /// The מסורה reader shows no conventional chapter apparatus — rows carry
    /// canonical perek/pasuk ids for joins only, never a perek label.
    /// </summary>
    /// <param name="unit">The Masoretic unit.</param>
    /// <param name="loadPasukim">Loads a perek's pesukim (with unclipped segments).</param>
    /// <param name="fontFactor">User font-scaling factor.</param>
    public static async Task<List<MasoraPasukRow>> BuildRowsAsync(
        MasoraUnit unit,
        Func<int, Task<List<Pasuk>>> loadPasukim,
        double fontFactor)
    {
        var slices = PerekSlicesForUnit(unit);
        var fontSize = PasukDisplayItems.PasukFontSizeBase * fontFactor;

        var rows = new List<MasoraPasukRow>();
        // Several slices can share one perek (multi-range units); load once.
        var pasukimCache = new Dictionary<int, List<Pasuk>>();
        foreach (var slice in slices)
        {
            if (!pasukimCache.TryGetValue(slice.PerekId, out var pasukim))
            {
                pasukim = await loadPasukim(slice.PerekId);
                pasukimCache[slice.PerekId] = pasukim;
            }
            var endPasuk = Math.Min(slice.EndPasuk, pasukim.Count);
            for (var pasukNum = slice.StartPasuk; pasukNum <= endPasuk; pasukNum++)
            {
                var pasuk = pasukim[pasukNum - 1];
                var startIndex = pasukNum == slice.StartPasuk ? slice.StartSegmentIndex : null;
                var endIndex = pasukNum == slice.EndPasuk ? slice.EndSegmentIndex : null;
                var clipped = startIndex == null && endIndex == null
                    ? pasuk
                    : ClipPasuk(pasuk, startIndex, endIndex);
                rows.Add(new MasoraPasukRow(clipped, slice.PerekId, fontSize));
            }
        }
        return rows;
    }
}

/// <summary>
/// Shared pasuk text-join rules extracted from
/// <see cref="Services.PerekDataService.LoadPasukimAsync"/> so clipped
/// pesukim rebuild identical plain text.
/// </summary>
public static class PerekDataServiceText
{
    /// <summary>Appends one segment's contribution to the pasuk plain text.</summary>
    public static void AppendSegmentText(StringBuilder text, SegmentType type, string? value)
    {
        switch (type)
        {
            case SegmentType.Ptuha:
            case SegmentType.Stuma:
                if (text.Length > 0 && text[^1] != '\n')
                {
                    text.Append('\n');
                }
                break;
            default:
                if (!string.IsNullOrEmpty(value))
                {
                    // Add space before word unless it's the first word,
                    // the previous char is a newline, or a maqaf (Hebrew hyphen).
                    if (text.Length > 0 && text[^1] != '\n' && text[^1] != '־')
                    {
                        text.Append(' ');
                    }
                    text.Append(value);
                }
                break;
        }
    }
}
