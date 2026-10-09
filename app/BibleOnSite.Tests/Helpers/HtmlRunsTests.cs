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
        public void leading_whitespace_at_document_start_produces_no_space()
        {
            var runs = HtmlRuns.FromHtml("  שלום");
            runs.Should().ContainSingle();
            runs[0].Text.Should().Be("שלום");
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
        public void whitespace_text_node_between_blocks_is_dropped()
        {
            var runs = HtmlRuns.FromHtml("<div>א</div> <div>ב</div>");
            string.Concat(runs.Select(r => r.Text)).Should().Be("א\nב");
        }

        [Fact]
        public void text_after_a_block_break_gets_no_separator_space()
        {
            var runs = HtmlRuns.FromHtml("<div>א</div> ב");
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

    public class InlineCss
    {
        [Fact]
        public void text_decoration_underline_sets_underline()
        {
            var runs = HtmlRuns.FromHtml("<span style=\"text-decoration:underline\">א</span>");
            runs.Should().ContainSingle();
            runs[0].Underline.Should().BeTrue();
        }

        [Fact]
        public void text_decoration_line_through_sets_strikethrough()
        {
            var runs = HtmlRuns.FromHtml("<span style=\"text-decoration:line-through\">א</span>");
            runs.Should().ContainSingle();
            runs[0].Strikethrough.Should().BeTrue();
        }

        [Fact]
        public void font_style_oblique_marks_italic()
        {
            var runs = HtmlRuns.FromHtml("<span style=\"font-style: oblique\">א</span>");
            runs.Should().ContainSingle();
            runs[0].Italic.Should().BeTrue();
        }

        [Fact]
        public void vertical_align_super_and_sub_shift_baseline()
        {
            var runs = HtmlRuns.FromHtml("א<span style=\"vertical-align:super\">2</span>ב<span style=\"vertical-align:sub\">n</span>");
            runs.First(r => r.Text == "2").BaselineShift.Should().Be(1);
            runs.First(r => r.Text == "n").BaselineShift.Should().Be(-1);
        }

        [Theory]
        [InlineData("font-size:150%", 1.5)]
        [InlineData("font-size:0.5em", 0.5)]
        [InlineData("font-size:smaller", 0.83)]
        [InlineData("font-size:larger", 1.17)]
        [InlineData("font-size:x-large", 1.17)]
        public void font_size_declarations_scale_the_run(string style, double expected)
        {
            var runs = HtmlRuns.FromHtml($"<span style=\"{style}\">א</span>");
            runs.Should().ContainSingle();
            runs[0].FontScale.Should().BeApproximately(expected, 0.001);
        }

        [Fact]
        public void unsupported_and_malformed_declarations_are_ignored()
        {
            var runs = HtmlRuns.FromHtml("<span style=\"color:red; baddecl; font-family:serif\">א</span>");
            runs.Should().ContainSingle();
            runs[0].Text.Should().Be("א");
            runs[0].FontScale.Should().BeApproximately(1.0, 0.001);
        }
    }

    public class StructuralExtras
    {
        [Fact]
        public void hr_renders_a_separator_line()
        {
            var runs = HtmlRuns.FromHtml("<p>א</p><hr><p>ב</p>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Be("א\n―――\nב");
        }

        [Fact]
        public void table_cells_separate_with_spaces()
        {
            var runs = HtmlRuns.FromHtml("<table><tr><td>א</td><td>ב</td></tr></table>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("א  ב");
        }

        [Fact]
        public void table_separator_absorbs_leading_space_in_next_cell()
        {
            var runs = HtmlRuns.FromHtml("<table><tr><td>א</td><td> ב</td></tr></table>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("א  ב");
            text.Should().NotContain("א   ב");
        }

        [Fact]
        public void li_outside_a_list_still_gets_a_bullet()
        {
            var runs = HtmlRuns.FromHtml("<li>א</li>");
            var text = string.Concat(runs.Select(r => r.Text));
            text.Should().Contain("• א");
        }

        [Fact]
        public void small_shrinks_and_big_enlarges()
        {
            var runs = HtmlRuns.FromHtml("א<small>ק</small>ב<big>ג</big>");
            runs.First(r => r.Text.Contains('ק')).FontScale.Should().BeLessThan(1.0);
            runs.First(r => r.Text.Contains('ג')).FontScale.Should().BeGreaterThan(1.0);
        }

        [Fact]
        public void trailing_whitespace_inside_the_last_run_is_trimmed()
        {
            var runs = HtmlRuns.FromHtml("<b>א </b>");
            runs.Should().ContainSingle();
            runs[0].Text.Should().Be("א");
        }
    }
}

public class HtmlRunsStyleCoverageTests
{
    [Theory]
    [InlineData("bold")]
    [InlineData("bolder")]
    [InlineData("600")]
    [InlineData("700")]
    [InlineData("800")]
    [InlineData("900")]
    public void applies_inline_css_bold_weights(string weight)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"font-weight:{weight}\">ב</span>");
        runs.First(r => r.Text.Contains('ב')).Bold.Should().BeTrue();
    }

    [Theory]
    [InlineData("italic")]
    [InlineData("oblique")]
    public void applies_inline_css_italic_styles(string style)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"font-style:{style}\">ב</span>");
        runs.First(r => r.Text.Contains('ב')).Italic.Should().BeTrue();
    }

    [Theory]
    [InlineData("underline")]
    [InlineData("line-through")]
    public void applies_inline_css_text_decoration(string decoration)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"text-decoration:{decoration}\">ב</span>");
        var run = runs.First(r => r.Text.Contains('ב'));
        if (decoration == "underline")
            run.Underline.Should().BeTrue();
        else
            run.Strikethrough.Should().BeTrue();
    }

    [Theory]
    [InlineData("super", 1)]
    [InlineData("sub", -1)]
    public void applies_vertical_align_baseline(string align, int expected)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"vertical-align:{align}\">n</span>");
        runs.First(r => r.Text == "n").BaselineShift.Should().Be(expected);
    }

    [Theory]
    [InlineData("150%", 1.5)]
    [InlineData("0.5em", 0.5)]
    [InlineData("larger", 1.17)]
    [InlineData("x-large", 1.17)]
    [InlineData("xx-large", 1.17)]
    [InlineData("smaller", 0.83)]
    [InlineData("x-small", 0.83)]
    [InlineData("xx-small", 0.83)]
    public void scales_font_size_keywords_and_units(string size, double expected)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"font-size:{size}\">ב</span>");
        runs.First(r => r.Text.Contains('ב')).FontScale.Should().BeApproximately(expected, 0.001);
    }

    [Theory]
    [InlineData("color:red")]
    [InlineData("font-weight:normal")]
    [InlineData("text-decoration:none")]
    public void ignores_unhandled_css_declarations(string css)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"{css}\">ב</span>");
        var run = runs.First(r => r.Text.Contains('ב'));
        run.Bold.Should().BeFalse();
        run.Underline.Should().BeFalse();
        run.Strikethrough.Should().BeFalse();
    }

    [Fact]
    public void breaks_after_trailing_newline_run()
    {
        var runs = HtmlRuns.FromHtml("א<br><br>ב");
        runs.First(r => r.Text.Contains('ב')).Text.Should().NotStartWith(" ");
    }

    [Fact]
    public void drops_leading_whitespace_at_document_start()
    {
        var runs = HtmlRuns.FromHtml("   א");
        runs.Should().ContainSingle().Which.Text.Should().Be("א");
    }

    [Theory]
    [InlineData("bogus")]
    [InlineData("-20%")]
    [InlineData("0%")]
    public void ignores_invalid_or_nonpositive_font_size(string size)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"font-size:{size}\">ב</span>");
        runs.First(r => r.Text.Contains('ב')).FontScale.Should().Be(1.0);
    }

    [Fact]
    public void skips_non_li_siblings_when_numbering_ordered_list()
    {
        var runs = HtmlRuns.FromHtml("<ol><li>א</li>הערה<li>ב</li></ol>");
        runs.Select(r => r.Text).Should().Contain(t => t.Contains("2."));
    }

    [Fact]
    public void unknown_elements_keep_their_text_with_default_style()
    {
        var runs = HtmlRuns.FromHtml("א<mark>ב</mark>ג");
        var marked = runs.First(r => r.Text.Contains('ב'));
        marked.Bold.Should().BeFalse();
        marked.FontScale.Should().Be(1.0);
    }

    [Fact]
    public void mid_headings_carry_their_level()
    {
        var runs = HtmlRuns.FromHtml("<h4>כותרת</h4>גוף");
        runs[0].HeadingLevel.Should().Be(4);
    }
}

