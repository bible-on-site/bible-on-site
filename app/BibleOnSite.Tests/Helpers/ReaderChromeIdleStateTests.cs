using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class ReaderChromeIdleStateTests
{
    [Fact]
    public void InitialEntryStaysVisibleUntilTheFirstDrag()
    {
        var state = new ReaderChromeIdleState();
        state.Tick(100_000, false).Should().BeTrue();
        state.DragEnded(100_001);
        state.Tick(200_000, false).Should().BeTrue();
        state.HasInteracted.Should().BeFalse();
    }

    [Fact]
    public void LongDragsKeepBothBarsVisibleAndStartTheCooldownAtRelease()
    {
        var state = new ReaderChromeIdleState();
        state.DragStarted(100);
        state.Tick(10_000, false).Should().BeTrue();
        state.IsDragging.Should().BeTrue();
        state.DragEnded(10_000);
        state.Tick(10_000 + ReaderChromeIdleState.CooldownMilliseconds - 1, false).Should().BeTrue();
        state.Tick(10_000 + ReaderChromeIdleState.CooldownMilliseconds, false).Should().BeFalse();
    }

    [Fact]
    public void AnyNewDragImmediatelyRevealsHiddenBars()
    {
        var state = new ReaderChromeIdleState();
        state.DragStarted(0);
        state.DragEnded(100);
        state.Tick(3000, false).Should().BeFalse();
        state.DragStarted(4000);
        state.IsVisible.Should().BeTrue();
        state.Tick(9000, false).Should().BeTrue();
    }

    [Fact]
    public void OpenToolsSelectionAndPlaybackHoldVisibilityAndRenewTheCooldown()
    {
        var state = new ReaderChromeIdleState();
        state.NoteScroll(0);
        state.Tick(3000, false).Should().BeFalse();
        state.Tick(5000, true).Should().BeTrue();
        state.Tick(6000, true).Should().BeTrue();
        state.Tick(6001, false).Should().BeTrue();
        state.Tick(6000 + ReaderChromeIdleState.CooldownMilliseconds, false).Should().BeFalse();
    }

    [Fact]
    public void ScrollActivityRenewsTheIdleDeadlineWithoutDependingOnDirection()
    {
        var state = new ReaderChromeIdleState();
        state.NoteScroll(0);
        state.NoteScroll(1500);
        state.Tick(2000, false).Should().BeTrue();
        state.Tick(1500 + ReaderChromeIdleState.CooldownMilliseconds, false).Should().BeFalse();
    }

    [Fact]
    public void ReturningToThePageResetsToTheInitialVisibleState()
    {
        var state = new ReaderChromeIdleState();
        state.DragStarted(0);
        state.DragEnded(10);
        state.Tick(5000, false);
        state.Reset();
        state.IsVisible.Should().BeTrue();
        state.IsDragging.Should().BeFalse();
        state.HasInteracted.Should().BeFalse();
        state.Tick(100_000, false).Should().BeTrue();
    }
}
