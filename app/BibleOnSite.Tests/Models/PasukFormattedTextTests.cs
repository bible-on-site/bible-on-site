using BibleOnSite.Models;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Models;

public class PasukFormattedTextTests
{
    private static string Flatten(FormattedString formatted) =>
        string.Concat(formatted.Spans.Select(s => s.Text));

    public class Pasuk_FormattedText
    {
        [Fact]
        public void returns_empty_string_when_segments_is_empty()
        {
            var pasuk = new Pasuk { PasukNum = 1, Text = "", Segments = [] };

            Flatten(pasuk.FormattedText).Should().BeEmpty();
        }

        [Fact]
        public void joins_simple_ktiv_segments_with_spaces_between()
        {
            var pasuk = new Pasuk
            {
                PasukNum = 1,
                Text = "",
                Segments =
                [
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "בְּרֵאשִׁית" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "בָּרָא" }
                ]
            };

            Flatten(pasuk.FormattedText).Should().Be("בְּרֵאשִׁית בָּרָא");
        }

        [Fact]
        public void renders_qri_same_as_ktiv_as_plain_text_when_paired_offset_is_null()
        {
            var pasuk = new Pasuk
            {
                PasukNum = 1,
                Text = "",
                Segments =
                [
                    new PasukSegment
                    {
                        Type = SegmentType.Qri,
                        Value = "בְּרֵאשִׁית",
                        PairedOffset = null
                    }
                ]
            };

            Flatten(pasuk.FormattedText).Should().Be("בְּרֵאשִׁית");
        }

        [Fact]
        public void renders_qri_different_from_ktiv_with_kri_label_and_styling()
        {
            var pasuk = new Pasuk
            {
                PasukNum = 1,
                Text = "",
                Segments =
                [
                    new PasukSegment
                    {
                        Type = SegmentType.Qri,
                        Value = "הוּא",
                        PairedOffset = 1
                    }
                ]
            };

            var formatted = pasuk.FormattedText;
            Flatten(formatted).Should().Be("(קְרִי: הוּא)");

            var spans = formatted.Spans.ToList();
            spans.Should().HaveCount(3);
            spans[0].Text.Should().Be("(קְרִי: ");
            spans[0].TextColor.ToArgbHex().Should().Be("#637598");
            spans[1].Text.Should().Be("הוּא");
            spans[1].TextColor.ToArgbHex().Should().Be("#637598");
        }

        [Fact]
        public void inserts_ptuha_marker_with_expected_text_and_color()
        {
            var pasuk = new Pasuk
            {
                PasukNum = 1,
                Text = "",
                Segments =
                [
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                    new PasukSegment { Type = SegmentType.Ptuha, Value = "" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "ב" }
                ]
            };

            var formatted = pasuk.FormattedText;
            Flatten(formatted).Should().Contain(" {פ} ");
            var parshaSpan = formatted.Spans.First(s => s.Text == " {פ} ");
            parshaSpan.TextColor.ToArgbHex().Should().Be("#9A92D1");
        }

        [Fact]
        public void inserts_stuma_marker_with_expected_text_and_color()
        {
            var pasuk = new Pasuk
            {
                PasukNum = 1,
                Text = "",
                Segments =
                [
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "א" },
                    new PasukSegment { Type = SegmentType.Stuma, Value = "" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "ב" }
                ]
            };

