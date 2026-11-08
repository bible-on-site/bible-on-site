using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Unit tests for <see cref="HtmlRenderPlan"/> — the flattened render model
/// the Android handler maps onto native spans after the managed
/// <see cref="HtmlRuns"/> parse.
/// </summary>
public class HtmlRenderPlanTests
{
    public class FlattenedText
    {
        [Fact]
        public void joins_run_text_in_document_order()
        {
            var plan = HtmlRenderPlan.Build("א<b>ב</b>ג", rtl: false, 1, 1, 1);
            plan.Text.Should().Be("אבג");
        }

        [Fact]
        public void decodes_entities_and_collapses_whitespace()
        {
            var plan = HtmlRenderPlan.Build("א &lt;  \n ב", rtl: false, 1, 1, 1);
            plan.Text.Should().Be("א < ב");
        }

        [Fact]
        public void trims_trailing_block_whitespace()
        {
            var plan = HtmlRenderPlan.Build("<p>א</p><p> </p>", rtl: false, 1, 1, 1);
            plan.Text.Should().Be("א");
        }

        [Fact]
        public void empty_html_produces_empty_text()
        {
            HtmlRenderPlan.Build(null, rtl: false, 1, 1, 1).Text.Should().BeEmpty();
        }

        [Fact]
        public void rtl_prefixes_a_right_to_left_mark()
        {
            var plan = HtmlRenderPlan.Build("אב", rtl: true, 1, 1, 1);
            plan.Text.Should().Be("\u200Fאב");
        }

        [Fact]
        public void ltr_has_no_mark()
        {
            HtmlRenderPlan.Build("אב", rtl: false, 1, 1, 1).Text.Should().Be("אב");
        }
    }

    public class Spans
    {
        [Fact]
        public void ranges_cover_the_run_text()
        {
            var plan = HtmlRenderPlan.Build("א<b>בג</b>ד", rtl: false, 1, 1, 1);
            plan.Spans.Should().ContainSingle();
            var span = plan.Spans[0];
            plan.Text[span.Start..span.End].Should().Be("בג");
            span.Bold.Should().BeTrue();
        }

        [Fact]
        public void rtl_mark_shifts_all_ranges_by_one()
        {
            var plan = HtmlRenderPlan.Build("א<b>ב</b>", rtl: true, 1, 1, 1);
            var span = plan.Spans.Should().ContainSingle().Subject;
            (span.Start, span.End).Should().Be((2, 3));
            plan.Text[span.Start..span.End].Should().Be("ב");
        }

        [Fact]
        public void plain_runs_carry_no_span()
        {
            HtmlRenderPlan.Build("אב גד", rtl: false, 1, 1, 1).Spans.Should().BeEmpty();
        }

        [Fact]
        public void break_runs_carry_no_span()
        {
            var plan = HtmlRenderPlan.Build("<p>א</p><p>ב</p>", rtl: false, 1, 1, 1);
            plan.Text.Should().Be("א\nב");
            plan.Spans.Should().BeEmpty();
        }

        [Fact]
        public void combined_formatting_lands_on_one_span()
        {
            var plan = HtmlRenderPlan.Build("<b><i><u>א</u></i></b>", rtl: false, 1, 1, 1);
            var span = plan.Spans.Should().ContainSingle().Subject;
            (span.Bold, span.Italic, span.Underline, span.Strikethrough).Should().Be((true, true, true, false));
        }

        [Fact]
        public void superscript_shifts_baseline_and_shrinks()
        {
            var plan = HtmlRenderPlan.Build("א<sup>2</sup>", rtl: false, 1, 1, 1);
            var span = plan.Spans.Should().ContainSingle().Subject;
            span.BaselineShift.Should().Be(1);
            span.Scale.Should().BeLessThan(1.0);
        }

        [Fact]
        public void link_runs_carry_the_url()
        {
            var plan = HtmlRenderPlan.Build("<a href=\"https://x/י\">קישור</a>", rtl: false, 1, 1, 1);
            var span = plan.Spans.Should().ContainSingle().Subject;
            span.Link.Should().Be("https://x/י");
            span.Underline.Should().BeTrue();
        }

        [Fact]
        public void footnote_marker_carries_the_accent_span()
        {
            /* #2723: the generated note-list letter flattens into a styled
               span — raised, compact and accent-colored like the inline
               reference, but NOT a link — so the platform handler paints it
               with the link color without inventing a link target. */
            var plan = HtmlRenderPlan.Build(
                "<ol class=\"footnotes\"><li data-marker=\"א\"><p>גוף ההערה</p></li></ol>",
                rtl: false, 1, 1, 1);
            var span = plan.Spans.Should().ContainSingle().Subject;
            plan.Text[span.Start..span.End].Should().Be("א ");
            span.Accent.Should().BeTrue();
            span.BaselineShift.Should().Be(1);
            span.Scale.Should().BeLessThan(1.0);
            span.Link.Should().BeNull();
        }

