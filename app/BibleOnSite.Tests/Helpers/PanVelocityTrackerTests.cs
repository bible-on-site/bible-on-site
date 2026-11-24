using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The perushim sheet's flick-to-dismiss reads the release velocity. The old
/// computation divided the gesture's cumulative offset by the gap between
/// the last move and the release, so a ~15-20px accidental drag released
/// while still moving reported thousands of px/s and dismissed the sheet.
/// Velocity must describe the motion near the release instant: a real flick
/// exceeds the 800px/s threshold, a small nudge or a paused drag does not.
/// </summary>
public class PanVelocityTrackerTests
{
    private static readonly DateTime T0 = new DateTime(2026, 1, 1, 0, 0, 0);
    private const double FlickThreshold = 800;

    private static PanVelocityTracker Drag(params (double Offset, int AtMs)[] samples)
    {
        var tracker = new PanVelocityTracker();
        tracker.Begin();
        foreach (var (offset, atMs) in samples)
        {
            tracker.Add(offset, T0.AddMilliseconds(atMs));
        }
        return tracker;
    }

    private static DateTime EndAt(int ms) => T0.AddMilliseconds(ms);

    [Fact]
    public void SmallDragReleasedWhileStillMoving_IsNotAFlick()
    {
        // The reported case: ~18px drift with its last move moments before
        // release must read as a slow drag, not a flick.
        var tracker = Drag((4, 0), (9, 25), (14, 55), (18, 85));

        tracker.ReleaseVelocity(EndAt(95))
            .Should().BeLessThan(FlickThreshold,
                "an ~18px accidental drag snaps back instead of dismissing");
    }

    [Fact]
    public void FastDownwardFlick_ExceedsTheDismissThreshold()
    {
        var tracker = Drag((0, 0), (40, 16), (95, 32), (170, 48), (260, 64));

        tracker.ReleaseVelocity(EndAt(72))
            .Should().BeGreaterThan(FlickThreshold,
                "a real flick still dismisses the sheet");
    }

    [Fact]
    public void FastUpwardFlick_ExceedsTheThreshold()
    {
        // The same velocity feeds the drag-up expand path, sign-insensitive.
        var tracker = Drag((0, 0), (-45, 16), (-110, 32), (-210, 48));

        tracker.ReleaseVelocity(EndAt(56))
            .Should().BeGreaterThan(FlickThreshold);
    }

    [Fact]
    public void DragHeldStillThenReleased_IsNotAFlick()
    {
        // A drag that stops moving well before release has no motion inside
        // the trailing window — holding the sheet open must not dismiss it.
        var tracker = Drag((60, 0), (110, 60), (150, 120));

        tracker.ReleaseVelocity(EndAt(120 + PanVelocityTracker.WindowMilliseconds + 150))
            .Should().Be(0);
    }

    [Fact]
    public void ReleaseWithoutEnoughRecentMoves_IsZero()
    {
        var tracker = new PanVelocityTracker();
        tracker.Begin();
        tracker.ReleaseVelocity(T0).Should().Be(0);

        tracker.Add(90, T0);
        tracker.ReleaseVelocity(T0.AddMilliseconds(30)).Should().Be(0);
    }

    [Fact]
    public void LongDrag_KeepsOnlyRecentMotionRelevant()
    {
        // A slow crawl covering a large distance never accumulates into a
        // flick — only the trailing window's displacement counts.
        var tracker = Drag((0, 0), (150, 400), (300, 800), (330, 1000), (345, 1080));

        tracker.ReleaseVelocity(EndAt(1095))
            .Should().BeLessThan(FlickThreshold);
    }

    [Fact]
    public void Begin_ResetsThePreviousGesture()
    {
        var tracker = Drag((0, 0), (200, 16), (400, 32));
        tracker.Begin();
        tracker.Add(5, T0.AddMilliseconds(500));

        tracker.ReleaseVelocity(T0.AddMilliseconds(540)).Should().Be(0);
    }
}
