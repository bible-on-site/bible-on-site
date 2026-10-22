using System.Text;
using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Occurrence display helpers — merges the entry's source ranges per pasuk and
/// renders the verse with its cited segments bold, mirroring the website's
/// <c>EntryOccurrencesTable</c> (one row per pasuk, cited words in
/// <c>&lt;strong class="occurrence"&gt;</c>, parsha markers skipped).
/// </summary>
public static class TanahpediaOccurrences
{
    /// <summary>
    /// Merges occurrence rows that target the same pasuk into one display row
    /// carrying every range — the website renders one table row per pasuk too.
    /// </summary>
    public static List<(int PasukNumber, List<(int? Start, int? End)> Ranges)> GroupRanges(
        IEnumerable<TanahpediaEntryOccurrence> occurrences)
    {
        return occurrences
            .GroupBy(occurrence => occurrence.PasukNumber)
            .OrderBy(group => group.Key)
            .Select(group => (group.Key, Ranges: group
                .Select(occurrence => (occurrence.SegmentStart, occurrence.SegmentEnd))
                .ToList()))
            .ToList();
    }

    /// <summary>
    /// The verse as a formatted citation: every segment inside a cited range
    /// (or the whole pasuk when a range is unbounded) is bold — the website's
    /// strong-occurrence rendering. Parsha markers never render; a different
    /// qri shows parenthesized like the website's <c>DivineNameText</c>.
    /// </summary>
    public static FormattedString FormatVerse(
        Pasuk? pasuk,
        IReadOnlyList<(int? Start, int? End)> ranges,
        string fallbackText)
    {
        var formatted = new FormattedString();
        var segments = pasuk?.Segments;
        if (segments is not { Count: > 0 } || ranges.Count == 0)
        {
            formatted.Spans.Add(new Span { Text = fallbackText });
            return formatted;
        }

        var lastTextIndex = -1;
        for (var i = 0; i < segments.Count; i++)
        {
            if (segments[i].Type is SegmentType.Ktiv or SegmentType.Qri &&
                segments[i].Value.Length > 0)
            {
                lastTextIndex = i;
            }
        }

        var plain = new StringBuilder();
        void FlushPlain()
        {
            if (plain.Length == 0)
            {
                return;
            }
            formatted.Spans.Add(new Span { Text = plain.ToString() });
            plain.Clear();
        }

        for (var i = 0; i < segments.Count; i++)
        {
            var segment = segments[i];
            // Parsha markers never render in the citation (same as the site).
            if (segment.Type is SegmentType.Ptuha or SegmentType.Stuma)
            {
                continue;
            }

            var cited = ranges.Any(range =>
                range.Start is null || range.End is null ||
                (i >= range.Start && i <= range.End));
            var text = segment.IsQriDifferentThanKtiv
                ? $"({DivineNameMasking.MaskText(segment.Value)})"
                : DivineNameMasking.MaskText(segment.Value);
            if (i < lastTextIndex && !segment.EndsWithMaqaf)
            {
                text += " ";
            }

            if (cited)
            {
                FlushPlain();
                formatted.Spans.Add(new Span { Text = text, FontAttributes = FontAttributes.Bold });
            }
            else
            {
                plain.Append(text);
            }
        }

        FlushPlain();
        return formatted;
    }
}
