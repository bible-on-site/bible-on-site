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
}