        [Fact]
        public void footnote_marker_span_matches_the_inline_reference_span()
        {
            /* The two marker kinds must resolve identically — only the link
               differs. */
            var plan = HtmlRenderPlan.Build(
                "<p>טקסט<sup id=\"fnref:1\"><a href=\"#fn:1\">א</a></sup></p>" +
                "<ol class=\"footnotes\"><li id=\"fn:1\" data-marker=\"א\"><p>הערה</p></li></ol>",
                rtl: false, 1, 1, 1);
            var marker = plan.Spans.Should()
                .ContainSingle(s => s.Accent).Subject;
            var reference = plan.Spans.Should()
                .ContainSingle(s => plan.Text.Substring(s.Start, s.End - s.Start) == "א").Subject;
            marker.BaselineShift.Should().Be(reference.BaselineShift);
            marker.Scale.Should().Be(reference.Scale);
        }

        [Fact]
        public void adjacent_same_style_runs_share_one_span()
        {
            var plan = HtmlRenderPlan.Build("<b>א<i>ב</i>ג</b>", rtl: false, 1, 1, 1);
            // runs: bold(א), bold+italic(ב), bold(ג) — three styled spans.
            plan.Spans.Should().HaveCount(3);
            plan.Spans[0].Bold.Should().BeTrue();
            plan.Spans[0].Italic.Should().BeFalse();
            plan.Spans[1].Italic.Should().BeTrue();
            plan.Spans[2].Bold.Should().BeTrue();
            plan.Spans[2].Italic.Should().BeFalse();
        }
    }

    public class HeadingScales
    {
        [Fact]
        public void heading_levels_take_their_own_multiplier()
        {
            var plan = HtmlRenderPlan.Build("<h1>א</h1><h2>ב</h2><h3>ג</h3>", rtl: false, 2.0, 1.5, 1.25);
            var h1 = plan.Spans.First(s => plan.Text[s.Start..s.End] == "א");
            var h2 = plan.Spans.First(s => plan.Text[s.Start..s.End] == "ב");
            var h3 = plan.Spans.First(s => plan.Text[s.Start..s.End] == "ג");
            h1.Scale.Should().BeApproximately(2.0, 0.0001);
            h2.Scale.Should().BeApproximately(1.5, 0.0001);
            h3.Scale.Should().BeApproximately(1.25, 0.0001);
        }

        [Fact]
        public void deeper_heading_levels_share_the_h3_multiplier()
        {
            var plan = HtmlRenderPlan.Build("<h6>א</h6>", rtl: false, 2.0, 1.5, 1.25);
            plan.Spans.Should().ContainSingle().Which.Scale.Should().BeApproximately(1.25, 0.0001);
        }

        [Fact]
        public void heading_scale_stacks_on_inline_font_scale()
        {
            var plan = HtmlRenderPlan.Build("<h1><small>א</small></h1>", rtl: false, 2.0, 1.5, 1.25);
            plan.Spans.Should().ContainSingle().Which.Scale.Should().BeApproximately(2.0 * 0.83, 0.001);
        }
    }

    public class RealisticContent
    {
        [Fact]
        public void sefaria_style_note_produces_display_text_and_styled_spans()
        {
            const string html = "<b>בראשית</b> חכמינו אמרו " +
                "<i data-commentator=\"Mechokekei Yehudah\" data-order=\"1\"></i>" +
                "כי נמצא \"ראשונה יסעו\"<sup>2</sup>";
            var plan = HtmlRenderPlan.Build(html, rtl: true, 1.125, 1.0625, 0.925);
            plan.Text.Should().StartWith("\u200Fבראשית");
            plan.Text.Should().Contain("ראשונה יסעו");
            var boldSpan = plan.Spans.First(s => s.Bold);
            plan.Text[boldSpan.Start..boldSpan.End].Should().Be("בראשית");
            plan.Spans.Should().Contain(s => s.BaselineShift == 1);
        }

        [Fact]
        public void paragraphs_become_single_line_breaks_like_the_ios_renderer()
        {
            var plan = HtmlRenderPlan.Build("<p>א</p><p>ב</p><div>ג</div>", rtl: false, 1, 1, 1);
            plan.Text.Should().Be("א\nב\nג");
        }
    }
}
