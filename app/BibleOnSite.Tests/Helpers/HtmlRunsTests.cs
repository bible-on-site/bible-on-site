using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Unit tests for <see cref="HtmlRuns"/> — the managed HTML to styled-run
/// converter that replaced WebKit's NSHTMLReader import on Apple platforms.
/// </summary>
public class HtmlRunsTests
{
    public class EmptyInput
    {
        [Fact]
        public void returns_empty_when_html_is_null()
        {
            HtmlRuns.FromHtml(null).Should().BeEmpty();
        }

        [Fact]
        public void returns_empty_when_html_is_empty()
        {
            HtmlRuns.FromHtml(string.Empty).Should().BeEmpty();
        }

        [Fact]
        public void returns_empty_when_html_is_whitespace_only()
        {
            HtmlRuns.FromHtml("   \t\r\n").Should().BeEmpty();
        }

        [Fact]
        public void returns_empty_when_html_has_no_text()
        {
            HtmlRuns.FromHtml("<i data-commentator=\"x\"></i><script>var x=1;</script>").Should().BeEmpty();
        }
    }

    public class PlainText
    {
        [Fact]
        public void returns_single_run_for_plain_text()
        {
            var runs = HtmlRuns.FromHtml("שלום עולם");
            runs.Should().ContainSingle();
            runs[0].Text.Should().Be("שלום עולם");
            runs[0].Bold.Should().BeFalse();
        }

        [Fact]
        public void decodes_entities()
        {
            var runs = HtmlRuns.FromHtml("א &lt; ב &gt; ג &amp; ד");
            runs.Should().ContainSingle();
            runs[0].Text.Should().Be("א < ב > ג & ד");
        }

        [Fact]
        public void collapses_whitespace_runs()
        {
            var runs = HtmlRuns.FromHtml("א   \n\t  ב");
            runs.Should().ContainSingle();
            runs[0].Text.Should().Be("א ב");
        }

        [Fact]
        public void keeps_separator_space_across_tag_boundary()
        {
            var runs = HtmlRuns.FromHtml("<b>ראשונה </b>שנייה");
            string.Concat(runs.Select(r => r.Text)).Should().Be("ראשונה שנייה");
        }

        [Fact]
        public void strips_script_and_style_contents()
        {
            var runs = HtmlRuns.FromHtml("א<script>alert(1)</script><style>.x{}</style>ב");
            string.Concat(runs.Select(r => r.Text)).Should().Be("אב");
        }
    }

    public class InlineFormatting
    {
        [Fact]
        public void marks_bold_and_italic_runs()
        {
            var runs = HtmlRuns.FromHtml("א<b>ב</b>ג<i>ד</i>");
            runs.Should().HaveCount(4);
            runs[0].Text.Should().Be("א");
            runs[0].Bold.Should().BeFalse();
            runs[1].Text.Should().Be("ב");
            runs[1].Bold.Should().BeTrue();
            runs[1].Italic.Should().BeFalse();
            runs[2].Text.Should().Be("ג");
            runs[2].Bold.Should().BeFalse();
            runs[3].Text.Should().Be("ד");
            runs[3].Italic.Should().BeTrue();
        }

        [Fact]
        public void italic_content_gets_italic_run()
        {
            var runs = HtmlRuns.FromHtml("א<i>ד</i>");
            runs.Should().HaveCount(2);
            runs[1].Text.Should().Be("ד");
            runs[1].Italic.Should().BeTrue();
        }

        [Fact]
        public void nests_formatting_inside_bold()
        {
            var runs = HtmlRuns.FromHtml("<b>א<i>ב</i></b>");
            runs.Should().HaveCount(2);
            runs[0].Text.Should().Be("א");
            runs[0].Bold.Should().BeTrue();
            runs[0].Italic.Should().BeFalse();
            runs[1].Text.Should().Be("ב");
            runs[1].Bold.Should().BeTrue();
            runs[1].Italic.Should().BeTrue();
        }

        [Fact]
        public void sup_and_sub_shift_baseline_and_shrink()
        {
            var runs = HtmlRuns.FromHtml("א<sup>2</sup> ב<sub>n</sub>");
            runs.Should().HaveCount(4);
            runs[1].Text.Should().Be("2");
            runs[1].BaselineShift.Should().Be(1);
            runs[1].FontScale.Should().BeLessThan(1.0);
            runs[2].Text.Should().Be(" ב");
            runs[3].Text.Should().Be("n");
            runs[3].BaselineShift.Should().Be(-1);
        }

        [Fact]
        public void sub_run_comes_through_with_negative_shift()
        {
            var runs = HtmlRuns.FromHtml("x<sub>n</sub>");
            runs.Should().HaveCount(2);
            runs[1].Text.Should().Be("n");
            runs[1].BaselineShift.Should().Be(-1);
        }

