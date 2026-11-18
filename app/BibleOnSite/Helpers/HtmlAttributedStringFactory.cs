#if IOS || MACCATALYST
using System.Runtime.InteropServices;
using CoreGraphics;
using Foundation;
using UIKit;

namespace BibleOnSite.Helpers;

/// <summary>
/// Builds NSMutableAttributedString from HtmlRuns with UIKit attributes.
/// Shared by the iOS and MacCatalyst HtmlView handlers. Entirely managed +
/// UIKit primitives — no WebKit import, safe to call off the main thread
/// (callers pass pre-resolved font settings so nothing reads the view here).
/// </summary>
internal static class HtmlAttributedStringFactory
{
    /// <summary>Indent applied per quote level — the equivalent of the
    /// website's quote padding, in em of the view's font size (#3443).</summary>
    private const double QuoteIndentEm = 1.0;

    /// <summary>Gap between a quote paragraph's text and its accent bar,
    /// in em of the view's font size (#3443).</summary>
    private const double QuotePaddingEm = 0.55;

    /// <summary>
    /// Converts HTML to an attributed string using the managed HtmlRuns parser.
    /// Empty markup produces an empty attributed string. Returns null on a
    /// conversion failure so callers can fall back to plain text.
    /// Runs carry their own ForegroundColor: <paramref name="textColor"/> for
    /// ordinary text, <paramref name="accentColor"/> for runs flagged
    /// <see cref="HtmlRun.Accent"/> — the generated note-list markers share the
    /// inline reference's link color without a link target (#2723).
    /// <paramref name="baseStyle"/> is applied to the whole string and cloned
    /// per quote range so blockquotes keep the view's alignment/direction
    /// while gaining their accent blocks (#3443).
    /// </summary>
    public static NSMutableAttributedString? FromHtml(
        string html, double fontSize, double h1Scale, double h2Scale, double h3Scale,
        UIColor textColor, UIColor accentColor,
        NSMutableParagraphStyle baseStyle, bool rtl,
        UIFont regularFont, UIFont boldFont)
    {
        try
        {
            var runs = HtmlRuns.FromHtml(html);
            var attributed = new NSMutableAttributedString();
            foreach (var run in runs)
            {
                var headingScale = run.HeadingLevel switch
                {
                    1 => h1Scale,
                    2 => h2Scale,
                    >= 3 => h3Scale,
                    _ => 1.0
                };
                var size = (NFloat)(fontSize * run.FontScale * headingScale);
                var font = ResolveFont(size, run.Bold ? boldFont : regularFont, run.Italic);

                var keys = new List<NSString>
                {
                    UIStringAttributeKey.Font,
                    UIStringAttributeKey.ForegroundColor
                };
                var values = new List<NSObject>
                {
                    font,
                    run.Accent ? accentColor : textColor
                };

                if (run.BaselineShift > 0)
                {
                    keys.Add(UIStringAttributeKey.BaselineOffset);
                    values.Add(NSNumber.FromDouble(fontSize * 0.3));
                }
                else if (run.BaselineShift < 0)
                {
                    keys.Add(UIStringAttributeKey.BaselineOffset);
                    values.Add(NSNumber.FromDouble(-fontSize * 0.2));
                }
                if (run.Underline)
                {
                    keys.Add(UIStringAttributeKey.UnderlineStyle);
                    values.Add(NSNumber.FromInt32((int)NSUnderlineStyle.Single));
                }
                if (run.Strikethrough)
                {
                    keys.Add(UIStringAttributeKey.StrikethroughStyle);
                    values.Add(NSNumber.FromInt32((int)NSUnderlineStyle.Single));
                }
                if (run.Link is { } link)
                {
                    // NSString targets keep non-ASCII URLs working where NSUrl
                    // parsing would fail.
                    keys.Add(UIStringAttributeKey.Link);
                    values.Add(new NSString(link));
                }

                attributed.Append(new NSAttributedString(
                    run.Text, new NSDictionary<NSString, NSObject>(keys.ToArray(), values.ToArray())));
            }
            var fullRange = new NSRange(0, attributed.Length);
            attributed.AddAttribute(UIStringAttributeKey.ParagraphStyle, baseStyle, fullRange);
            ApplyQuoteStyles(attributed, runs, baseStyle, accentColor, rtl, fontSize);
            return attributed;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: attributed-string parse failure falls back to plain text
        catch (Exception ex) //NOSONAR — attributed-string parse failure falls back to plain text.
        {
            #pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"HtmlAttributedStringFactory parse error: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Paints each block-quote range as a nested <see cref="NSTextBlock"/> per
    /// level — the same mechanism WebKit's attributed-string import used for
    /// &lt;blockquote&gt; before the managed parser replaced it (#3443). The
    /// accent bar sits on the paragraph's leading edge: MaxX under RTL (the
    /// right side, mirroring the website's border-inline-start), MinX under
    /// LTR. Blocks are decorative paragraph dressing: no extra text reaches
    /// copy, accessibility or reading metrics.
    /// </summary>
    private static void ApplyQuoteStyles(
        NSMutableAttributedString attributed, IReadOnlyList<HtmlRun> runs,
        NSMutableParagraphStyle baseStyle, UIColor accentColor, bool rtl, double fontSize)
    {
        var quoteBlocks = HtmlRuns.QuoteBlocks(runs);
        if (quoteBlocks.Count == 0)
        {
            return;
        }
        var edge = rtl ? CGRectEdge.MaxXEdge : CGRectEdge.MinXEdge;
        foreach (var block in quoteBlocks)
        {
            var quoteStyle = (NSMutableParagraphStyle)baseStyle.MutableCopy();
            var indent = (NFloat)(fontSize * QuoteIndentEm * block.Depth);
            quoteStyle.HeadIndent = indent;
            quoteStyle.FirstLineHeadIndent = indent;
            var decorations = new NSTextBlock[block.Depth];
            for (var i = 0; i < decorations.Length; i++)
            {
                var textBlock = new NSTextBlock();
                textBlock.SetWidth((NFloat)3.0, NSTextBlockValueType.Absolute,
                    NSTextBlockLayer.Border, edge);
                textBlock.SetBorderColor(accentColor.ColorWithAlpha((NFloat)0.55), edge);
                textBlock.SetWidth((NFloat)(fontSize * QuotePaddingEm),
                    NSTextBlockValueType.Absolute, NSTextBlockLayer.Padding, edge);
                textBlock.BackgroundColor = accentColor.ColorWithAlpha((NFloat)0.06);
                decorations[i] = textBlock;
            }
            quoteStyle.TextBlocks = decorations;
            attributed.AddAttribute(UIStringAttributeKey.ParagraphStyle, quoteStyle,
                new NSRange(block.Start, block.End - block.Start));
        }
    }

    private static UIFont ResolveFont(NFloat size, UIFont face, bool italic)
    {
        var font = face.WithSize(size) ?? face;
        if (!italic)
        {
            return font;
        }
        var descriptor = font.FontDescriptor.CreateWithTraits(
            font.FontDescriptor.SymbolicTraits | UIFontDescriptorSymbolicTraits.Italic);
        return descriptor != null ? (UIFont.FromDescriptor(descriptor, size) ?? font) : font;
    }
}
#endif
