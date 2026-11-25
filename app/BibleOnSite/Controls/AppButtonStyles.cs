namespace BibleOnSite.Controls;

/// <summary>Shared action hierarchy for XAML and code-created buttons.</summary>
public static class AppButtonStyles
{
    public static readonly Color SurfaceLight = Colors.White;
    public static readonly Color SurfaceDark = Color.FromArgb("#243C5D");
    public static readonly Color StrokeLight = Color.FromArgb("#E3E7ED");
    public static readonly Color StrokeDark = Color.FromArgb("#334B6C");
    public static readonly Color InkLight = Color.FromArgb("#1552AC");
    public static readonly Color InkDark = Color.FromArgb("#AACBFF");
    public static readonly Color DestructiveInkLight = Color.FromArgb("#B00020");
    public static readonly Color DestructiveInkDark = Color.FromArgb("#FFB4AB");

    private sealed record Palette((Color Light, Color Dark) Surface, (Color Light, Color Dark) Ink,
        (Color Light, Color Dark) Stroke);

    // A style-owned palette uses MAUI's public theme binding API and also replaces
    // legacy local theme bindings when a control is migrated to a shared style.
    private static readonly BindableProperty PaletteProperty = BindableProperty.CreateAttached(
        "Palette", typeof(Palette), typeof(AppButtonStyles), null,
        propertyChanged: (bindable, _, value) =>
        {
            if (bindable is Button button && value is Palette colors)
            {
                button.SetAppThemeColor(VisualElement.BackgroundColorProperty, colors.Surface.Light, colors.Surface.Dark);
                button.SetAppThemeColor(Button.TextColorProperty, colors.Ink.Light, colors.Ink.Dark);
                button.SetAppThemeColor(Button.BorderColorProperty, colors.Stroke.Light, colors.Stroke.Dark);
            }
        });

    public static Style Secondary { get; } = Create((SurfaceLight, SurfaceDark), (InkLight, InkDark), (StrokeLight, StrokeDark), 1);
    public static Style Primary { get; } = Create((InkLight, InkLight), (Colors.White, Colors.White), (InkLight, InkLight), 0);
    public static Style Destructive { get; } = Create((SurfaceLight, SurfaceDark),
        (DestructiveInkLight, DestructiveInkDark), (DestructiveInkLight, DestructiveInkDark), 1);
    public static Style Ghost { get; } = CreateGhost();
    public static Style Icon { get; } = CreateIcon();

    /// <summary>Replace legacy local appearance values while retaining page-owned layout.</summary>
    public static void Apply(Button button, Style style)
    {
        button.Style = null;
        foreach (var property in new[] { VisualElement.BackgroundColorProperty, Button.TextColorProperty,
            Button.BorderColorProperty, Button.BorderWidthProperty, Button.CornerRadiusProperty, Button.PaddingProperty })
        {
            button.RemoveBinding(property);
            button.ClearValue(property);
        }
        if (style == Icon || style == CompactIcon || style == CompactIconSelected)
        {
            button.ClearValue(VisualElement.WidthRequestProperty);
            button.ClearValue(VisualElement.HeightRequestProperty);
        }
        else if (style == ToolbarTitle)
        {
            button.ClearValue(VisualElement.HeightRequestProperty);
        }
        button.Style = style;
    }

    private static Style CreateGhost()
    {
        var style = new Style(typeof(Button)) { BasedOn = Secondary };
        style.Setters.Add(new Setter
        {
            Property = PaletteProperty,
            Value = new Palette((Colors.Transparent, Colors.Transparent), (InkLight, InkDark), (Colors.Transparent, Colors.Transparent)),
        });
        style.Setters.Add(new Setter { Property = Button.BorderWidthProperty, Value = 0d });
        return style;
    }

