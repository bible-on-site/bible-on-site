using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class ReaderGestureTimingTests : IDisposable
{
    private DateTime _now = new(2026, 1, 1);
    private readonly ReaderGestureTiming _timing = new();

    public ReaderGestureTimingTests() => ReaderGestureTiming.Now = () => _now;

    public void Dispose() => ReaderGestureTiming.Now = () => DateTime.Now;

    private void Advance(double ms) => _now = _now.AddMilliseconds(ms);

    [Fact]
    public void IsScrolling_IsFalseUntilAScroll_HoldsForFiveHundredMs()
    {
        _timing.IsScrolling.Should().BeFalse();
        _timing.NoteScroll();
        _timing.IsScrolling.Should().BeTrue();
        Advance(499);
        _timing.IsScrolling.Should().BeTrue();
        Advance(1);
        _timing.IsScrolling.Should().BeFalse("the cooldown ends exactly 500ms after the last scroll");
    }

    [Fact]
    public void NoteScroll_RefreshesTheCooldown()
    {
        _timing.NoteScroll();
        Advance(400);
        _timing.NoteScroll();
        Advance(400);
        _timing.IsScrolling.Should().BeTrue("each scroll restarts the window");
        Advance(100);
        _timing.IsScrolling.Should().BeFalse();
    }

    [Fact]
    public void IsLongPressDebounced_HoldsForThreeHundredMs()
    {
        _timing.IsLongPressDebounced.Should().BeFalse();
        _timing.NoteLongPress();
        _timing.IsLongPressDebounced.Should().BeTrue();
        Advance(299);
        _timing.IsLongPressDebounced.Should().BeTrue();
        Advance(1);
        _timing.IsLongPressDebounced.Should().BeFalse("the debounce ends exactly 300ms after the press");
    }

    [Fact]
    public void ScrollAndLongPress_KeepIndependentClocks()
    {
        _timing.NoteLongPress();
        _timing.NoteScroll();
        Advance(300);
        _timing.IsLongPressDebounced.Should().BeFalse();
        _timing.IsScrolling.Should().BeTrue();
        Advance(200);
        _timing.IsScrolling.Should().BeFalse();
    }

    [Fact]
    public void LongPressDuration_IsSixHundredMs()
    {
        ReaderGestureTiming.LongPressDurationMs.Should().Be(600);
    }
}
