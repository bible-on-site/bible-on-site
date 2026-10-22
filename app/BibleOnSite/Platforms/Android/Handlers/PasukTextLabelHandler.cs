using Android.Text;
using BibleOnSite.Controls;
using Microsoft.Maui.Handlers;

namespace BibleOnSite.Handlers;

/// <summary>
/// Android handler for PasukTextLabel. TextView's JustificationMode.InterWord
/// stretches every line of a paragraph except its last, the same inter-word
/// justification the inline commentary applies (#2402). The mode lives on the
/// view, so text/span updates never reset it: applying it once via the Justify
/// key at the end of connect is enough, and that same key catches toggles.
/// </summary>
public sealed class PasukTextLabelHandler : LabelHandler
{
    private static readonly IPropertyMapper<ILabel, PasukTextLabelHandler> PasukMapper =
        CreateMapper();

    private static IPropertyMapper<ILabel, PasukTextLabelHandler> CreateMapper()
    {
        var mapper = new PropertyMapper<ILabel, PasukTextLabelHandler>(Mapper);
        mapper.AppendToMapping(nameof(PasukTextLabel.Justify), static (handler, _) => handler.ApplyJustification());
        return mapper;
    }

    public PasukTextLabelHandler() : base(PasukMapper)
    {
    }

    private void ApplyJustification()
    {
        // JustificationMode exists only from API 26; older devices (minSdk 23)
        // keep natural alignment.
        if (PlatformView is not { } textView || !OperatingSystem.IsAndroidVersionAtLeast(26))
        {
            return;
        }

        textView.JustificationMode = (VirtualView as PasukTextLabel)?.Justify == true
            ? JustificationMode.InterWord
            : JustificationMode.None;
    }
}
