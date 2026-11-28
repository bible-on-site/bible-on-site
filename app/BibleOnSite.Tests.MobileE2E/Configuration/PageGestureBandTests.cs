using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Pages;
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

    [Fact]
    public void UpDragStartPrefersTheUpperFifth()
    {
        Assert.Equal(240,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [], preferLowerHalf: false));
    }

    [Fact]
    public void UpDragStartStepsAboveAClaimingControl()
    {
        var slider = new Rectangle(0, 220, 540, 80);
        Assert.Equal(219,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [slider], preferLowerHalf: false));
    }

    [Fact]
    public void UpDragStartTurnsDownwardAtTheStatusBarStrip()
    {
        // Stepping above a control beginning inside the status-bar strip would
        // land in it, so the scan turns downward instead.
        var slider = new Rectangle(0, 150, 540, 140);
        Assert.Equal(291,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [slider], preferLowerHalf: false));
    }

    [Fact]
    public void UpDragStartFallsBackToTheUpperFifthWhenEveryPointIsClaimed()
    {
        var everything = new Rectangle(0, 0, 540, 1200);
        Assert.Equal(240,
            AndroidPlatformAdapter.ChooseDragStartClearOfControls(270, 1200, [everything], preferLowerHalf: false));
    }

    [Fact]
    public void SeekKeepsScrollingDownWhileThePageMoves() =>
        Assert.True(PerekPage.SeekScrollsDown(true, "before", "after"));

    [Fact]
    public void SeekReversesWhenAScrollLeavesThePageUntouched()
    {
        Assert.False(PerekPage.SeekScrollsDown(true, "same", "same"));
        Assert.True(PerekPage.SeekScrollsDown(false, "same", "same"));
    }

    [Fact]
    public void SeekKeepsDirectionOnTheFirstObservation() =>
        Assert.True(PerekPage.SeekScrollsDown(true, null, "surface"));

    // Run 46019602214: the seek parked at the page's bottom edge scrolled down
    // on all 12 attempts because raw page sources never compared equal — a
    // bounce read shifts bounds and a11y flags even when nothing moved. The
    // signature ignores geometry, so the reversal still fires.
    [Fact]
    public void SurfaceSignatureIgnoresGeometryAndStateFlags()
    {
        var first = """
            <node resource-id="id/Scroll" bounds="[0,0][540,960]" focused="false">
              <node resource-id="id/Row" bounds="[0,10][540,90]" text="א" />
            </node>
            """;
        var bounced = """
            <node resource-id="id/Scroll" bounds="[0,32][540,992]" focused="true">
              <node resource-id="id/Row" bounds="[0,42][540,122]" text="א" />
            </node>
            """;
        Assert.Equal(PerekPage.ScrollSurfaceSignature(first),
            PerekPage.ScrollSurfaceSignature(bounced));
        Assert.False(PerekPage.SeekScrollsDown(true,
            PerekPage.ScrollSurfaceSignature(first),
            PerekPage.ScrollSurfaceSignature(bounced)));
    }

    [Fact]
    public void SurfaceSignatureChangesWhenAScrollMovedContent()
    {
        var before = """
            <node resource-id="id/Row1" bounds="[0,0][540,80]" text="א" />
            <node resource-id="id/Row2" bounds="[0,80][540,160]" text="ב" />
            """;
        var after = """
            <node resource-id="id/Row2" bounds="[0,0][540,80]" text="ב" />
            <node resource-id="id/Row3" bounds="[0,80][540,160]" text="ג" />
            """;
        Assert.NotEqual(PerekPage.ScrollSurfaceSignature(before),
            PerekPage.ScrollSurfaceSignature(after));
        Assert.True(PerekPage.SeekScrollsDown(true,
            PerekPage.ScrollSurfaceSignature(before),
            PerekPage.ScrollSurfaceSignature(after)));
    }

    // WebDriverAgent sources identify nodes by type/name/label, not
    // resource-id/text — an Android-only signature reads empty on iOS and
    // reverses the seek after every drag.
    [Fact]
    public void SurfaceSignatureTracksIosNodeIdentities()
    {
        var before = """
            <XCUIElementTypeCell name="Row1" label="א" x="0" y="0" width="540" height="80" visible="true" />
            <XCUIElementTypeCell name="Row2" label="ב" x="0" y="80" width="540" height="80" visible="true" />
            """;
        var after = """
            <XCUIElementTypeCell name="Row2" label="ב" x="0" y="0" width="540" height="80" visible="true" />
            <XCUIElementTypeCell name="Row3" label="ג" x="0" y="80" width="540" height="80" visible="true" />
            """;
        Assert.NotEqual(string.Empty, PerekPage.ScrollSurfaceSignature(before));
        Assert.NotEqual(PerekPage.ScrollSurfaceSignature(before),
            PerekPage.ScrollSurfaceSignature(after));
    }

    [Fact]
    public void ScrollBoundsClipsTheSurfaceToTheBand()
    {
        var band = MobilePlatformAdapter.PageGestureBand(new Size(540, 1200));
        var surface = new Rectangle(0, 0, 540, 1200);
        Assert.Equal(band, IosPlatformAdapter.ChooseScrollBounds(band, surface));
        // A surface spilling past the band's lower edge scrolls only the
        // overlap: intersect, not the whole surface and not the whole band.
        var spilling = new Rectangle(0, 600, 540, 900);
        Assert.Equal(Rectangle.Intersect(band, spilling),
            IosPlatformAdapter.ChooseScrollBounds(band, spilling));
    }

    [Fact]
    public void ScrollBoundsFallsBackToTheBandForAnOffBandSurface()
    {
        var band = MobilePlatformAdapter.PageGestureBand(new Size(540, 1200));
        // Above the band entirely: Intersect yields an empty rectangle and the
        // drag must not collapse to a press at one point.
        var offBand = new Rectangle(0, 0, 540, 100);
        Assert.Equal(band, IosPlatformAdapter.ChooseScrollBounds(band, offBand));
        Assert.Equal(band, IosPlatformAdapter.ChooseScrollBounds(band, null));
    }
}
