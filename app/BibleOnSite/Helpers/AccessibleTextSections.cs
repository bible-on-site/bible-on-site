using System.Globalization;

namespace BibleOnSite.Helpers;

/// <summary>Bound spoken text units without losing text or splitting a Unicode grapheme.</summary>
public static class AccessibleTextSections
{
    public static int MaximumLength => 1024;
    public readonly record struct Section(int Start, int Length);

    public static IReadOnlyList<Section> Split(string text) => Split(text, MaximumLength);

    /// <summary>
    /// The contiguous run of ordered sections within one viewport height of the
    /// visible slice. Far sections stay out of the accessibility tree so each
    /// XCTest snapshot stays small; the margin keeps the next section reachable
    /// for VoiceOver before scrolling moves the window.
    /// </summary>
    public static (int Start, int Count) NearViewport(
        IReadOnlyList<(double Top, double Bottom)> frames, double viewportTop, double viewportHeight)
    {
        if (double.IsNaN(viewportHeight) || viewportHeight <= 0) { return default; }
        var top = viewportTop - viewportHeight;
        var bottom = viewportTop + 2 * viewportHeight;
        var start = 0;
        while (start < frames.Count && frames[start].Bottom <= top) { ++start; }
        var end = start;
        while (end < frames.Count && frames[end].Top < bottom) { ++end; }
        return (start, end - start);
    }

    public static IReadOnlyList<Section> Split(string text, int maximumLength)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maximumLength);
        if (text.Length == 0) { return []; }
        var boundaries = StringInfo.ParseCombiningCharacters(text);
        var sections = new List<Section>();
        for (var start = 0; start < text.Length;)
        {
            var end = Math.Min(text.Length, start + maximumLength);
            if (end < text.Length)
            {
                var boundary = Array.BinarySearch(boundaries, end);
                if (boundary < 0) { boundary = ~boundary - 1; }
                end = boundaries[boundary];
                if (end == start)
                {
                    // A single grapheme may exceed the limit; keep it intact.
                    end = boundary + 1 < boundaries.Length ? boundaries[boundary + 1] : text.Length;
                }
                else
                {
                    var newline = text.LastIndexOf('\n', end - 1, end - start);
                    if (newline >= start) { end = newline + 1; }
                }
            }
            sections.Add(new Section(start, end - start));
            start = end;
        }
        return sections;
    }
}
