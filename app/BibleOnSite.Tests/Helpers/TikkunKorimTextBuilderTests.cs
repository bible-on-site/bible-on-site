using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class TikkunKorimTextBuilderTests
{
    private static Pasuk PasukOf(int num, params PasukSegment[] segments) => new()
    {
        PasukNum = num,
        Text = string.Empty,
        Segments = [.. segments]
    };

    public class StripMarks
    {
        [Fact]
        public void removes_niqqud_and_taamim_while_keeping_letters_and_spaces()
        {
            TikkunKorimTextBuilder.StripMarks("בְּרֵאשִׁ֖ית בָּרָ֣א")
                .Should().Be("בראשית ברא");
        }

        [Fact]
        public void preserves_maqaf_sof_pasuk_and_punctuation()
        {
            TikkunKorimTextBuilder.StripMarks("כָּל־הָאָרֶץ׃")
                .Should().Be("כל־הארץ׃");
        }

        [Fact]
        public void handles_null_and_empty_input()
        {
            TikkunKorimTextBuilder.StripMarks(null).Should().BeEmpty();
            TikkunKorimTextBuilder.StripMarks("").Should().BeEmpty();
        }

        [Fact]
        public void leaves_unmarked_text_unchanged()
        {
            TikkunKorimTextBuilder.StripMarks("בראשית ברא")
                .Should().Be("בראשית ברא");
        }
    }

    public class BuildWords
    {
        private static List<Pasuk> TwoPesukim() =>
        [
            PasukOf(1, new PasukSegment { Type = SegmentType.Ktiv, Value = "בְּרֵאשִׁית" },
                         new PasukSegment { Type = SegmentType.Ktiv, Value = "בָּרָא" }),
            PasukOf(2, new PasukSegment { Type = SegmentType.Ktiv, Value = "וַיֹּאמֶר" })
        ];

        private static List<string> Texts(IReadOnlyList<TikkunWord> words) =>
            words.Select(w => w.Text).ToList();

        [Fact]
        public void emits_a_marker_word_before_each_pasuk()
        {
            var words = TikkunKorimTextBuilder.BuildWords(TwoPesukim(), false, false);

            Texts(words).Should().Equal("א", "בְּרֵאשִׁית", "בָּרָא", "ב", "וַיֹּאמֶר");
        }

        [Fact]
        public void styles_the_marker_bold_and_smaller_than_the_base_text()
        {
            var words = TikkunKorimTextBuilder.BuildWords(TwoPesukim(), false, false);

            words[0].IsBold.Should().BeTrue();
            words[0].FontSizeScale.Should().BeLessThan(1f);
            words[0].TextColor.Should().NotBeNull();
            words[1].IsBold.Should().BeFalse();
            words[1].FontSizeScale.Should().Be(1f);
        }

        [Fact]
        public void hides_marks_for_the_entire_chapter_while_keeping_letters()
        {
            var words = TikkunKorimTextBuilder.BuildWords(TwoPesukim(), false, true);

            Texts(words).Should().Equal("א", "בראשית", "ברא", "ב", "ויאמר");
        }

        [Fact]
        public void restores_the_original_marked_text_exactly_after_toggling_back()
        {
            var pesukim = TwoPesukim();
            var withMarks = Texts(TikkunKorimTextBuilder.BuildWords(pesukim, false, false));
            _ = TikkunKorimTextBuilder.BuildWords(pesukim, false, true);
            var shownAgain = Texts(TikkunKorimTextBuilder.BuildWords(pesukim, false, false));

            shownAgain.Should().Equal(withMarks);
            pesukim.SelectMany(p => p.Segments).Select(s => s.Value)
                .Should().Equal("בְּרֵאשִׁית", "בָּרָא", "וַיֹּאמֶר");
        }

        [Fact]
        public void repeats_each_pasuk_once_when_shnayim_mikra_is_enabled()
        {
            var words = TikkunKorimTextBuilder.BuildWords(TwoPesukim(), true, false);

            Texts(words).Should().Equal(
                "א", "בְּרֵאשִׁית", "בָּרָא", "בְּרֵאשִׁית", "בָּרָא",
                "ב", "וַיֹּאמֶר", "וַיֹּאמֶר");
        }

        [Fact]
        public void keeps_parsha_markers_and_strips_qri_label_marks()
        {
            var pesukim = new List<Pasuk>
            {
                PasukOf(1,
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                    new PasukSegment { Type = SegmentType.Ptuha, Value = "" },
                    new PasukSegment { Type = SegmentType.Qri, Value = "הוּא", PairedOffset = 1 })
            };

            var texts = Texts(TikkunKorimTextBuilder.BuildWords(pesukim, false, true));

            texts.Should().Contain("{פ}");
            texts.Should().Contain("(קרי:");
            texts.Should().Contain("הוא");
        }

        [Fact]
        public void returns_no_words_for_missing_or_empty_pesukim()
        {
            TikkunKorimTextBuilder.BuildWords(null, false, false).Should().BeEmpty();
            TikkunKorimTextBuilder.BuildWords([], true, true).Should().BeEmpty();
        }

        [Fact]
        public void emits_no_words_containing_spaces()
        {
            var words = TikkunKorimTextBuilder.BuildWords(TwoPesukim(), true, false);

            words.Should().OnlyContain(w => !w.Text.Contains(' '));
        }
    }
}
