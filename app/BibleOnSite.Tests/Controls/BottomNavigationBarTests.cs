using BibleOnSite.Controls;
using FluentAssertions;

namespace BibleOnSite.Tests.Controls;

public class BottomNavigationBarTests
{
    [Fact]
    public void DefaultPropertyValues_AreCorrect()
    {
        var bar = new BottomNavigationBar();

        bar.BarHeight.Should().Be(80);
        bar.NotchRadius.Should().Be(32);
        bar.BarColor.Should().Be(Colors.White);
    }

    [Fact]
    public void LeftContent_SetAndGet_RoundTrips()
    {
        var bar = new BottomNavigationBar();
        var label = new Label { Text = "L" };

        bar.LeftContent = label;

        bar.LeftContent.Should().BeSameAs(label);
    }

    [Fact]
    public void RightContent_SetAndGet_RoundTrips()
    {
        var bar = new BottomNavigationBar();
        var label = new Label { Text = "R" };

        bar.RightContent = label;

        bar.RightContent.Should().BeSameAs(label);
    }

    [Fact]
    public void BarColor_Updates()
    {
        var bar = new BottomNavigationBar();

        bar.BarColor = Colors.Red;

        bar.BarColor.Should().Be(Colors.Red);
    }

    [Fact]
    public void CircularMenu_SetAndGet_RoundTrips()
    {
        var bar = new BottomNavigationBar();
        var menu = new CircularMenu();

        bar.CircularMenu = menu;

        bar.CircularMenu.Should().BeSameAs(menu);
    }

    [Fact]
    public void BottomBarBackground_Constructor_CreatesInstanceWithDefaultBarColorWhite()
    {
        var bg = new BottomBarBackground();

        bg.BarColor.Should().Be(Colors.White);
        bg.Drawable.Should().NotBeNull();
    }
}
