using System.Globalization;
using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Word-weighted reading-position progress over persisted unit metrics
/// (issue #2607) — the app twin of the website's progress engine, at
/// display-item granularity (no per-line text boxes are measurable inside a
/// virtualized native list).
///
/// Units before the reading anchor contribute their stored words; the anchor
/// unit contributes a partial share (<c>insideUnitFraction</c>) of its own
/// words — call sites that know only the item index pass 0 (the anchor's words count
/// as they are scrolled past, not before). <c>contentEndVisible</c> means the
/// content tail sits inside the viewport → everything readable is already in
/// view — the web engine's non-scrollable/max-scroll case where the anchor
/// reaches the content bottom. Back-scrolling lowers the value: this is the
/// current reading position, never a completion record.
/// </summary>
public static class ReadingProgressEngine
{
    /// <summary>
    /// Fraction (0–1) of the counted words read at the anchor. Unknown totals
    /// (null/0) or empty units return 0 so the indicator hides rather than
    /// inventing percentages.
    /// </summary>
    /// <param name="insideUnitFraction">Share of the anchor unit's own words
    /// already passed — call sites that know only the item index pass 0 (the
    /// anchor's words count as they are scrolled past, not before).</param>
    /// <param name="contentEndVisible">The content tail sits inside the
    /// viewport → everything readable is already in view — the web engine's
    /// non-scrollable/max-scroll case where the anchor reaches the content
    /// bottom.</param>
    public static double Fraction(
        IReadOnlyList<ReadingProgressUnit> units,
        int? totalWords,
        int anchorUnitIndex,
        double insideUnitFraction,
        bool contentEndVisible)
    {
        if (units.Count == 0 || !totalWords.HasValue || totalWords.Value <= 0)
        {
            return 0;
        }
        if (contentEndVisible)
        {
            return 1;
        }
        var idx = Math.Clamp(anchorUnitIndex, 0, units.Count - 1);
        var unit = units[idx];
        var wordsBefore = unit.CumulativeWords - unit.WordCount;
        var passed = wordsBefore + Math.Clamp(insideUnitFraction, 0, 1) * unit.WordCount;
        return Math.Clamp(passed / (double)totalWords.Value, 0, 1);
    }

    /// <summary>
    /// ScrollView variant for counted-child readers (article bodies,
    /// Tanahpedia entries — issue #2607): the reading anchor sweeps the
    /// measured counted extent — first covered child's top to last covered
    /// child's bottom — as the scroll ratio moves 0→1, so chrome above and
    /// below the counted text never inflates or stalls the bar. A region
    /// straddling the anchor contributes the fraction of its words whose
    /// extent is passed; a gap between counted children (e.g. a media
    /// element) reports the regions already passed without advancing.
    /// <paramref name="childExtents"/> carries each counted child's (top,
    /// bottom) in scroll-content coordinates, in the same order the
    /// attribution received the children.
    /// </summary>
    public static double Fraction(
        IReadOnlyList<CountedProgressRegion> regions,
        int? totalWords,
        double scrollY,
        double viewportHeight,
        double scrollContentHeight,
        IReadOnlyList<(double Top, double Bottom)> childExtents)
    {
        var total = totalWords ??
            (regions.Count > 0 ? regions[^1].WordsBefore + regions[^1].Words : 0);
        if (regions.Count == 0 || childExtents.Count == 0 || total <= 0)
        {
            return 0;
        }
        var lastRegion = regions[^1];
        var lastChild = lastRegion.FirstChild + lastRegion.ChildCount - 1;
        if (lastChild >= childExtents.Count)
        {
            // Extents were measured before all counted children laid out —
            // report nothing rather than a fabricated position.
            return 0;
        }
        if (scrollContentHeight <= 0)
        {
            // The scroll content has not measured — regions exist but there
            // is no honest extent to read yet.
            return 0;
        }
        var scrollRange = scrollContentHeight - viewportHeight;
        if (scrollRange <= 0)
        {
            // Non-scrollable content — everything readable is already in the
            // viewport, matching the web engine's max-scroll case.
            return 1;
        }
        var firstTop = childExtents[regions[0].FirstChild].Top;
        var lastBottom = childExtents[lastChild].Bottom;
        if (lastBottom <= firstTop)
        {
            return 1;
        }
        var anchor = firstTop + Math.Clamp(scrollY / scrollRange, 0, 1) * (lastBottom - firstTop);
        var passed = 0.0;
        foreach (var region in regions)
        {
            var top = childExtents[region.FirstChild].Top;
            var bottom = childExtents[region.FirstChild + region.ChildCount - 1].Bottom;
            if (bottom <= anchor)
            {
                passed = region.WordsBefore + region.Words;
                continue;
            }
            if (top > anchor)
            {
                break;
            }
            var inside = bottom > top
                ? Math.Clamp((anchor - top) / (bottom - top), 0, 1)
                : 1;
            passed = region.WordsBefore + inside * region.Words;
            break;
        }
        return Math.Clamp(passed / total, 0, 1);
    }

    /// <summary>
    /// Index of the unit whose key is <paramref name="pasukNum"/>, or -1.
    /// Pasuk units key "N".
    /// </summary>
    public static int IndexOfPasuk(IReadOnlyList<ReadingProgressUnit> units, int pasukNum)
    {
        var key = pasukNum.ToString(CultureInfo.InvariantCulture);
        for (var i = 0; i < units.Count; i++)
        {
            if (units[i].Key == key)
            {
                return i;
            }
        }
        return -1;
    }
}