public class HtmlRunsTagCoverageTests
{
    [Theory]
    [InlineData("strong")]
    [InlineData("b")]
    public void semantic_bold_tags_mark_bold(string tag)
    {
        var runs = HtmlRuns.FromHtml($"א<{tag}>ב</{tag}>");
        runs.First(r => r.Text.Contains('ב')).Bold.Should().BeTrue();
    }

    [Theory]
    [InlineData("em")]
    public void semantic_italic_tags_mark_italic(string tag)
    {
        var runs = HtmlRuns.FromHtml($"א<{tag}>ב</{tag}>");
        runs.First(r => r.Text.Contains('ב')).Italic.Should().BeTrue();
    }

    [Theory]
    [InlineData("u")]
    [InlineData("ins")]
    public void underline_tags_mark_underline(string tag)
    {
        var runs = HtmlRuns.FromHtml($"א<{tag}>ב</{tag}>");
        runs.First(r => r.Text.Contains('ב')).Underline.Should().BeTrue();
    }

    [Theory]
    [InlineData("s")]
    [InlineData("strike")]
    [InlineData("del")]
    public void strikethrough_tags_mark_strikethrough(string tag)
    {
        var runs = HtmlRuns.FromHtml($"א<{tag}>ב</{tag}>");
        runs.First(r => r.Text.Contains('ב')).Strikethrough.Should().BeTrue();
    }

    [Theory]
    [InlineData("h0")]
    [InlineData("h7")]
    [InlineData("hx")]
    public void invalid_heading_tags_fall_back_to_default(string tag)
    {
        var runs = HtmlRuns.FromHtml($"<{tag}>כותרת</{tag}>");
        runs.Should().ContainSingle().Which.HeadingLevel.Should().Be(0);
    }

    [Theory]
    [InlineData("font-style:normal")]
    [InlineData("vertical-align:baseline")]
    public void css_keywords_outside_the_supported_set_are_ignored(string css)
    {
        var runs = HtmlRuns.FromHtml($"א<span style=\"{css}\">ב</span>");
        var run = runs.First(r => r.Text.Contains('ב'));
        run.Italic.Should().BeFalse();
        run.BaselineShift.Should().Be(0);
    }

    [Fact]
    public void whitespace_after_a_break_is_dropped()
    {
        var runs = HtmlRuns.FromHtml("א<br>  ב");
        runs.Last().Text.Should().Be("\nב");
    }

    [Fact]
    public void break_only_document_stays_empty()
    {
        HtmlRuns.FromHtml("<br>").Should().BeEmpty();
    }
}
