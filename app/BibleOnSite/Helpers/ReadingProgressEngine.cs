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
/// unit contributes <paramref name="insideUnitFraction"/> of its own words —
/// call sites that know only the item index pass 0 (the anchor's words count
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
    public static double Fraction(
        IReadOnlyList<ReadingProgressUnit> units,
        int? totalWords,
        int anchorUnitIndex) =>
        Fraction(units, totalWords, anchorUnitIndex, 0, false);

    /// <inheritdoc cref="Fraction(IReadOnlyList{ReadingProgressUnit}, int?, int)"/>
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
    /// Index of the first unit whose key addresses <paramref name="pasukNum"/>,
    /// or -1. Pasuk units key "N"; note units key "N:idx" — the same lookup
    /// anchors a verse in either list.
    /// </summary>
    public static int IndexOfPasuk(IReadOnlyList<ReadingProgressUnit> units, int pasukNum)
    {
        var key = pasukNum.ToString(CultureInfo.InvariantCulture);
        var notePrefix = key + ":";
        for (var i = 0; i < units.Count; i++)
        {
            var unitKey = units[i].Key;
            if (unitKey == key || unitKey.StartsWith(notePrefix, StringComparison.Ordinal))
            {
                return i;
            }
        }
        return -1;
    }
}
