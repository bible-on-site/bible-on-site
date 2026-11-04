namespace BibleOnSite.Controls;

/// <summary>
/// The search-filter row checkbox: a 44×44 hit target whose visible square is
/// centered inside the control, matching the label that centers in the same
/// row (#2724). On Android the MaterialCheckBox only guarantees that centered
/// square when <c>centerIfNoText</c> is on — a control that is merely centered
/// in the row still shows the square offset on builds where it resolves off.
/// The native decoration is scoped to this control — other CheckBoxes keep
/// stock rendering.
/// </summary>
public sealed class CenteredCheckBox : CheckBox
{
    public CenteredCheckBox()
    {
        WidthRequest = TriStateCheckBox.RowWidth;
        HeightRequest = TriStateCheckBox.RowHeight;
    }

    static CenteredCheckBox()
    {
        Microsoft.Maui.Handlers.CheckBoxHandler.Mapper.AppendToMapping(
            nameof(IsChecked), (handler, check) =>
            {
                if (check is CenteredCheckBox)
                {
                    CenterNativeSquare(handler.PlatformView);
                }
            });
    }

    internal static void CenterNativeSquare(object platformView)
    {
#if ANDROID
        if (platformView is Google.Android.Material.CheckBox.MaterialCheckBox material)
        {
            // Material's "no text" alignment: keeps the square at the start edge
            // (right in RTL) but centers it vertically in the control.
            material.CenterIfNoTextEnabled = true;
        }
        else if (platformView is Android.Widget.CompoundButton compound)
        {
            compound.Gravity = Android.Views.GravityFlags.Start | Android.Views.GravityFlags.CenterVertical;
        }
#endif
    }
}