            var formatted = pasuk.FormattedText;
            Flatten(formatted).Should().Contain(" {ס} ");
            var parshaSpan = formatted.Spans.First(s => s.Text == " {ס} ");
            parshaSpan.TextColor.ToArgbHex().Should().Be("#9A92D1");
        }

        [Fact]
        public void omits_space_after_segment_that_ends_with_maqaf()
        {
            var pasuk = new Pasuk
            {
                PasukNum = 1,
                Text = "",
                Segments =
                [
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "כָּל־" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "הָאָרֶץ" }
                ]
            };

            Flatten(pasuk.FormattedText).Should().Be("כָּל־הָאָרֶץ");
        }

        [Fact]
        public void skips_empty_ktiv_segments_without_adding_extra_spaces()
        {
            var pasuk = new Pasuk
            {
                PasukNum = 1,
                Text = "",
                Segments =
                [
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "" },
                    new PasukSegment { Type = SegmentType.Ktiv, Value = "ב" }
                ]
            };

            Flatten(pasuk.FormattedText).Should().Be("ב");
        }
    }

    public class PasukSegment_IsQriDifferentThanKtiv
    {
        [Fact]
        public void is_true_when_type_is_qri_and_paired_offset_has_value()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Qri,
                Value = "הוּא",
                PairedOffset = 1
            };

            segment.IsQriDifferentThanKtiv.Should().BeTrue();
        }

        [Fact]
        public void is_false_when_type_is_qri_and_paired_offset_is_null()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Qri,
                Value = "בְּרֵאשִׁית",
                PairedOffset = null
            };

            segment.IsQriDifferentThanKtiv.Should().BeFalse();
        }

        [Fact]
        public void is_false_when_type_is_ktiv_even_if_paired_offset_has_value()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Ktiv,
                Value = "היא",
                PairedOffset = 1
            };

            segment.IsQriDifferentThanKtiv.Should().BeFalse();
        }

        [Fact]
        public void is_false_for_ptuha_even_if_paired_offset_has_value()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Ptuha,
                PairedOffset = 1
            };

            segment.IsQriDifferentThanKtiv.Should().BeFalse();
        }
    }

    public class PasukSegment_IsKtivDifferentThanQri
    {
        [Fact]
        public void is_true_when_type_is_ktiv_and_paired_offset_is_non_zero()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Ktiv,
                Value = "היא",
                PairedOffset = 1
            };

            segment.IsKtivDifferentThanQri.Should().BeTrue();
        }

        [Fact]
        public void is_false_when_type_is_ktiv_and_paired_offset_is_zero()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Ktiv,
                Value = "היא",
                PairedOffset = 0
            };

            segment.IsKtivDifferentThanQri.Should().BeFalse();
        }

        [Fact]
        public void is_false_when_type_is_ktiv_and_paired_offset_is_null()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Ktiv,
                Value = "בראשית",
                PairedOffset = null
            };

            segment.IsKtivDifferentThanQri.Should().BeFalse();
        }

        [Fact]
        public void is_false_when_type_is_qri_even_if_paired_offset_has_value()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Qri,
                Value = "הוּא",
                PairedOffset = 1
            };

            segment.IsKtivDifferentThanQri.Should().BeFalse();
        }
    }

    public class PasukSegment_EndsWithMaqaf
    {
        [Fact]
        public void is_true_when_value_ends_with_maqaf()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Qri,
                Value = "כָּל־"
            };

            segment.EndsWithMaqaf.Should().BeTrue();
        }

        [Fact]
        public void is_false_when_value_does_not_end_with_maqaf()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Qri,
                Value = "בְּרֵאשִׁית"
            };

            segment.EndsWithMaqaf.Should().BeFalse();
        }

        [Fact]
        public void is_false_when_value_is_empty()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Ptuha,
                Value = ""
            };

            segment.EndsWithMaqaf.Should().BeFalse();
        }

        [Fact]
        public void is_false_when_maqaf_is_not_at_the_end()
        {
            var segment = new PasukSegment
            {
                Type = SegmentType.Qri,
                Value = "כָּל־הָאָרֶץ"
            };

            segment.EndsWithMaqaf.Should().BeFalse();
        }
    }

    public class SegmentType_values
    {
        [Fact]
        public void ktiv_is_zero()
        {
            ((int)SegmentType.Ktiv).Should().Be(0);
        }

        [Fact]
        public void qri_is_one()
        {
            ((int)SegmentType.Qri).Should().Be(1);
        }

        [Fact]
        public void ptuha_is_two()
        {
            ((int)SegmentType.Ptuha).Should().Be(2);
        }

        [Fact]
        public void stuma_is_three()
        {
            ((int)SegmentType.Stuma).Should().Be(3);
        }
    }
}
