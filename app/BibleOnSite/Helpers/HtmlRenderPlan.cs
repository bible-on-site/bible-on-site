using System.Text;

namespace BibleOnSite.Helpers;

/// <summary>
/// A styled character range inside <see cref="HtmlRenderPlan.Text"/>. Ranges
/// are half-open ([Start, End)) in the flattened text; <see cref="Scale"/> is
/// the run's font scale already multiplied by the heading multiplier for its
/// level, so platforms can map one value onto their relative-size primitive.
/// </summary>
public readonly record struct HtmlRenderSpan(
    int Start, int End,
    bool Bold, bool Italic, bool Underline, bool Strikethrough,
    int BaselineShift, double Scale, string? Link, bool Accent)
{
    /// <summary>A span carrying no styling needs no native span at all.</summary>
    public bool IsPlain =>
        !Bold && !Italic && !Underline && !Strikethrough &&
        BaselineShift == 0 && Math.Abs(Scale - 1.0) < 0.0001 && Link is null && !Accent;
}

/// <summary>
/// Flattened render model for HTML commentary: the exact text the platform
/// view displays plus the styled ranges it carries. Produced entirely from the
/// managed <see cref="HtmlRuns"/> pipeline — platform handlers map it onto
/// their native span types (Android SpannableStringBuilder, etc.) without
/// re-parsing markup.
/// </summary>
public sealed record HtmlRenderPlan(string Text, IReadOnlyList<HtmlRenderSpan> Spans)
{
    /// <summary>
    /// Parses <paramref name="html"/> into runs and flattens them into display
    /// text with styled ranges. When <paramref name="rtl"/> is set a leading
    /// Right-to-Left Mark (U+200F) anchors the bidi paragraph direction — the
    /// same marker the Android Html.FromHtml path inserted — even when the
    /// text is short or starts with neutral characters. The h1-h3 multipliers
    /// resolve heading runs to a final <see cref="HtmlRenderSpan.Scale"/> so
    /// font settings reach the platform inside the plan.
    /// </summary>
    public static HtmlRenderPlan Build(string? html, bool rtl, double h1Scale, double h2Scale, double h3Scale)
    {
        var runs = HtmlRuns.FromHtml(html);
        var length = 0;
        foreach (var run in runs)
        {
            length += run.Text.Length;
        }
        var text = new StringBuilder(length + 1);
        if (rtl)
        {
            text.Append('\u200F');
        }
        var spans = new List<HtmlRenderSpan>(runs.Count);
        foreach (var run in runs)
        {
            var start = text.Length;
            text.Append(run.Text);
            var scale = run.FontScale * HeadingScale(run.HeadingLevel, h1Scale, h2Scale, h3Scale);
            var span = new HtmlRenderSpan(start, text.Length, run.Bold, run.Italic,
                run.Underline, run.Strikethrough, run.BaselineShift, scale, run.Link, run.Accent);
            if (!span.IsPlain)
            {
                spans.Add(span);
            }
        }
        return new HtmlRenderPlan(text.ToString(), spans);
    }

    /// <summary>
    /// Heading runs take the view's h1-h3 font-size multipliers; levels deeper
    /// than h3 share the h3 multiplier, mirroring the iOS attributed-string
    /// factory's level mapping.
    /// </summary>
    private static double HeadingScale(int level, double h1Scale, double h2Scale, double h3Scale) => level switch
    {
        1 => h1Scale,
        2 => h2Scale,
        >= 3 => h3Scale,
        _ => 1.0
    };
}
