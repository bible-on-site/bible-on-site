using BibleOnSite.Controls;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Controls;

public class AppButtonStylesTests
{
    [Fact]
    public void Apply_ReplacesLegacyColorsWithoutTakingTheTitleWidth()
    {
        var button = new Button { WidthRequest = 200, HeightRequest = 30, BackgroundColor = Colors.Blue };
        button.SetAppThemeColor(Button.TextColorProperty, Colors.Black, Colors.Black);

        AppButtonStyles.Apply(button, AppButtonStyles.ToolbarTitle);

        button.BackgroundColor.Should().Be(Colors.White);
        button.TextColor.Should().Be(AppButtonStyles.InkLight);
        button.WidthRequest.Should().Be(200);
        button.HeightRequest.Should().Be(52);
        AppButtonStyles.Apply(button, AppButtonStyles.Icon);
        button.WidthRequest.Should().Be(52);
        AppButtonStyles.Apply(button, AppButtonStyles.CompactIcon);
        button.WidthRequest.Should().Be(44);
        AppButtonStyles.Apply(button, AppButtonStyles.Secondary);
        button.BackgroundColor.Should().Be(Colors.White);
        AppButtonStyles.Apply(button, AppButtonStyles.Secondary);
        button.BackgroundColor.Should().Be(Colors.White);
    }

    [Fact]
    public void PrimaryAndSecondary_HaveDifferentEmphasisWithReadableText()
    {
        var primary = new Button { Style = AppButtonStyles.Primary };
        var secondary = new Button { Style = AppButtonStyles.Secondary };

        primary.BackgroundColor.Should().NotBe(secondary.BackgroundColor);
        secondary.BackgroundColor.Should().Be(Colors.White);
        primary.BorderWidth.Should().Be(0);
        secondary.BorderWidth.Should().BeGreaterThan(0);
        Contrast(primary.TextColor, primary.BackgroundColor).Should().BeGreaterThanOrEqualTo(4.5);
        Contrast(secondary.TextColor, secondary.BackgroundColor).Should().BeGreaterThanOrEqualTo(4.5);
        Contrast(AppButtonStyles.InkDark, AppButtonStyles.SurfaceDark).Should().BeGreaterThanOrEqualTo(4.5);
        Contrast(AppButtonStyles.DestructiveInkLight, AppButtonStyles.SurfaceLight).Should().BeGreaterThanOrEqualTo(4.5);
        Contrast(AppButtonStyles.DestructiveInkDark, AppButtonStyles.SurfaceDark).Should().BeGreaterThanOrEqualTo(4.5);
    }

    [Fact]
    public void CompactIconSelected_KeepsTheGlyphFontAndCompactTarget()
    {
        var button = new Button { Style = AppButtonStyles.CompactIconSelected };

        button.FontFamily.Should().Be("FluentIcons");
        button.WidthRequest.Should().Be(44);
        button.HeightRequest.Should().Be(44);
        button.BorderWidth.Should().Be(2);
    }

    [Theory]
    [InlineData("primary")]
    [InlineData("secondary")]
    [InlineData("destructive")]
    [InlineData("icon")]
    [InlineData("compact")]
    [InlineData("compact-selected")]
    [InlineData("selected")]
    [InlineData("toolbar")]
    public void ActionStates_RestoreAppearanceAndPreserveTouchTargets(string role)
    {
        var style = role switch
        {
            "primary" => AppButtonStyles.Primary,
            "destructive" => AppButtonStyles.Destructive,
            "icon" => AppButtonStyles.Icon,
            "compact" => AppButtonStyles.CompactIcon,
            "compact-selected" => AppButtonStyles.CompactIconSelected,
            "selected" => AppButtonStyles.Selected,
            "toolbar" => AppButtonStyles.ToolbarTitle,
            _ => AppButtonStyles.Secondary,
        };
        var button = new Button { Style = style };
        var surface = button.BackgroundColor;
        button.MinimumHeightRequest.Should().BeGreaterThanOrEqualTo(44);
        button.MinimumWidthRequest.Should().BeGreaterThanOrEqualTo(44);

        VisualStateManager.GoToState(button, "Disabled").Should().BeTrue();
        button.Opacity.Should().BeLessThan(1);
        button.BackgroundColor.Should().Be(surface);
        VisualStateManager.GoToState(button, "Normal").Should().BeTrue();
        button.Opacity.Should().Be(1);
        foreach (var state in new[] { "PointerOver", "Pressed" })
        {
            VisualStateManager.GoToState(button, state).Should().BeTrue();
            button.Opacity.Should().BeLessThan(1);
            VisualStateManager.GoToState(button, "Normal");
            button.Opacity.Should().Be(1);
        }
    }

    [Fact]
    public void Styles_CanBeSharedWithoutLeakingInteractionState()
    {
        var first = new Button { Style = AppButtonStyles.Secondary };
        var second = new Button { Style = AppButtonStyles.Secondary };

        VisualStateManager.GoToState(first, "Pressed");

        first.Opacity.Should().BeLessThan(1);
        second.Opacity.Should().Be(1);
    }

    private static double Contrast(Color foreground, Color background)
    {
        static double Channel(float value) => value <= 0.04045 ? value / 12.92 : Math.Pow((value + 0.055) / 1.055, 2.4);
        static double Luminance(Color color) => 0.2126 * Channel(color.Red) + 0.7152 * Channel(color.Green) + 0.0722 * Channel(color.Blue);
        var first = Luminance(foreground);
        var second = Luminance(background);
        return (Math.Max(first, second) + 0.05) / (Math.Min(first, second) + 0.05);
    }
}
