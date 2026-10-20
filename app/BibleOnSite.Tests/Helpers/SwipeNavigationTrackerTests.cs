using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class SwipeNavigationTrackerTests
{
    [Theory]
    [InlineData(850, 200, true, 18)]
    [InlineData(200, 850, true, 20)]
    [InlineData(850, 200, false, 20)]
    [InlineData(200, 850, false, 18)]
    public void FastSwipe_SettlesOneChapterInItsDirection(float x1, float x2, bool rtl, int expected)
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(x1, 1000, 1000), 19);

        swipe.End(new(x2, 1000, 1100), 1080, 24, 150, rtl, 929).Should().Be(expected);
    }

    [Fact]
    public void LaggedRelease_UsesInputTimeInsteadOfUIProcessingDelay()
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        // A short fast fling delivered after a stall still advances one chapter.
        swipe.End(new(700, 1000, 1100), 1080, 24, 150, true, 929).Should().Be(18);
    }

    [Fact]
    public void ShortSlowDrag_SnapsBackToOriginalChapter()
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        swipe.End(new(750, 1000, 3000), 1080, 24, 150, true, 929).Should().Be(19);
    }

    [Fact]
    public void LongSlowDrag_AdvancesOneChapter()
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        swipe.End(new(200, 1000, 10000), 1080, 24, 150, true, 929).Should().Be(18);
    }

    [Theory]
    [InlineData(860, 1000)]
    [InlineData(900, 500)]
    [InlineData(1000, 850)]
    public void TapOrPrimarilyVerticalDrag_DoesNotNavigate(float x, float y)
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        swipe.End(new(x, y, 1100), 1080, 24, 150, true, 929).Should().BeNull();
    }

    [Fact]
    public void CancelledOrAlreadyReleasedGesture_DoesNotNavigate()
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        swipe.Cancel();
        swipe.End(new(200, 1000, 1100), 1080, 24, 150, true, 929).Should().BeNull();
        swipe.Begin(new(850, 1000, 1000), 19);
        swipe.End(new(200, 1000, 1100), 1080, 24, 150, true, 929).Should().Be(18);
        swipe.End(new(200, 1000, 1100), 1080, 24, 150, true, 929).Should().BeNull();
    }

    [Theory]
    [InlineData(0, 850, 200, 0)]
    [InlineData(928, 200, 850, 928)]
    public void SwipeAtBoundary_StaysInsideTanah(int start, float x1, float x2, int expected)
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(x1, 1000, 1000), start);
        swipe.End(new(x2, 1000, 1100), 1080, 24, 150, true, 929).Should().Be(expected);
    }

    // #2469: one continuous down -> horizontal drag -> vertical turn -> release.
    // Once the carousel has recognized the horizontal swipe, a later vertical
    // component must not make the release look "primarily vertical" and skip
    // the settle that un-sticks the CarouselView.
    [Theory]
    [InlineData(300, 18)] // still past the half-width threshold horizontally
    [InlineData(600, 19)] // finger came back before lifting: snap to current
    public void HorizontalDragThenVerticalTurn_StillSettlesHorizontally(float releaseX, int expected)
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        // Horizontal leg: clearly horizontal-dominant, beyond touch slop.
        swipe.Move(new(600, 1010, 1600), 24);
        // Vertical leg: finger turns up while staying down (reversed-L shape).
        swipe.Move(new(620, 700, 2200), 24);
        swipe.Move(new(releaseX, 400, 3000), 24);

        swipe.End(new(releaseX, 380, 3100), 1080, 24, 150, true, 929).Should().Be(expected);
    }

    [Fact]
    public void HorizontalLock_SettlesOnCancelUsingLastPosition()
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        swipe.Move(new(500, 1010, 1600), 24);
        swipe.Move(new(500, 500, 2200), 24);

        // A native cancel/interruption mid-gesture must settle too, using the
        // last observed finger position.
        swipe.End(swipe.Last ?? new(0, 0, 0), 1080, 24, 150, true, 929).Should().Be(18);
    }

    [Fact]
    public void VerticalScrollWithoutHorizontalLock_StillDoesNotNavigate()
    {
        var swipe = new SwipeNavigationTracker();
        swipe.Begin(new(850, 1000, 1000), 19);
        swipe.Move(new(855, 800, 1300), 24);
        swipe.Move(new(860, 500, 1600), 24);
        swipe.End(new(860, 300, 1800), 1080, 24, 150, true, 929).Should().BeNull();
    }
}
