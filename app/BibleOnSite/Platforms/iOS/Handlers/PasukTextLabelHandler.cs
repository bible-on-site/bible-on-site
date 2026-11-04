using BibleOnSite.Controls;
using Foundation;
using Microsoft.Maui.Handlers;
using UIKit;

namespace BibleOnSite.Handlers;

/// <summary>
/// iOS handler for PasukTextLabel. A UILabel justifies attributed text only
/// through NSParagraphStyle.Alignment, so every attributed-text rebuild is
/// post-processed: the text's paragraph style is cloned with
/// UITextAlignment.Justified (keeping its other traits) — the same rendering
/// the inline commentary's UITextView produces (#2402). The clone also pins
/// BaseWritingDirection from the label's FlowDirection (#2964): a paragraph
/// style left at the "natural" base direction resolves from the device's
/// language preference, not the string's strong characters, so on an
/// English-locale device the last/short lines of a justified RTL pasuk flush
/// left. Pasuk text is a single uniform paragraph, so one merged style
/// covers the whole string.
/// </summary>
public sealed class PasukTextLabelHandler : LabelHandler
{
    private static readonly IPropertyMapper<ILabel, PasukTextLabelHandler> PasukMapper =
        CreateMapper();

    private static IPropertyMapper<ILabel, PasukTextLabelHandler> CreateMapper()
    {
        var mapper = new PropertyMapper<ILabel, PasukTextLabelHandler>(Mapper);
        // Every rebuild of the platform attributed string must re-apply the
        // justified paragraph style: Font and TextColor funnel into a
        // FormattedText update, so these keys cover span, text and size
        // changes; FlowDirection keeps the paragraph base direction in sync
        // with the label's effective direction after propagation.
        mapper.AppendToMapping(nameof(Label.FormattedText), static (handler, _) => handler.ApplyParagraphStyle());
        mapper.AppendToMapping(nameof(ILabel.Text), static (handler, _) => handler.ApplyParagraphStyle());
        mapper.AppendToMapping(nameof(IView.FlowDirection), static (handler, _) => handler.ApplyParagraphStyle());
        mapper.AppendToMapping(nameof(PasukTextLabel.Justify), static (handler, _) => handler.ApplyParagraphStyle());
        return mapper;
    }

    public PasukTextLabelHandler() : base(PasukMapper)
    {
    }

    private void ApplyParagraphStyle()
    {
        if (PlatformView is not { } label || VirtualView is not PasukTextLabel pasukLabel)
        {
            return;
        }

        var attributed = label.AttributedText;
        if (attributed is not { Length: > 0 })
        {
            return;
        }

        // Merge like MAUI's own WithLineHeight: clone the existing paragraph
        // style and change only alignment/direction, keeping line-height traits.
        var paragraphStyle = new NSMutableParagraphStyle();
        if (attributed.GetAttribute(UIStringAttributeKey.ParagraphStyle, 0, out _)
            is NSParagraphStyle existing)
        {
            paragraphStyle.SetParagraphStyle(existing);
        }

        paragraphStyle.Alignment = pasukLabel.Justify
            ? UITextAlignment.Justified
            : UITextAlignment.Natural;
        paragraphStyle.BaseWritingDirection = pasukLabel.FlowDirection == Microsoft.Maui.FlowDirection.RightToLeft
            ? NSWritingDirection.RightToLeft
            : NSWritingDirection.LeftToRight;

        var mutable = new NSMutableAttributedString(attributed);
        mutable.AddAttribute(UIStringAttributeKey.ParagraphStyle, paragraphStyle,
            new NSRange(0, mutable.Length));
        label.AttributedText = mutable;
        paragraphStyle.Dispose();
        mutable.Dispose();
    }
}