        [Fact]
        public void underline_and_strikethrough_map_to_run_flags()
        {
            var runs = HtmlRuns.FromHtml("<u>א</u><s>ב</s>");
            runs[0].Underline.Should().BeTrue();
            runs[1].Strikethrough.Should().BeTrue();
        }
    }

    public class Blocks
    {
        [Fact]
        public void br_insert_line_break()
        {
            var runs = HtmlRuns.FromHtml("א<br>ב");
            string.Concat(runs.Select(r => r.Text)).Should().Be("א\nב");
        }

        [Fact]
        public void block_elements_separate_lines()
        {
            var runs = HtmlRuns.FromHtml("<p>א</p><p>ב</p>");
            string.Concat(runs.Select(r => r.Text)).Should().Be("א\nב");
        }

        [Fact]
        public void consecutive_block_tags_collapse_to_single_break()
        {
            var runs = HtmlRuns.FromHtml("<div><div>א</div><div><p></p>ב</div></div>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Be("א\nב");
        }

        [Fact]
        public void heading_marks_bold_and_heading_level()
        {
            var runs = HtmlRuns.FromHtml("<h2>כותרת</h2>גוף");
            runs[0].Text.Should().Be("כותרת");
            runs[0].Bold.Should().BeTrue();
            runs[0].HeadingLevel.Should().Be(2);
            var body = runs.First(r => r.Text.Contains("גוף"));
            body.HeadingLevel.Should().Be(0);
        }

        [Fact]
        public void unordered_list_items_get_bullets()
        {
            var runs = HtmlRuns.FromHtml("<ul><li>א</li><li>ב</li></ul>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("• א");
            text.Should().Contain("• ב");
        }

        [Fact]
        public void ordered_list_items_get_numbers()
        {
            var runs = HtmlRuns.FromHtml("<ol><li>א</li><li>ב</li></ol>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("1. א");
            text.Should().Contain("2. ב");
        }

        [Fact]
        public void pre_preserves_whitespace()
        {
            var runs = HtmlRuns.FromHtml("<pre>א   ב\nג</pre>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("א   ב\nג");
        }
    }

    public class LinksAndMedia
    {
        [Fact]
        public void anchor_runs_carry_the_href()
        {
            var runs = HtmlRuns.FromHtml("<a href=\"https://example.com/x\">קישור</a>");
            runs.Should().ContainSingle();
            runs[0].Link.Should().Be("https://example.com/x");
            runs[0].Underline.Should().BeTrue();
        }

        [Fact]
        public void anchor_without_href_is_plain_text()
        {
            var runs = HtmlRuns.FromHtml("<a>טקסט</a>");
            runs[0].Link.Should().BeNull();
            runs[0].Underline.Should().BeFalse();
        }

        [Fact]
        public void img_renders_alt_text()
        {
            var runs = HtmlRuns.FromHtml("א<img src=\"x.png\" alt=\"תמונה\">ב");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("תמונה");
        }

        [Fact]
        public void img_without_alt_renders_nothing()
        {
            var runs = HtmlRuns.FromHtml("א<img src=\"x.png\">ב");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Be("אב");
        }
    }

    public class Robustness
    {
        [Fact]
        public void unknown_tags_pass_children_through()
        {
            var runs = HtmlRuns.FromHtml("א<skup>ב</skup><qb>ג</qb>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("א");
            text.Should().Contain("ב");
            text.Should().Contain("ג");
        }

        [Fact]
        public void unclosed_tags_still_render()
        {
            var runs = HtmlRuns.FromHtml("<b>א<i>ב");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("א");
            text.Should().Contain("ב");
        }

        [Fact]
        public void inline_style_declarations_apply()
        {
            var runs = HtmlRuns.FromHtml("<span style=\"font-weight:bold; font-style:italic\">א</span>");
            runs.Should().ContainSingle();
            runs[0].Bold.Should().BeTrue();
            runs[0].Italic.Should().BeTrue();
        }

        [Fact]
        public void full_document_markup_renders_body_text()
        {
            var runs = HtmlRuns.FromHtml("<!DOCTYPE html><html><head><title>skip</title></head><body>שלום</body></html>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("שלום");
            text.Should().NotContain("skip");
        }
    }

    public class RealisticPerushContent
    {
        [Fact]
        public void sefaria_style_note_renders_text_with_formatting()
        {
            const string html = "<b>בראשית</b> חכמינו אמרו שהבי\"ת נוסף כבי\"ת בָראשונָה" +
                "<i data-commentator=\"Mechokekei Yehudah\" data-order=\"1\"></i> " +
                "כי נמצא \"ראשונה יסעו\"<sup>2</sup>";
            var runs = HtmlRuns.FromHtml(html);
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().StartWith("בראשית");
            text.Should().Contain("ראשונה יסעו");
            runs.First().Bold.Should().BeTrue();
            runs.Should().Contain(r => r.BaselineShift == 1);
        }
    }
}
