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
    private static float Measure(string text, float fontSize, bool isBold) =>
        text.Length * CharWidth * (fontSize / BaseFontSize) * (isBold ? 1.2f : 1f);

    private static List<TikkunWord> Words(params string[] texts) =>
        texts.Select(t => new TikkunWord(t, null, 1f, false)).ToList();

    private static List<TikkunFlowLayout.PlacedWord> LineWords(
        TikkunFlowLayout.Result result, int line) =>
        result.Words.Where(w => Math.Abs(w.Y - line * LineHeight) < 0.01f).ToList();

    private static float LineHeight => BaseFontSize * LineHeightFactor;

    private static float RightEdge(TikkunFlowLayout.PlacedWord w) =>
        w.X + w.Text.Length * CharWidth * (w.FontSize / BaseFontSize) * (w.IsBold ? 1.2f : 1f);

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
        public void fills_every_line_to_the_full_width_including_the_last()
        {
            // Line0: aa+bbb+cc (90 used of 110), Line1: dd+ee (50 used) —
            // both must stretch their gaps to span the full column.
            var result = TikkunFlowLayout.Layout(Words("aa", "bbb", "cc", "dd", "ee"),
                Measure, BaseFontSize, maxWidth: 110, LineHeightFactor);

            result.LineCount.Should().Be(2);
            foreach (var line in result.Words.GroupBy(w => w.Y))
            {
                line.Min(w => w.X).Should().BeApproximately(0, 0.01f);
                line.Max(RightEdge).Should().BeApproximately(110, 0.01f);
            }
        }

        [Fact]
        public void justifies_the_last_line_exactly_like_the_others()
        {
            // Both lines hold two words at 50/60 width — gap must stretch by 10.
            var result = TikkunFlowLayout.Layout(Words("aa", "bb", "cc", "dd"),
                Measure, BaseFontSize, maxWidth: 60, LineHeightFactor);

            var lines = result.Words.GroupBy(w => w.Y).OrderBy(g => g.Key).ToList();
            lines.Should().HaveCount(2);
            foreach (var line in lines)
            {
                line.Min(w => w.X).Should().BeApproximately(0, 0.01f);
                line.Max(RightEdge).Should().BeApproximately(60, 0.01f);
            }
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
}
