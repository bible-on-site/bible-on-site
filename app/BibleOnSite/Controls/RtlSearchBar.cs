namespace BibleOnSite.Controls;

/// <summary>
/// A SearchBar that honors the app's right-to-left direction inside its native
/// input. On Android the androidx SearchView hardcodes
/// layoutDirection="locale" on its search_edit_frame, so a non-Hebrew device
/// locale leaves the magnifier and the hint left-aligned (#2452). The native
/// decorations are scoped to this control, leaving other search bars unchanged.
/// </summary>
public sealed class RtlSearchBar : SearchBar
{
    public RtlSearchBar()
    {
        FlowDirection = FlowDirection.RightToLeft;
        HorizontalTextAlignment = TextAlignment.Start;
    }

    static RtlSearchBar()
    {
        foreach (var property in new[] { nameof(FlowDirection), nameof(HorizontalTextAlignment), nameof(Placeholder) })
        {
            Microsoft.Maui.Handlers.SearchBarHandler.Mapper.AppendToMapping(property, (handler, searchBar) =>
            {
                if (searchBar is RtlSearchBar)
                {
                    ConfigureNativeInput(handler.PlatformView);
                }
            });
        }
    }

    private static void ConfigureNativeInput(object platformView)
    {
#if ANDROID
        if (platformView is Android.Views.ViewGroup group)
        {
            // layoutDirection="locale" on search_edit_frame resolves from the
            // device locale, not the app flow direction, so force RTL everywhere.
            ForceRtl(group);
            if (FindEditText(group) is { } input)
            {
                input.LayoutDirection = Android.Views.LayoutDirection.Rtl;
                input.TextDirection = Android.Views.TextDirection.FirstStrongRtl;
                input.TextAlignment = Android.Views.TextAlignment.Gravity;
                input.Gravity = Android.Views.GravityFlags.Right | Android.Views.GravityFlags.CenterVertical;
            }
        }
#elif WINDOWS
        if (platformView is Microsoft.UI.Xaml.Controls.AutoSuggestBox box)
        {
            // WinUI inherits FlowDirection into the inner TextBox and mirrors
            // its alignment, so the text and the icon land on the RTL edges.
            box.FlowDirection = Microsoft.UI.Xaml.FlowDirection.RightToLeft;
        }
#elif IOS || MACCATALYST
        if (platformView is UIKit.UISearchBar searchBar)
        {
            searchBar.SemanticContentAttribute = UIKit.UISemanticContentAttribute.ForceRightToLeft;
            searchBar.SearchTextField.TextAlignment = UIKit.UITextAlignment.Right;
        }
#endif
    }

#if ANDROID
    private static void ForceRtl(Android.Views.ViewGroup group)
    {
        group.LayoutDirection = Android.Views.LayoutDirection.Rtl;
        for (var index = 0; index < group.ChildCount; index++)
        {
            var child = group.GetChildAt(index);
            if (child == null)
            {
                continue;
            }
            child.LayoutDirection = Android.Views.LayoutDirection.Rtl;
            if (child is Android.Views.ViewGroup nested)
            {
                ForceRtl(nested);
            }
        }
    }

    private static Android.Widget.EditText? FindEditText(Android.Views.ViewGroup group)
    {
        for (var index = 0; index < group.ChildCount; index++)
        {
            var child = group.GetChildAt(index);
            if (child is Android.Widget.EditText input)
            {
                return input;
            }
            if (child is Android.Views.ViewGroup nested && FindEditText(nested) is { } found)
            {
                return found;
            }
        }
        return null;
    }
#endif
}
