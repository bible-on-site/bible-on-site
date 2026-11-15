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
    private bool _horizontal;
    private bool _vertical;
    private bool _dragging;
    private TouchPosition? _last;

    /// <summary>Last finger position observed while the gesture was active.</summary>
    public TouchPosition? Last => _last;
    public bool IsDragging => _start is not null && _dragging;

    /// <summary>Content motion from the current physical drag, before native scrolling or layout.</summary>
    public double? VerticalContentDelta { get; private set; }

    public void Begin(TouchPosition start, int position)
    {
        _start = start;
        _startPosition = position;
        _horizontal = false;
        _vertical = false;
        _dragging = false;
        VerticalContentDelta = null;
        _last = start;
    }

    /// <summary>
    /// Tracks the drag so a horizontal swipe that later turns vertical is still
    /// settled horizontally (#2469). Once horizontal displacement dominates the
    /// gesture beyond touch slop, the swipe is locked to the chapter axis.
    /// </summary>
    public void Move(TouchPosition position, double touchSlop)
    {
        VerticalContentDelta = null;
        if (_start == null)
        {
            return;
        }

        var previous = _last ?? _start.Value;
        var dx = Math.Abs(position.X - _start.Value.X);
        var dy = Math.Abs(position.Y - _start.Value.Y);
        _dragging |= dx > touchSlop || dy > touchSlop;
        if (dx > touchSlop && dx > dy)
        {
            _horizontal = true;
        }
        if (dy > touchSlop && dy > dx * 1.5)
        {
            _vertical = true;
        }
        if (_vertical && !_horizontal)
        {
            VerticalContentDelta = previous.Y - position.Y;
        }
        _last = position;
    }

    public void Cancel()
    {
        _start = null;
        VerticalContentDelta = null;
    }

    /// <summary>Finger-down motion that moves content toward its beginning.</summary>
    public bool IsUpwardContentDrag(double touchSlop) =>
        !_horizontal && _start is { } start && _last is { } last &&
        last.Y - start.Y > touchSlop && last.Y - start.Y > Math.Abs(last.X - start.X) * 1.5;

    public int? End(TouchPosition release, double pageWidth, double touchSlop,
        double minimumFlingVelocity, bool rightToLeft, int pageCount)
    {
        var start = _start;
        var horizontal = _horizontal;
        Cancel();
        if (start == null || pageWidth <= 0 || pageCount <= 0)
        {
            return null;
        }

        var dx = release.X - start.Value.X;
        var dy = release.Y - start.Value.Y;
        var distance = Math.Abs(dx);
        // Without a horizontal lock the release still has to prove horizontal
        // intent; a primarily-vertical drag stays a content scroll.
        if (distance <= touchSlop || (!horizontal && distance <= Math.Abs(dy) * 1.5))
        {
            // A locked horizontal swipe still returns the current page so the
            // caller snaps a possibly-stranded carousel back instead of
            // leaving a residual offset (#2469).
            return horizontal ? _startPosition : null;
        }

        // EventTime is the finger's timing, not the time the UI eventually
        // processed the input. A delayed fast swipe must still be a fling.
        var duration = Math.Max(1, release.EventTime - start.Value.EventTime);
        var advances = distance >= pageWidth / 2 || distance * 1000 / duration >= minimumFlingVelocity;
        var direction = Math.Sign(dx) * (rightToLeft ? 1 : -1);
        return Math.Clamp(_startPosition + (advances ? direction : 0), 0, pageCount - 1);
    }
}
