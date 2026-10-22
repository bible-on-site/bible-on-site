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
/// the inline commentary's UITextView produces (#2402). Pasuk text is a single
/// uniform paragraph, so one merged style covers the whole string; Justified
/// keeps the last/short line at its natural edge.
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
        // FormattedText update, so these keys cover span, text and size changes.
        mapper.AppendToMapping(nameof(Label.FormattedText), static (handler, _) => handler.ApplyJustification());
        mapper.AppendToMapping(nameof(ILabel.Text), static (handler, _) => handler.ApplyJustification());
        mapper.AppendToMapping(nameof(PasukTextLabel.Justify), static (handler, _) => handler.ApplyJustification());
        return mapper;
    }

    public PasukTextLabelHandler() : base(PasukMapper)
    {
    }

    private void ApplyJustification()
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
        // style and change only the alignment, keeping line-height traits.
        var paragraphStyle = new NSMutableParagraphStyle();
        if (attributed.GetAttribute(UIStringAttributeKey.ParagraphStyle, 0, out _)
            is NSParagraphStyle existing)
        {
            paragraphStyle.SetParagraphStyle(existing);
        }

        paragraphStyle.Alignment = pasukLabel.Justify
            ? UITextAlignment.Justified
            : UITextAlignment.Natural;

        var mutable = new NSMutableAttributedString(attributed);
        mutable.AddAttribute(UIStringAttributeKey.ParagraphStyle, paragraphStyle,
            new NSRange(0, mutable.Length));
        label.AttributedText = mutable;
        paragraphStyle.Dispose();
        mutable.Dispose();
    }
}
