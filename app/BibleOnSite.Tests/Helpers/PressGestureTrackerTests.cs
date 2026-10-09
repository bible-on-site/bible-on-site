using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class PressGestureTrackerTests
{
    [Theory]
    [InlineData(800)]
    [InlineData(100)]
    public void HorizontalSwipe_DoesNotSelectPasukAtItsEnd(double endX)
    {
        var press = new PressGestureTracker();
        var selected = false;
        press.Begin(400, 900, 12);
        press.Move(endX, 900, isScrolling: false);

        // Horizontal carousel motion never raises the inner list's Scrolled event.
        press.DispatchLongPress(press.PressId, callback => callback(), () => selected = true, () => false);

        selected.Should().BeFalse();
        press.End().Should().BeFalse();
    }

    [Fact]
    public void LaggedCallback_AfterSwipeAndChapterChange_DoesNotSelectInNewChapter()
    {
        var press = new PressGestureTracker();
        Action? queued = null;
        var selectedChapter = 0;
        var chapter = 1;
        press.Begin(400, 900, 12);
        press.DispatchLongPress(press.PressId, callback => queued = callback, () => selectedChapter = chapter, () => false);

        // While the UI is busy, the touch is cancelled and the carousel rebinds.
        press.Abort();
        chapter = 2;
        queued.Should().NotBeNull();
        queued!();

        selectedChapter.Should().Be(0);
    }

    [Fact]
    public void LaggedCallback_AfterMovementInSameChapter_DoesNotEnterSelectionMode()
    {
        var press = new PressGestureTracker();
        Action? queued = null;
        var selected = false;
        press.Begin(400, 900, 12);
        press.DispatchLongPress(press.PressId, callback => queued = callback, () => selected = true, () => false);
        press.Move(700, 900, isScrolling: false);
        queued!();

        selected.Should().BeFalse();
    }

    [Fact]
    public void VerticalScroll_DoesNotBecomeSelectionTapOnRelease()
    {
        var press = new PressGestureTracker();
        press.Begin(400, 900, 12);
        press.Move(400, 500, isScrolling: true);

        press.End().Should().BeFalse();
    }

    [Fact]
    public void StationaryLongPress_SelectsOnceAndDoesNotTapOnRelease()
    {
        var press = new PressGestureTracker();
        var selections = 0;
        press.Begin(400, 900, 12);
        press.DispatchLongPress(press.PressId, callback => callback(), () => selections++, () => false);

        selections.Should().Be(1);
        press.End().Should().BeFalse();
    }

    [Fact]
    public void StationaryShortTap_CanToggleAnExistingSelection()
    {
        var press = new PressGestureTracker();
        press.Begin(400, 900, 12);

        press.End().Should().BeTrue();
    }

    [Theory]
    [InlineData(410, 905)]
    [InlineData(400, 912)]
    public void MovementWithinTouchSlop_StillAllowsLongPress(double x, double y)
    {
        var press = new PressGestureTracker();
        var selected = false;
        press.Begin(400, 900, 12);
        press.Move(x, y, isScrolling: false);
        press.DispatchLongPress(press.PressId, callback => callback(), () => selected = true, () => false);

        selected.Should().BeTrue();
    }

    [Fact]
    public void MovementOutAndBack_CannotBecomeTap()
    {
        var press = new PressGestureTracker();
        press.Begin(400, 900, 12);
        press.Move(600, 900, isScrolling: false);
        press.Move(400, 900, isScrolling: false);

        press.End().Should().BeFalse();
    }

    [Fact]
    public void OldTimerExpiredDuringNewPress_CannotSelectNewVerse()
    {
        var press = new PressGestureTracker();
        var selected = false;
        press.Begin(400, 900, 12);
        var oldPress = press.PressId;
        press.End();
        press.Begin(400, 1000, 12);
        press.DispatchLongPress(oldPress, callback => callback(), () => selected = true, () => false);

        selected.Should().BeFalse();
        press.End().Should().BeTrue();
    }

    [Fact]
    public void CallbackQueuedBeforeRelease_CannotSelectAfterRelease()
    {
        var press = new PressGestureTracker();
        var selected = false;
        Action? queued = null;
        press.Begin(400, 900, 12);
        press.DispatchLongPress(press.PressId, callback => queued = callback, () => selected = true, () => false);
        press.End();
        queued!();

        selected.Should().BeFalse();
    }

    [Fact]
    public void ScrollingBeginsBeforeQueuedCallback_DoesNotSelect()
    {
        var press = new PressGestureTracker();
        var selected = false;
        var scrolling = false;
        Action? queued = null;
        press.Begin(400, 900, 12);
        press.DispatchLongPress(press.PressId, callback => queued = callback, () => selected = true, () => scrolling);
        scrolling = true;
        queued!();

        selected.Should().BeFalse();
    }

    [Fact]
    public void RepeatedTimerCallback_SelectsOnlyOnce()
    {
        var press = new PressGestureTracker();
        var selections = 0;
        press.Begin(400, 900, 12);
        var pressId = press.PressId;
        press.DispatchLongPress(pressId, callback => callback(), () => selections++, () => false);
        press.DispatchLongPress(pressId, callback => callback(), () => selections++, () => false);

        selections.Should().Be(1);
    }

    [Fact]
    public void CancelledTouch_DoesNotTapOrLongPress()
    {
        var press = new PressGestureTracker();
        var selected = false;
        press.Begin(400, 900, 12);
        press.Abort();
        press.DispatchLongPress(press.PressId, callback => callback(), () => selected = true, () => false);

        selected.Should().BeFalse();
        press.End().Should().BeFalse();
    }
}
