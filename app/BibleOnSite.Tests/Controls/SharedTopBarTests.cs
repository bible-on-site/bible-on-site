using BibleOnSite.Controls;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// Toolbar parity guard for #2061: רבנים must render the identical top bar as
/// על הפרק. Both pages build their chrome from <see cref="SharedTopBar"/> and
/// <see cref="ToolbarPill"/>, so these tests pin the shared geometry and colors.
/// </summary>
public class SharedTopBarTests
{
    [Fact]
    public void SharedTopBar_HasReaderBandGeometry()
    {
        var bar = new SharedTopBar();

        var container = bar.Content.Should().BeOfType<Grid>().Subject;
        container.MinimumHeightRequest.Should().Be(56);

        var band = container.Children.OfType<Grid>().Single();
        band.HeightRequest.Should().Be(56);
        band.ColumnDefinitions.Select(column => column.Width.Value)
            .Should().Equal(48, GridLength.Star.Value, 48);

        var separator = container.Children.OfType<BoxView>().Single();
        separator.HeightRequest.Should().Be(1);
        separator.VerticalOptions.Should().Be(LayoutOptions.End);
    }

    [Fact]
    public void SharedTopBar_HamburgerMatchesReaderButton()
    {
        var bar = new SharedTopBar();

        bar.NavigationButton.Text.Should().Be(Fonts.FluentUI.navigation_24_regular);
        bar.NavigationButton.FontFamily.Should().Be("FluentIcons");
        bar.NavigationButton.FontSize.Should().Be(24);
        bar.NavigationButton.WidthRequest.Should().Be(48);
        bar.NavigationButton.BackgroundColor.Should().Be(Colors.Transparent);
        SemanticProperties.GetDescription(bar.NavigationButton)
            .Should().Be("פתיחת תפריט הניווט");
    }

    [Fact]
    public void SharedTopBar_CenterAndTrailingContent_RoundTrip()
    {
        var bar = new SharedTopBar();
        var center = new Label { Text = "center" };
        var trailing = new Label { Text = "trailing" };

        bar.CenterContent = center;
        bar.TrailingContent = trailing;

        bar.CenterContent.Should().BeSameAs(center);
        bar.TrailingContent.Should().BeSameAs(trailing);
    }

    [Fact]
    public void SharedTopBar_BarVisibleHidesControlsButKeepsSeparator()
    {
        var bar = new SharedTopBar();
        var container = (Grid)bar.Content!;
        var separator = container.Children.OfType<BoxView>().Single();

        bar.BarVisible = false;

        container.Children.OfType<Grid>().Single().IsVisible.Should().BeFalse();
        separator.IsVisible.Should().BeTrue("the reader keeps the hairline under the search overlay");
        bar.BarVisible = true;
        container.Children.OfType<Grid>().Single().IsVisible.Should().BeTrue();
    }

    [Fact]
    public void SharedTopBar_NavigationAutomationId_AppliesToHamburger()
    {
        var bar = new SharedTopBar { NavigationAutomationId = "AuthorsNavigationButton" };

        bar.NavigationButton.AutomationId.Should().Be("AuthorsNavigationButton");
    }

    [Fact]
    public void SharedTopBar_NavigationInterceptor_RunsBeforeFlyout()
    {
        var bar = new SharedTopBar();
        var calls = 0;
        bar.NavigationInterceptor = () => { calls++; return true; };

        // An interceptor that handles the tap suppresses the flyout entirely,
        // so it is the only side effect the click can have here.
        bar.NavigationButton.SendClicked();

        calls.Should().Be(1);
    }

    [Fact]
    public void SharedTopBar_NavigationInterceptor_PassThroughStillConsulted()
    {
        var bar = new SharedTopBar();
        var calls = 0;
        bar.NavigationInterceptor = () => { calls++; return false; };

        // Outside a Shell (unit test context) the flyout open is a no-op, but
        // the interceptor must still be consulted for every tap.
        bar.NavigationButton.SendClicked();

        calls.Should().Be(1);
    }

    [Fact]
    public void ToolbarPill_MatchesReaderPillChrome()
    {
        var pill = new ToolbarPill();

        pill.HeightRequest.Should().Be(40);
        pill.Padding.Should().Be(new Thickness(12, 0));
        pill.Margin.Should().Be(new Thickness(4, 0));
        pill.VerticalOptions.Should().Be(LayoutOptions.Center);
        pill.StrokeShape.Should().BeOfType<Microsoft.Maui.Controls.Shapes.RoundRectangle>()
            .Which.CornerRadius.Should().Be(new CornerRadius(14));
        pill.BackgroundColor.Should().Be(ToolbarPill.LightColor);
    }
}
