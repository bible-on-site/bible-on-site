using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>Gesture sequences that cross chapter navigation, scrolling, and selection.</summary>
public class GestureInteractionTests
{
    [Fact]
    public void VerticalScrollCancelsOnlyItsOwnPress_AndNextHoldCanSelect()
    {
        var press = new PressGestureTracker();
        var selections = 0;
        press.Begin(500, 1500, 20);
        press.Move(500, 900, isScrolling: true);
        press.End().Should().BeFalse();

        press.Begin(500, 1200, 20);
        press.DispatchLongPress(press.PressId, callback => callback(),
            () => selections++, () => false);

        selections.Should().Be(1);
        press.End().Should().BeFalse();
    }

    [Fact]
    public void FastSwipeCannotSelectAtRelease_AndNewChapterHoldStillWorks()
    {
        var press = new PressGestureTracker();
        var swipe = new SwipeNavigationTracker();
        var selectedChapter = 0;
        var chapter = 20;
        Action? staleSelection = null;
        press.Begin(850, 1100, 20);
        swipe.Begin(new(850, 1100, 1000), 19);
        press.DispatchLongPress(press.PressId, callback => staleSelection = callback,
            () => selectedChapter = chapter, () => false);

        press.Move(200, 1100, isScrolling: false);
        press.End().Should().BeFalse();
        swipe.End(new(200, 1100, 1100), 1080, 20, 150, true, 929).Should().Be(18);
        chapter = 19;
        staleSelection!();
        selectedChapter.Should().Be(0);

        press.Begin(500, 1100, 20);
        press.DispatchLongPress(press.PressId, callback => callback(),
            () => selectedChapter = chapter, () => false);
        selectedChapter.Should().Be(19);
    }

    [Fact]
    public void DiagonalVerseScrollDoesNotNavigateTapOrSelect()
    {
        var press = new PressGestureTracker();
        var swipe = new SwipeNavigationTracker();
        var selections = 0;
        press.Begin(500, 1700, 20);
        swipe.Begin(new(500, 1700, 1000), 19);
        press.Move(650, 600, isScrolling: true);
        press.DispatchLongPress(press.PressId, callback => callback(),
            () => selections++, () => false);

        swipe.End(new(650, 600, 1400), 1080, 20, 150, true, 929).Should().BeNull();
        press.End().Should().BeFalse();
        selections.Should().Be(0);
    }

    [Fact]
    public void SlowShortHorizontalDragSnapsBackWithoutSelecting()
    {
        var press = new PressGestureTracker();
        var swipe = new SwipeNavigationTracker();
        press.Begin(850, 1100, 20);
        swipe.Begin(new(850, 1100, 1000), 19);
        press.Move(800, 1100, isScrolling: false);

        swipe.End(new(800, 1100, 3000), 1080, 20, 150, true, 929).Should().Be(19);
        press.End().Should().BeFalse();
    }
}
