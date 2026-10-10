namespace BibleOnSite.Controls;

/// <summary>
/// A borderless, right-aligned field inside the reader's search surface.
/// Native decorations are scoped to this entry, leaving other inputs unchanged.
/// </summary>
public sealed class SearchEntry : Entry
{
    public SearchEntry()
    {
        FlowDirection = FlowDirection.RightToLeft;
        HorizontalTextAlignment = TextAlignment.Start;
        ClearButtonVisibility = ClearButtonVisibility.Never;
        ReturnType = ReturnType.Search;
        IsSpellCheckEnabled = false;
        BackgroundColor = Colors.Transparent;
    }

    static SearchEntry()
    {
        foreach (var property in new[] { nameof(Background), nameof(FlowDirection), nameof(HorizontalTextAlignment) })
        {
            Microsoft.Maui.Handlers.EntryHandler.Mapper.AppendToMapping(property, (handler, entry) =>
            {
                if (entry is SearchEntry)
                {
                    ConfigureNativeInput(handler.PlatformView);
                }
            });
        }
    }

    private static void ConfigureNativeInput(object platformView)
    {
#if ANDROID
        if (platformView is Android.Widget.EditText input)
        {
            input.Background = null;
            input.SetPadding(0, 0, 0, 0);
            input.LayoutDirection = Android.Views.LayoutDirection.Rtl;
            input.TextAlignment = Android.Views.TextAlignment.Gravity;
            input.Gravity = Android.Views.GravityFlags.Right | Android.Views.GravityFlags.CenterVertical;
        }
#elif WINDOWS
        if (platformView is Microsoft.UI.Xaml.Controls.TextBox input)
        {
            input.BorderThickness = new Microsoft.UI.Xaml.Thickness(0);
            // WinUI mirrors alignment in RTL. Left is the native leading edge.
            input.TextAlignment = Microsoft.UI.Xaml.TextAlignment.Left;
            var transparent = new Microsoft.UI.Xaml.Media.SolidColorBrush(Microsoft.UI.Colors.Transparent);
            input.BorderBrush = transparent;
            foreach (var state in new[] { "", "PointerOver", "Focused", "Disabled" })
            {
                input.Resources[$"TextControlBorderBrush{state}"] = transparent;
            }
        }
#elif IOS || MACCATALYST
        if (platformView is UIKit.UITextField input)
        {
            input.BorderStyle = UIKit.UITextBorderStyle.None;
            input.ClearButtonMode = UIKit.UITextFieldViewMode.Never;
            input.TextAlignment = UIKit.UITextAlignment.Right;
        }
#endif
    }
}
