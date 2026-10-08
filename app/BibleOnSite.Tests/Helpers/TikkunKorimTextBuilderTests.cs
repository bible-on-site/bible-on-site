using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Helpers;

public class TikkunKorimTextBuilderTests
{
    private static string Flatten(FormattedString formatted) =>
        string.Concat(formatted.Spans.Select(s => s.Text));

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

    public class BuildFormattedText
    {
        private static List<Pasuk> TwoPesukim() =>
        [
            PasukOf(1, new PasukSegment { Type = SegmentType.Ktiv, Value = "בְּרֵאשִׁית" },
                         new PasukSegment { Type = SegmentType.Ktiv, Value = "בָּרָא" }),
            PasukOf(2, new PasukSegment { Type = SegmentType.Ktiv, Value = "וַיֹּאמֶר" })
        ];

        [Fact]
        public void flows_the_whole_perek_continuously_with_one_marker_per_pasuk()
        {
            var flat = Flatten(TikkunKorimTextBuilder.BuildFormattedText(TwoPesukim(), false, false));

            flat.Should().Be("א בְּרֵאשִׁית בָּרָא ב וַיֹּאמֶר ");
        }

        [Fact]
        public void hides_marks_for_the_entire_chapter_while_keeping_letters()
        {
            var flat = Flatten(TikkunKorimTextBuilder.BuildFormattedText(TwoPesukim(), false, true));

            flat.Should().Be("א בראשית ברא ב ויאמר ");
        }

        [Fact]
        public void restores_the_original_marked_text_exactly_after_toggling_back()
        {
            var pesukim = TwoPesukim();
            var withMarks = Flatten(TikkunKorimTextBuilder.BuildFormattedText(pesukim, false, false));
            _ = TikkunKorimTextBuilder.BuildFormattedText(pesukim, false, true);
            var shownAgain = Flatten(TikkunKorimTextBuilder.BuildFormattedText(pesukim, false, false));

            shownAgain.Should().Be(withMarks);
            pesukim.SelectMany(p => p.Segments).Select(s => s.Value)
                .Should().Equal("בְּרֵאשִׁית", "בָּרָא", "וַיֹּאמֶר");
        }

        [Fact]
        public void repeats_each_pasuk_once_when_shnayim_mikra_is_enabled()
        {
            var flat = Flatten(TikkunKorimTextBuilder.BuildFormattedText(TwoPesukim(), true, false));

            flat.Should().Be("א בְּרֵאשִׁית בָּרָא בְּרֵאשִׁית בָּרָא ב וַיֹּאמֶר וַיֹּאמֶר ");
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

            var flat = Flatten(TikkunKorimTextBuilder.BuildFormattedText(pesukim, false, true));

            flat.Should().Contain(" {פ} ");
            flat.Should().Contain("(קרי: הוא)");
        }

        [Fact]
        public void returns_empty_formatted_string_for_no_pesukim()
        {
            TikkunKorimTextBuilder.BuildFormattedText(null, false, false).Spans.Should().BeEmpty();
            TikkunKorimTextBuilder.BuildFormattedText([], true, true).Spans.Should().BeEmpty();
        }

        [Fact]
        public void copies_no_gesture_recognizers_so_taps_only_toggle_marks()
        {
            var formatted = TikkunKorimTextBuilder.BuildFormattedText(TwoPesukim(), false, false);

            formatted.Spans.Should().OnlyContain(s => s.GestureRecognizers.Count == 0);
        }
    }
}
