using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Pure layout engine for the תיקון קוראים continuous flow. Greedily wraps the
/// word sequence into lines, then fully justifies every line — including the
/// last — by distributing the leftover width into the inter-word gaps, so every
/// line fills the text column like a printed tikkun. Positions are computed
/// right-to-left: the first word of a line sits at the right edge.
/// The only platform input is the measure delegate, keeping the whole algorithm
/// unit-testable.
/// </summary>
public static class TikkunFlowLayout
{
    /// <summary>A word with its drawing position and resolved style.</summary>
    public sealed record PlacedWord(string Text, float X, float Y, float FontSize,
        bool IsBold, Color? TextColor);

    /// <summary>The laid-out words plus the total flow height.</summary>
    public sealed record Result(IReadOnlyList<PlacedWord> Words, float Height, int LineCount);

    /// <param name="words">The word sequence from <see cref="TikkunKorimTextBuilder.BuildWords"/>.</param>
    /// <param name="measureWidth">Measures a word: (text, fontSize, isBold) → width in the same units as <paramref name="maxWidth"/>.</param>
    /// <param name="baseFontSize">Base pasuk font size; a word's effective size is its FontSizeScale × this.</param>
    /// <param name="maxWidth">Text column width.</param>
    /// <param name="lineHeightFactor">Line height multiplier (matches the pasuk list's 1.4).</param>
    public static Result Layout(
        IReadOnlyList<TikkunWord> words,
        Func<string, float, bool, float> measureWidth,
        float baseFontSize,
        float maxWidth,
        float lineHeightFactor)
    {
        var lineHeight = baseFontSize * lineHeightFactor;
        var spaceWidth = measureWidth(" ", baseFontSize, false);
        var placed = new List<PlacedWord>(words.Count);
        var line = new List<(TikkunWord Word, float Width)>();
        var lineWidth = 0f;
        var y = 0f;
        var lineCount = 0;

        void FlushLine()
        {
            lineCount++;
            // Full justification — every line fills the column, the last included.
            // A lone word cannot stretch, so it simply hugs the right edge.
            var extra = line.Count > 1
                ? Math.Max(0, (maxWidth - lineWidth) / (line.Count - 1))
                : 0f;
            var x = maxWidth;
            foreach (var (word, width) in line)
            {
                x -= width;
                placed.Add(new PlacedWord(word.Text, x, y,
                    word.FontSizeScale * baseFontSize, word.IsBold, word.TextColor));
                x -= spaceWidth + extra;
            }
            y += lineHeight;
            line.Clear();
            lineWidth = 0f;
        }

        foreach (var word in words)
        {
            var width = measureWidth(word.Text, word.FontSizeScale * baseFontSize, word.IsBold);
            var needed = line.Count == 0 ? width : lineWidth + spaceWidth + width;
            if (line.Count > 0 && needed > maxWidth + 0.01f)
            {
                FlushLine();
            }

            line.Add((word, width));
            lineWidth = line.Count == 1 ? width : lineWidth + spaceWidth + width;
        }

        if (line.Count > 0)
        {
            FlushLine();
        }

        return new Result(placed, y, lineCount);
    }
}
