using BibleOnSite.Controls;
using FluentAssertions;

namespace BibleOnSite.Tests.Controls;

public class CircularMenuTests
{
    [Fact]
    public void Constructor_SetsDefaultPropertyValues()
    {
        var menu = new CircularMenu();

        menu.Radius.Should().Be(80);
        menu.ToggleButtonSize.Should().Be(56);
        menu.ToggleButtonColor.Should().Be(Colors.Blue);
    }

    [Fact]
    public void IsExpanded_StartsFalse()
    {
        var menu = new CircularMenu();

        menu.IsExpanded.Should().BeFalse();
    }

    [Fact]
    public void Close_WhenAlreadyClosed_DoesNothing()
    {
        var menu = new CircularMenu();

        menu.Close();

        menu.IsExpanded.Should().BeFalse();
    }

    [Fact]
    public void CircularMenuItem_Constructor_SetsDefaultBindableValues()
    {
        var item = new CircularMenuItem();

        item.Icon.Should().Be("●");
        item.ItemColor.Should().Be(Colors.Blue);
        item.IconColor.Should().Be(Colors.White);
        item.ItemSize.Should().Be(48);
    }

    [Fact]
    public void CircularMenuItem_Tapped_CanBeSubscribed()
    {
        var item = new CircularMenuItem();

        FluentActions.Invoking(() => item.Tapped += (_, _) => { }).Should().NotThrow();
    }

    [Fact]
    public void CircularMenuItem_SetIcon_UpdatesProperty()
    {
        var item = new CircularMenuItem();

        item.Icon = "★";

        item.Icon.Should().Be("★");
    }

    [Fact]
    public void CircularMenuItem_SetItemColor_UpdatesBackgroundColor()
    {
        var item = new CircularMenuItem();

        item.ItemColor = Colors.Red;

        item.ItemColor.Should().Be(Colors.Red);
        item.BackgroundColor.Should().Be(Colors.Red);
    }

    [Fact]
    public void CircularMenuItem_SetIconColor_UpdatesProperty()
    {
        var item = new CircularMenuItem();

        item.IconColor = Colors.Yellow;

        item.IconColor.Should().Be(Colors.Yellow);
    }

    [Fact]
    public void CircularMenuItem_SetItemSize_UpdatesWidthAndHeight()
    {
        var item = new CircularMenuItem();

        item.ItemSize = 64;

        item.ItemSize.Should().Be(64);
        item.WidthRequest.Should().Be(64);
        item.HeightRequest.Should().Be(64);
    }

    [Fact]
    public void CircularMenu_SetRadius_UpdatesProperty()
    {
        var menu = new CircularMenu();

        menu.Radius = 120;

        menu.Radius.Should().Be(120);
    }

    [Fact]
    public void CircularMenu_SetToggleButtonSize_UpdatesProperty()
    {
        var menu = new CircularMenu();

        menu.ToggleButtonSize = 72;

        menu.ToggleButtonSize.Should().Be(72);
    }

    [Fact]
    public void CircularMenu_SetToggleButtonColor_UpdatesProperty()
    {
        var menu = new CircularMenu();

        menu.ToggleButtonColor = Colors.Green;

        menu.ToggleButtonColor.Should().Be(Colors.Green);
    }

}
