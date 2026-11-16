using BibleOnSite.Controls;
using Microsoft.Maui.Handlers;

namespace BibleOnSite.Handlers;

/// <summary>
/// Windows handler for PasukTextLabel. TextBlock's TextAlignment.Justify stretches
/// every line of a paragraph except its last — matching the justified inline
/// commentary paragraphs (#2402). The justification is appended after MAUI's
/// HorizontalTextAlignment mapping so it wins on connect and on later remaps.
/// </summary>
public sealed class PasukTextLabelHandler : LabelHandler
{
    private static readonly IPropertyMapper<ILabel, PasukTextLabelHandler> PasukMapper =
        CreateMapper();

    private static IPropertyMapper<ILabel, PasukTextLabelHandler> CreateMapper()
    {
        var mapper = new PropertyMapper<ILabel, PasukTextLabelHandler>(Mapper);
        mapper.AppendToMapping(nameof(ITextAlignment.HorizontalTextAlignment),
            static (handler, _) => handler.ApplyJustification());
        mapper.AppendToMapping(nameof(PasukTextLabel.Justify),
            static (handler, _) => handler.ApplyJustification());
        mapper.AppendToMapping(nameof(PasukTextLabel.Selectable),
            static (handler, _) => handler.ApplySelectability());
        return mapper;
    }

    public PasukTextLabelHandler() : base(PasukMapper)
    {
    }

    private void ApplyJustification()
    {
        if (PlatformView is not { } textBlock || VirtualView is not PasukTextLabel label)
        {
            return;
        }

        if (label.Justify)
        {
            textBlock.TextAlignment = Microsoft.UI.Xaml.TextAlignment.Justify;
        }
        else
        {
            // Restore whatever MAUI's own alignment mapping produces.
            LabelHandler.Mapper.UpdateProperty(this, label,
                nameof(ITextAlignment.HorizontalTextAlignment));
        }
    }

    /// <summary>
    /// Desktop copy support: IsTextSelectionEnabled gives the TextBlock
    /// drag-selection and Ctrl+C-copyable text (#2766). Only surfaces that
    /// opted in via <see cref="PasukTextLabel.Selectable"/> — never the
    /// gesture-rich pasuk cell — take part.
    /// </summary>
    private void ApplySelectability()
    {
        if (PlatformView is { } textBlock && VirtualView is PasukTextLabel label)
        {
            textBlock.IsTextSelectionEnabled = label.Selectable;
        }
    }
}
