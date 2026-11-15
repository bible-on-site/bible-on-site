#if IOS || MACCATALYST
using CoreGraphics;
using Foundation;
using Microsoft.Maui.Platform;
using UIKit;

namespace BibleOnSite.Controls;

/// <summary>
/// The platform view behind <see cref="PasukTextLabel"/> on iOS/Mac Catalyst.
/// UILabel rasterizes attributed text with its own typesetter, which resolves a
/// justified paragraph's short last line by the app's preferred language rather
/// than the paragraph's BaseWritingDirection — so on an English-locale device a
/// justified RTL pasuk's last line flushed left even after #3057 pinned the
/// direction into the style (#3380). Drawing through TextKit — the engine the
/// inline commentary's UITextView already uses — honors BaseWritingDirection:
/// the last line anchors to the paragraph's leading edge, the right side for
/// RTL. Measure/arrange still come from UILabel's own sizing; both engines
/// typeset the same attributed string, so line breaking stays consistent.
/// </summary>
public sealed class PasukUILabel : MauiLabel
{
    public override void DrawText(CGRect rect)
    {
        if (AttributedText is not { Length: > 0 } attributed)
        {
            base.DrawText(rect);
            return;
        }

        // The same TextInsets flip MauiLabel applies before UILabel's draw; the
        // pasuk style never sets a non-center vertical alignment, which is the
        // only other adjustment MauiLabel.DrawText makes to the text rect.
        var insets = TextInsets;
        if (EffectiveUserInterfaceLayoutDirection == UIUserInterfaceLayoutDirection.RightToLeft)
        {
            insets = new UIEdgeInsets(insets.Top, insets.Right, insets.Bottom, insets.Left);
        }
        rect = insets.InsetRect(rect);

        using var textStorage = new NSTextStorage();
        textStorage.SetString(attributed);
        using var layoutManager = new NSLayoutManager
        {
            // Same typesetter convention as MAUI's span hit-testing (#36505):
            // on iOS 16+ font leading must be disabled to match the metrics
            // CoreText actually renders with.
            UsesFontLeading = !OperatingSystem.IsIOSVersionAtLeast(16),
        };
        using var textContainer = new NSTextContainer
        {
            // Lines == 0 leaves the label's own measure as the only height
            // bound, matching how UILabel draws every wrapped line.
            Size = new CGSize(rect.Width, Lines == 0 ? nfloat.MaxValue : rect.Height),
            LineFragmentPadding = 0,
            LineBreakMode = LineBreakMode,
            MaximumNumberOfLines = (nuint)nint.Max(Lines, 0),
        };
        textStorage.AddLayoutManager(layoutManager);
        layoutManager.AddTextContainer(textContainer);
        layoutManager.EnsureLayoutForTextContainer(textContainer);
        layoutManager.DrawGlyphs(
            layoutManager.GetGlyphRange(textContainer),
            rect.Location);
    }
}
#endif
