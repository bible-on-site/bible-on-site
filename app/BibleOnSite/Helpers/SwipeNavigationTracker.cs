namespace BibleOnSite.Helpers;

public readonly record struct TouchPosition(float X, float Y, long EventTime);

/// <summary>
/// Settles a horizontal drag using the original input coordinates and timestamps,
/// even when a busy UI delays native release handling or cancels its fling.
/// </summary>
public sealed class SwipeNavigationTracker
{
    private TouchPosition? _start;
    private int _startPosition;

    public void Begin(TouchPosition start, int position)
    {
        _start = start;
        _startPosition = position;
    }

    public void Cancel() => _start = null;

    public int? End(TouchPosition end, double pageWidth, double touchSlop,
        double minimumFlingVelocity, bool rightToLeft, int pageCount)
    {
        var start = _start;
        Cancel();
        if (start == null || pageWidth <= 0 || pageCount <= 0)
            return null;

        var dx = end.X - start.Value.X;
        var dy = end.Y - start.Value.Y;
        var distance = Math.Abs(dx);
        if (distance <= touchSlop || distance <= Math.Abs(dy) * 1.5)
            return null;

        // EventTime is the finger's timing, not the time the UI eventually
        // processed the input. A delayed fast swipe must still be a fling.
        var duration = Math.Max(1, end.EventTime - start.Value.EventTime);
        var advances = distance >= pageWidth / 2 || distance * 1000 / duration >= minimumFlingVelocity;
        var direction = Math.Sign(dx) * (rightToLeft ? 1 : -1);
        return Math.Clamp(_startPosition + (advances ? direction : 0), 0, pageCount - 1);
    }
}
