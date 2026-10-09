using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class TikkunFlowLayoutTests
{
    private const float BaseFontSize = 18f;
    private const float LineHeightFactor = 1.4f;
    private const float CharWidth = 10f;

    // Deterministic measure: every character is CharWidth wide at base size.
    // The stuma probe "אשר אשר אשר" (11 chars incl. spaces) therefore measures 110.
    private static float Measure(string text, float fontSize, bool isBold) =>
        text.Length * CharWidth * (fontSize / BaseFontSize) * (isBold ? 1.2f : 1f);

    private static List<TikkunWord> Words(params string[] texts) =>
        texts.Select(t => new TikkunWord(t, null, 1f, false)).ToList();

    private static List<TikkunFlowLayout.PlacedWord> LineWords(
        TikkunFlowLayout.Result result, int line) =>
        result.Words.Where(w => Math.Abs(w.Y - line * LineHeight) < 0.01f).ToList();

    private static float LineHeight => BaseFontSize * LineHeightFactor;

    private static float RightEdge(TikkunFlowLayout.PlacedWord w) => w.X + w.Width;

    // The stuma gap equals nine Hebrew letters in the active font — the probe
    // "אשר אשר אשר" measures 11 chars wide with this fake measure.
    private static float StumaGap => Measure(TikkunFlowLayout.StumaProbe, BaseFontSize, false);

    public class Wrapping
    {
        [Fact]
        public void packs_words_greedily_and_wraps_when_the_next_word_fits_no_more()
        {
            // spaceWidth = 1 char = 10; "cc" (20) won't fit after aaaa+bbbb (90).
            var result = TikkunFlowLayout.Layout(Words("aaaa", "bbbb", "cc", "dd"),
                Measure, BaseFontSize, maxWidth: 100, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Select(w => w.Text)
                .Should().Equal("aaaa", "bbbb");
            LineWords(result, 1).Select(w => w.Text).Should().Equal("cc", "dd");
            result.Height.Should().Be(2 * LineHeight);
        }

        [Fact]
        public void gives_an_overlong_word_its_own_line_without_dropping_it()
        {
            var result = TikkunFlowLayout.Layout(Words("aaaaaaaaaaaaaa", "bb"),
                Measure, BaseFontSize, maxWidth: 100, LineHeightFactor);

            result.Words.Should().HaveCount(2);
            result.Words[0].Text.Should().Be("aaaaaaaaaaaaaa");
        }

        [Fact]
        public void handles_an_empty_word_list()
        {
            var result = TikkunFlowLayout.Layout(Words(), Measure, BaseFontSize, 100, LineHeightFactor);

            result.Words.Should().BeEmpty();
            result.Height.Should().Be(0);
            result.LineCount.Should().Be(0);
        }
    }

    public class Justification
    {
        [Fact]
        public void fills_every_complete_line_to_the_full_width()
        {
            // Line0: aa+bbb+cc (90 used of 110) must stretch its gaps to span the
            // column; the paragraph-final line stays natural (see below).
            var result = TikkunFlowLayout.Layout(Words("aa", "bbb", "cc", "dd", "ee"),
                Measure, BaseFontSize, maxWidth: 110, LineHeightFactor);

            result.LineCount.Should().Be(2);
            var firstLine = LineWords(result, 0);
            firstLine.Min(w => w.X).Should().BeApproximately(0, 0.01f);
            firstLine.Max(RightEdge).Should().BeApproximately(110, 0.01f);
        }

        [Fact]
        public void leaves_the_paragraph_last_line_naturally_aligned()
        {
            // The flow's final line ends the section — it hugs the right edge
            // instead of stretching its gap across the column.
            var result = TikkunFlowLayout.Layout(Words("aa", "bb", "cc", "dd"),
                Measure, BaseFontSize, maxWidth: 60, LineHeightFactor);

            var lines = result.Words.GroupBy(w => w.Y).OrderBy(g => g.Key).ToList();
            lines.Should().HaveCount(2);
            var last = lines[1].OrderByDescending(w => w.X).ToList();
            RightEdge(last[0]).Should().BeApproximately(60, 0.01f);
            // Ragged left edge: the gap stays one space, not stretched to fill.
            // cc (20) at the right edge + one space (10) + dd (20) → dd starts at 10.
            last[1].X.Should().BeApproximately(60 - 20 - 10 - 20, 0.01f);
            last[1].X.Should().BeGreaterThan(0);
        }

        [Fact]
        public void right_aligns_a_single_word_line_since_it_cannot_stretch()
        {
            var result = TikkunFlowLayout.Layout(Words("aa"), Measure, BaseFontSize, 100, LineHeightFactor);

            result.Words.Should().ContainSingle();
            result.Words[0].X.Should().BeApproximately(100 - 2 * CharWidth, 0.01f);
        }
    }

    public class RtlOrder
    {
        [Fact]
        public void places_the_first_word_at_the_right_edge_and_flows_left()
        {
            var result = TikkunFlowLayout.Layout(Words("aa", "bb"), Measure,
                BaseFontSize, maxWidth: 100, LineHeightFactor);

            result.Words[0].X.Should().BeGreaterThan(result.Words[1].X);
            RightEdge(result.Words[0]).Should().BeApproximately(100, 0.01f);
        }
    }

    public class Ptuha
    {
        [Fact]
        public void ends_the_line_and_starts_the_next_section_at_the_right_edge()
        {
            var words = Words("aaa", "bbb", "ccc");
            words.Insert(2, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            var before = LineWords(result, 0);
            before.Select(w => w.Text).Should().Equal("aaa", "bbb");
            // Paragraph-final line: natural alignment — the remainder stays blank.
            before.Min(w => w.X).Should().BeGreaterThan(0);
            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            after[0].Text.Should().Be("ccc");
            RightEdge(after[0]).Should().BeApproximately(200, 0.01f);
        }

        [Fact]
        public void leaves_a_blank_line_when_the_section_ends_exactly_at_the_line_edge()
        {
            // "aaaaaaaaaa" fills the 100-wide line exactly; {פ} must then leave a
            // whole blank line before the next section.
            var words = Words("aaaaaaaaaa", "bb");
            words.Insert(1, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 100, LineHeightFactor);

            result.LineCount.Should().Be(3);
            LineWords(result, 1).Should().BeEmpty();
            var next = LineWords(result, 2);
            next.Should().ContainSingle();
            RightEdge(next[0]).Should().BeApproximately(100, 0.01f);
        }

        [Fact]
        public void emits_no_drawable_word_for_the_marker_itself()
        {
            var words = Words("aa", "bb");
            words.Insert(1, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize, 200, LineHeightFactor);

            result.Words.Should().OnlyContain(w => w.Text.Length > 0);
            result.Words.Select(w => w.Text).Should().NotContain("{פ}");
        }
    }

    public class Stuma
    {
        [Fact]
        public void leaves_a_nine_letter_gap_between_sections_on_the_same_line()
        {
            var words = Words("aa", "bb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            var line = LineWords(result, 0);
            line.Should().HaveCount(2);
            // "aa" sits at the right edge; the gap between its left edge and "bb"'s
            // right edge is exactly the nine-letter probe, not a stretched slot.
            var gap = line[0].X - RightEdge(line[1]);
            gap.Should().BeApproximately(StumaGap, 0.01f);
        }

        [Fact]
        public void the_gap_survives_full_justification_without_stretching()
        {
            // Line 0 (aa bb {ס} cc) fills 180 of 200 and wraps on "dd", so it is
            // a complete line and gets justified. The סתומה slot stays exactly
            // the nine-letter gap; the 20 leftover lands on the ordinary space.
            var words = Words("aa", "bb", "cc", "dd", "ee", "ff");
            words.Insert(2, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            var line = LineWords(result, 0).OrderByDescending(w => w.X).ToList();
            line.Select(w => w.Text).Should().Equal("aa", "bb", "cc");
            // Fully justified: both edges reach the column edges.
            RightEdge(line[0]).Should().BeApproximately(200, 0.01f);
            line[^1].X.Should().BeApproximately(0, 0.01f);
            // The ordinary space absorbed the stretch: 10 space + 20 leftover.
            (line[0].X - RightEdge(line[1])).Should().BeApproximately(30, 0.01f);
            // The slot around the marker keeps the measured nine-letter gap.
            var gapAroundStuma = line[1].X - RightEdge(line[2]);
            gapAroundStuma.Should().BeApproximately(StumaGap, 0.01f);
        }

        [Fact]
        public void indents_the_continuation_line_when_the_gap_fits_but_the_word_does_not()
        {
            // maxWidth 130: "aa" + gap(110) = 140 already overflows, so "bb" wraps
            // to a new line that starts indented by the gap (סתומה fallback).
            var words = Words("aa", "bb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 130, LineHeightFactor);

            result.LineCount.Should().Be(2);
            var before = LineWords(result, 0);
            before.Should().ContainSingle();
            // The ending line is a section boundary — natural, not stretched.
            before[0].X.Should().BeApproximately(130 - 20, 0.01f);
            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            // Indented continuation: the gap leads the line.
            RightEdge(after[0]).Should().BeApproximately(130 - StumaGap, 0.01f);
        }

        [Fact]
        public void indents_when_the_marker_arrives_exactly_at_a_line_boundary()
        {
            // "aaaaaaaaaa" ends exactly at the edge; {ס} then puts its gap at the
            // start of the next line and the continuation is indented.
            var words = Words("aaaaaaaaaa", "bb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 130, LineHeightFactor);

            result.LineCount.Should().Be(2);
            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            RightEdge(after[0]).Should().BeApproximately(130 - StumaGap, 0.01f);
        }

        [Fact]
        public void keeps_the_word_on_the_line_when_it_alone_is_too_wide_for_the_gap()
        {
            // Width 60 < gap 110: the indent shrinks so the word still fits.
            var words = Words("aa", "bbbbbb");
            words.Insert(1, TikkunWord.StumaGap);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 60, LineHeightFactor);

            var after = LineWords(result, 1);
            after.Should().ContainSingle();
            after[0].X.Should().BeGreaterThanOrEqualTo(0);
            RightEdge(after[0]).Should().BeApproximately(60, 0.01f);
        }
    }

    public class MixedSections
    {
        [Fact]
        public void section_tokens_survive_repeated_content_without_collapsing()
        {
            // שניים מקרא duplicates pasuk tokens — each copy keeps its own break.
            var words = Words("aa", "bb", "aa", "bb");
            words.Insert(2, TikkunWord.PtuhaBreak);

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            result.LineCount.Should().Be(2);
            LineWords(result, 0).Select(w => w.Text).Should().Equal("aa", "bb");
            LineWords(result, 1).Select(w => w.Text).Should().Equal("aa", "bb");
        }

        [Fact]
        public void a_marker_between_pasuk_boundaries_still_breaks_the_flow()
        {
            // Simulates "…pasuk words {פ} [next pasuk marker] pasuk words…".
            var words = new List<TikkunWord>
            {
                new("aa", null, 1f, false),
                new("bb", null, 1f, false),
                TikkunWord.PtuhaBreak,
                new("ג", null, 1f, true),   // next pasuk's number marker
                new("cc", null, 1f, false),
            };

            var result = TikkunFlowLayout.Layout(words, Measure, BaseFontSize,
                maxWidth: 200, LineHeightFactor);

            LineWords(result, 0).Select(w => w.Text).Should().Equal("aa", "bb");
            var next = LineWords(result, 1);
            next.Select(w => w.Text).Should().Equal("ג", "cc");
            RightEdge(next[0]).Should().BeApproximately(200, 0.01f);
        }
    }
}
