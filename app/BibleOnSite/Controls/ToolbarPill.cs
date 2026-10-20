namespace BibleOnSite.Controls;

/// <summary>
/// The rounded pill used inside <see cref="SharedTopBar"/>'s center slot:
/// the reader's title/search chrome, shared so pages cannot drift.
/// </summary>
public class ToolbarPill : Border
{
    public static readonly Color LightColor = Color.FromArgb("#E4EFFD");
    public static readonly Color DarkColor = Color.FromArgb("#2C4569");

    public ToolbarPill()
    {
        StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle
        {
            CornerRadius = SharedTopBar.PillCornerRadius,
        };
        Stroke = Colors.Transparent;
        StrokeThickness = 0;
        Padding = new Thickness(12, 0);
        HeightRequest = SharedTopBar.PillHeight;
        Margin = new Thickness(4, 0);
        VerticalOptions = LayoutOptions.Center;
        HorizontalOptions = LayoutOptions.Fill;
        this.SetAppThemeColor(BackgroundColorProperty, LightColor, DarkColor);
    }
}
