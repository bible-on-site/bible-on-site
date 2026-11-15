using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class PageGestureBandTests
{
    [Fact]
    public void BandStaysClearOfTheSystemGestureStrips()
    {
        var band = MobilePlatformAdapter.PageGestureBand(new Size(540, 1200));
        Assert.Equal(0, band.Left);
        Assert.Equal(540, band.Width);
        // Below the status-bar shade strip, above the gesture-pill strip: a
        // swipe starting inside this band reaches the page rather than being
        // claimed by Android as Home/Overview.
        Assert.True(band.Top >= 1200 / 5);
        Assert.True(band.Bottom <= 1200 * 4 / 5);
    }

    [Fact]
    public void DragStartPrefersTheLowerFifth()
    {
        Assert.Equal(960,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, []));
    }

    [Fact]
    public void DragStartIgnoresControlsOffTheDragLine()
    {
        var aside = new Rectangle(0, 900, 100, 200);
        Assert.Equal(960,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [aside]));
    }

    [Fact]
    public void DragStartStepsBelowAClaimingControl()
    {
        var slider = new Rectangle(0, 900, 540, 80);
        Assert.Equal(981,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [slider]));
    }

    [Fact]
    public void DragStartTurnsUpwardWhenTheEscapeWouldEnterTheStrip()
    {
        // Stepping below a slider ending past the strip boundary would land
        // inside it, so the scan turns upward instead.
        var slider = new Rectangle(0, 900, 540, 140);
        Assert.Equal(899,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [slider]));
    }

    [Fact]
    public void DragStartNeverEntersTheGestureNavigationStrip()
    {
        // A bottom-anchored row must not push the start into the strip where
        // the system claims the drag as Home/Overview; the scan turns upward.
        var bottomRow = new Rectangle(0, 940, 540, 260);
        var start = AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [bottomRow]);
        Assert.Equal(939, start);
        Assert.True(start <= 1200 * 17 / 20);
    }

    [Fact]
    public void DragStartFallsBackToTheLowerFifthWhenEveryPointIsClaimed()
    {
        var everything = new Rectangle(0, 0, 540, 1200);
        Assert.Equal(960,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [everything]));
    }
}
