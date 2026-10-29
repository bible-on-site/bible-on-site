using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// Pure layout engine for the תיקון קוראים continuous flow. Greedily wraps the
/// word sequence into lines, then fully justifies every complete line by
/// distributing the leftover width into the ordinary inter-word gaps, so lines
/// fill the text column like a printed tikkun. Positions are computed
/// right-to-left: the first word of a line sits at the right edge.
///
/// A line holds at most <see cref="MaxLineLetters"/> Hebrew base letters (#2839):
/// a word that would push the rendered line over the budget wraps to the next
/// line even when room remains in the column, keeping the dense reading flow
/// legible. Only letters count — niqqud, taamim, maqaf, spaces, punctuation
/// and numerals add zero — and the budget spans every drawable word on the
/// line (pasuk markers, qri-note text and שניים מקרא copies alike). A single
/// unbreakable word longer than the budget is preserved intact rather than
/// split or dropped; no canonical word reaches that length, so the exception
/// is defensive only.
///
/// Section markers are first-class layout instructions, never drawn text:
/// <list type="bullet">
/// <item>{פ} (פתוחה) ends the current line — it stays naturally aligned (right
/// edge, ragged left) leaving the remainder blank, and the next section starts
/// on a new line. When the section already ended exactly at the line edge (the
/// marker arrives on an empty line), a whole blank line is left instead, per the
/// classic boundary form.</item>
/// <item>{ס} (סתומה) leaves a gap of nine Hebrew letters (measured as the width
/// of <see cref="StumaProbe"/> at the active font size) between the sections and
/// continues on the same line when the next word fits after the gap. When it
/// does not — including the case with room for the gap but not the word — the
/// responsive fallback keeps the break visible: the current line ends naturally
/// and the continuation starts on the next line indented by the same gap
/// (the indented-continuation form of סתומה).</item>
/// </list>
/// Intentional gaps are fixed slots and never absorb justification stretch, so
/// the blank spaces survive full justification. A paragraph's last line (before
/// {פ}, before a {ס} fallback, or at the end of the perek) is not stretched.
/// The only platform input is the measure delegate, keeping the whole algorithm
/// unit-testable.
/// </summary>
public static class TikkunFlowLayout
{
    /// <summary>
    /// סתומה gap yardstick — the width of nine Hebrew letters. Measured with the
    /// active font/size, so the gap scales with the reader's text size instead of
    /// copying the website's fixed pixel gap.
    /// </summary>
    public static string StumaProbe { get; } = "אשר אשר אשר";

    /// <summary>Maximum Hebrew base letters allowed on one rendered line.</summary>
    public static int MaxLineLetters { get; } = 34;

    private const float Epsilon = 0.01f;

    /// <summary>
    /// Counts the rendered Hebrew base letters in a word — U+05D0–U+05EA,
    /// including final forms (םןףץך). Niqqud, taamim, maqaf, spaces,
    /// punctuation and numerals do not count, so a pointed word counts the
    /// same as its unpointed equivalent.
    /// </summary>
    public static int CountHebrewLetters(string text) =>
        text.Count(c => c is >= 'א' and <= 'ת');

    /// <summary>A word with its drawing position, measured width and resolved style.</summary>
    public sealed record PlacedWord(string Text, float X, float Y, float Width, float FontSize,
        bool IsBold, Color? TextColor);

    /// <summary>The laid-out words plus the total flow height.</summary>
    public sealed record Result(IReadOnlyList<PlacedWord> Words, float Height, int LineCount);

    /// <summary>
    /// One item on the line being assembled: the word, its width, the fixed slot
    /// that precedes it (leading indent for the first word, then an inter-word
    /// space or a סתומה gap), and whether that slot may absorb justification
    /// stretch (only ordinary inter-word spaces stretch; gaps and indents are
    /// intentional blank space).
    /// </summary>
    private sealed record LineItem(TikkunWord Word, float Width, float Slot, bool Stretchable);

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
        var stumaGap = measureWidth(StumaProbe, baseFontSize, false);
        var placed = new List<PlacedWord>(words.Count);
        var line = new List<LineItem>();
        var lineWidth = 0f;
        var lineLetters = 0;
        var y = 0f;
        var lineCount = 0;
        var pendingStuma = false;

