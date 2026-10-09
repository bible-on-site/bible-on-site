using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;
using Microsoft.Maui.Graphics;

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
        public void strips_upper_lower_dots_and_qamats_qatan()
        {
            // U+05C4 upper dot, U+05C5 lower dot, U+05C7 qamats qatan.
            TikkunKorimTextBuilder.StripMarks("אׄבׅגׇ").Should().Be("אבג");
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
        public void turns_parsha_markers_into_layout_tokens_without_literal_text()
        {
            var pesukim = new List<Pasuk>
            {
                PasukOf(1,
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                    new PasukSegment { Type = SegmentType.Ptuha, Value = "" },
                    new PasukSegment { Type = SegmentType.Stuma, Value = "" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "ב" })
            };

            var words = TikkunKorimTextBuilder.BuildWords(pesukim, false, false);

            words.Select(w => w.Kind).Should().Equal(
                TikkunWordKind.Text, TikkunWordKind.Text,
                TikkunWordKind.Ptuha, TikkunWordKind.Stuma, TikkunWordKind.Text);
            Texts(words).Should().NotContain("{פ}").And.NotContain("{ס}");
            Texts(words).Should().Equal("א", "א", "", "", "ב");
        }

        [Fact]
        public void strips_qri_label_marks_and_keeps_the_note_paren_glue()
        {
            var pesukim = new List<Pasuk>
            {
                PasukOf(1,
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                    new PasukSegment { Type = SegmentType.Ptuha, Value = "" },
                    new PasukSegment { Type = SegmentType.Qri, Value = "הוּא", PairedOffset = 1 })
            };

            var words = TikkunKorimTextBuilder.BuildWords(pesukim, false, true);
            var texts = Texts(words);

            texts.Should().Contain("(קרי:");
            // The closing paren glues to the qri value like in the pasuk list.
            texts.Should().Contain("הוא)");
            // The פתוחה marker is a layout token, not literal text.
            words.Should().Contain(w => w.Kind == TikkunWordKind.Ptuha);
        }

        [Fact]
        public void glues_maqaf_joined_words_across_segment_boundaries()
        {
            var pesukim = new List<Pasuk>
            {
                PasukOf(1,
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "א־" },
                    new PasukSegment { Type = SegmentType.Qri, Value = "ב" })
            };

            var words = TikkunKorimTextBuilder.BuildWords(pesukim, false, false);

            Texts(words).Should().Equal("א", "א־ב");
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

        [Fact]
        public void skips_segments_that_have_no_drawable_text()
        {
            // An empty segment emits nothing; under hideMarks a marks-only
            // segment (a lone segol) also collapses to nothing.
            var pesukim = new List<Pasuk>
            {
                PasukOf(1,
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "\u05B6" })
            };

            var words = TikkunKorimTextBuilder.BuildWords(pesukim, false, true);

            Texts(words).Should().Equal("א", "א");
        }

        [Fact]
        public void throws_for_an_unknown_segment_type()
        {
            var pesukim = new List<Pasuk>
            {
                PasukOf(1, new PasukSegment { Type = (SegmentType)999, Value = "א" })
            };

            var act = () => TikkunKorimTextBuilder.BuildWords(pesukim, false, false);

            act.Should().Throw<ArgumentOutOfRangeException>();
        }

        [Fact]
        public void colors_the_reciting_ktiv_segment_with_the_recitation_color()
        {
            var pasuk = PasukOf(1,
                new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                new PasukSegment { Type = SegmentType.Ktiv, Value = "ב" });
            pasuk.RecitingSegment = 2; // 1-based segment index, like FormattedText

            var words = TikkunKorimTextBuilder.BuildWords([pasuk], false, false);

            words[1].TextColor.Should().BeNull();
            words[2].TextColor.Should().Be(Color.FromArgb("#1c427b"));
        }

        [Fact]
        public void colors_the_reciting_qri_value_with_the_recitation_color()
        {
            var pasuk = PasukOf(1,
                new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                new PasukSegment { Type = SegmentType.Qri, Value = "ב", PairedOffset = 1 });
            pasuk.RecitingSegment = 2;

            var words = TikkunKorimTextBuilder.BuildWords([pasuk], false, false);

            // The reciting qri value goes blue; ")" glued to it like the pasuk list.
            var valueWord = words.Should().ContainSingle(w => w.Text == "ב)").Which;
            valueWord.TextColor.Should().Be(Color.FromArgb("#1c427b"));
        }
    }
}
