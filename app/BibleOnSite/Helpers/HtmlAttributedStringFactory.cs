#if IOS || MACCATALYST
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
    /// <summary>
    /// Converts HTML to an attributed string using the managed HtmlRuns parser.
    /// Empty markup produces an empty attributed string. Returns null on a
    /// conversion failure so callers can fall back to plain text.
    /// </summary>
    public static NSMutableAttributedString? FromHtml(
        string html, double fontSize, double h1Scale, double h2Scale, double h3Scale)
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
                var size = (nfloat)(fontSize * run.FontScale * headingScale);
                var font = ResolveFont(size, run.Bold, run.Italic);

                var keys = new List<NSString> { UIStringAttributeKey.Font };
                var values = new List<NSObject> { font };

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
            return attributed;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"HtmlAttributedStringFactory parse error: {ex.Message}");
            return null;
        }
    }

    private static UIFont ResolveFont(nfloat size, bool bold, bool italic)
    {
        // SystemFontOfSize is annotated nullable but only fails on bad input.
        var font = UIFont.SystemFontOfSize(size)!;
        UIFontDescriptorSymbolicTraits traits = 0;
        if (bold)
        {
            traits |= UIFontDescriptorSymbolicTraits.Bold;
        }
        if (italic)
        {
            traits |= UIFontDescriptorSymbolicTraits.Italic;
        }
        if (traits == 0)
        {
            return font;
        }
        var descriptor = font.FontDescriptor.CreateWithTraits(traits);
        return descriptor != null ? (UIFont.FromDescriptor(descriptor, size) ?? font) : font;
    }
}
#endif
