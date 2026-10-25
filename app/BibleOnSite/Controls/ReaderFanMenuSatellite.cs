namespace BibleOnSite.Controls;

/// <summary>
/// One satellite button of <see cref="ReaderFanMenu"/> — carries the shared
/// 48px FluentUI-icon styling so each reader page only supplies the icon,
/// AutomationId, Command and click handler for its own navigation actions.
/// </summary>
public class ReaderFanMenuSatellite : Button
{
    public ReaderFanMenuSatellite()
    {
        FontFamily = "FluentIcons";
        FontSize = 22;
        WidthRequest = 48;
        HeightRequest = 48;
        CornerRadius = 24;
        TextColor = Colors.White;
        Padding = 0;
        Opacity = 0;
        InputTransparent = true;
        if (Microsoft.Maui.Controls.Application.Current?.Resources.TryGetValue("PrimaryDark", out var dark) == true
            && dark is Color darkColor)
        {
            BackgroundColor = darkColor;
        }
    }
}