        void EmitBlankLine()
        {
            y += lineHeight;
            lineCount++;
        }

        void FlushLine(bool justify)
        {
            lineCount++;
            var stretchable = 0;
            for (var i = 1; i < line.Count; i++)
            {
                if (line[i].Stretchable)
                {
                    stretchable++;
                }
            }
            var extra = justify && stretchable > 0
                ? Math.Max(0, (maxWidth - lineWidth) / stretchable)
                : 0f;
            var x = maxWidth;
            foreach (var item in line)
            {
                x -= item.Slot + (item.Stretchable ? extra : 0f);
                x -= item.Width;
                placed.Add(new PlacedWord(item.Word.Text, x, y, item.Width,
                    item.Word.FontSizeScale * baseFontSize, item.Word.IsBold, item.Word.TextColor));
            }
            y += lineHeight;
            line.Clear();
            lineWidth = 0f;
            lineLetters = 0;
        }

        foreach (var word in words)
        {
            switch (word.Kind)
            {
                case TikkunWordKind.Ptuha:
                    if (line.Count > 0)
                    {
                        // Paragraph end: leave the rest of the line blank (natural,
                        // not justified). If the section already filled the line to
                        // the edge there is no visible remainder, so a full blank
                        // line is left — the classic boundary form of פתוחה.
                        var endedAtEdge = lineWidth >= maxWidth - Epsilon;
                        FlushLine(justify: false);
                        if (endedAtEdge)
                        {
                            EmitBlankLine();
                        }
                    }
                    else if (placed.Count > 0 || lineCount > 0)
                    {
                        // The marker arrived on an already-empty line (boundary
                        // or consecutive marker): the blank remainder is a whole line.
                        EmitBlankLine();
                    }
                    pendingStuma = false;
                    break;

                case TikkunWordKind.Stuma:
                    // Resolved when the next word is measured: inline gap when the
                    // word fits after it, otherwise an indented continuation.
                    pendingStuma = true;
                    break;

                default:
                    {
                        var width = measureWidth(word.Text,
                            word.FontSizeScale * baseFontSize, word.IsBold);
                        float slot;
                        bool stretchable;
                        if (line.Count == 0)
                        {
                            slot = pendingStuma ? stumaGap : 0f;
                            stretchable = false;
                            // A word wider than the column keeps at most the room
                            // that is left for it (overlong words are never dropped).
                            if (slot + width > maxWidth)
                            {
                                slot = Math.Max(0, maxWidth - width);
                            }
                        }
                        else
                        {
                            slot = pendingStuma ? stumaGap : spaceWidth;
                            stretchable = !pendingStuma;
                        }

                        var wordLetters = CountHebrewLetters(word.Text);
                        var needed = lineWidth + slot + width;
                        if (line.Count > 0 &&
                            (needed > maxWidth + Epsilon || lineLetters + wordLetters > MaxLineLetters))
                        {
                            // Wrap: an ordinary overflow justifies the completed
                            // line; a {ס} that has no room for gap + word ends it
                            // naturally and the continuation starts indented by
                            // the gap (indented-continuation form). The letter
                            // budget ends the line the same way — words never
                            // split — so a lone overlong word keeps its own line.
                            FlushLine(justify: !pendingStuma);
                            slot = pendingStuma ? stumaGap : 0f;
                            stretchable = false;
                            if (slot + width > maxWidth)
                            {
                                slot = Math.Max(0, maxWidth - width);
                            }
                            line.Add(new LineItem(word, width, slot, stretchable));
                            lineWidth = slot + width;
                            lineLetters = wordLetters;
                        }
                        else
                        {
                            line.Add(new LineItem(word, width, slot, stretchable));
                            lineWidth += slot + width;
                            lineLetters += wordLetters;
                        }
                        pendingStuma = false;
                        break;
                    }
            }
        }

        // The last line of the perek ends a paragraph — natural alignment.
        if (line.Count > 0)
        {
            FlushLine(justify: false);
        }

        return new Result(placed, y, lineCount);
    }
}