    private static Style Create((Color Light, Color Dark) surface, (Color Light, Color Dark) ink,
        (Color Light, Color Dark) stroke, double borderWidth)
    {
        var style = new Style(typeof(Button));
        style.Setters.Add(new Setter { Property = PaletteProperty, Value = new Palette(surface, ink, stroke) });
        style.Setters.Add(new Setter { Property = Button.BorderWidthProperty, Value = borderWidth });
        style.Setters.Add(new Setter { Property = Button.CornerRadiusProperty, Value = 16 });
        style.Setters.Add(new Setter { Property = Button.FontFamilyProperty, Value = Helpers.BrandFonts.RegularFamily });
        style.Setters.Add(new Setter { Property = Button.FontSizeProperty, Value = 16d });
        style.Setters.Add(new Setter { Property = Button.PaddingProperty, Value = new Thickness(14, 10) });
        style.Setters.Add(new Setter { Property = VisualElement.MinimumHeightRequestProperty, Value = 48d });
        style.Setters.Add(new Setter { Property = VisualElement.MinimumWidthRequestProperty, Value = 48d });
        style.Setters.Add(new Setter
        {
            Property = VisualStateManager.VisualStateGroupsProperty,
            Value = new VisualStateGroupList
            {
                new VisualStateGroup
                {
                    Name = "CommonStates",
                    States =
                    {
                        new VisualState { Name = "Normal" },
                        new VisualState { Name = "Disabled", Setters = { new Setter { Property = VisualElement.OpacityProperty, Value = 0.45 } } },
                        new VisualState { Name = "PointerOver", Setters = { new Setter { Property = VisualElement.OpacityProperty, Value = 0.85 } } },
                        new VisualState { Name = "Pressed", Setters = { new Setter { Property = VisualElement.OpacityProperty, Value = 0.7 } } },
                    },
                },
            },
        });
        return style;
    }

    public static Style CompactIcon { get; } = CreateCompactIcon();
    public static Style ToolbarTitle { get; } = CreateToolbarTitle();
    public static Style Selected { get; } = CreateSelected(Secondary);
    public static Style CompactIconSelected { get; } = CreateSelected(CompactIcon);

    private static Style CreateToolbarTitle()
    {
        var style = new Style(typeof(Button)) { BasedOn = Secondary };
        style.Setters.Add(new Setter { Property = VisualElement.HeightRequestProperty, Value = 52d });
        style.Setters.Add(new Setter { Property = VisualElement.MinimumHeightRequestProperty, Value = 52d });
        style.Setters.Add(new Setter { Property = Button.PaddingProperty, Value = new Thickness(12, 0) });
        return style;
    }

    private static Style CreateCompactIcon()
    {
        var style = new Style(typeof(Button)) { BasedOn = Icon };
        foreach (var property in new[] { VisualElement.HeightRequestProperty, VisualElement.WidthRequestProperty,
            VisualElement.MinimumHeightRequestProperty, VisualElement.MinimumWidthRequestProperty })
        {
            style.Setters.Add(new Setter { Property = property, Value = 44d });
        }
        return style;
    }

    private static Style CreateSelected(Style basedOn)
    {
        var style = new Style(typeof(Button)) { BasedOn = basedOn };
        style.Setters.Add(new Setter { Property = PaletteProperty,
            Value = new Palette((SurfaceLight, SurfaceDark), (InkLight, InkDark), (InkLight, InkDark)) });
        style.Setters.Add(new Setter { Property = Button.BorderWidthProperty, Value = 2d });
        return style;
    }

    private static Style CreateIcon()
    {
        var style = new Style(typeof(Button)) { BasedOn = Secondary };
        style.Setters.Add(new Setter { Property = Button.FontFamilyProperty, Value = "FluentIcons" });
        style.Setters.Add(new Setter { Property = Button.FontSizeProperty, Value = 24d });
        style.Setters.Add(new Setter { Property = Button.PaddingProperty, Value = new Thickness(0) });
        style.Setters.Add(new Setter { Property = VisualElement.HeightRequestProperty, Value = 52d });
        style.Setters.Add(new Setter { Property = VisualElement.WidthRequestProperty, Value = 52d });
        return style;
    }

}
