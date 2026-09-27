namespace BibleOnSite.Helpers;

/// <summary>
/// Tracks a verse press independently of native views and timer scheduling.
/// A drag permanently cancels selection for that touch, and callbacks belong
/// only to the press that scheduled them.
/// </summary>
public sealed class PressGestureTracker
{
    private double _startX;
    private double _startY;
    private double _touchSlop;

    public int PressId { get; private set; }
    public bool IsPressed { get; private set; }
    public bool TouchActive { get; private set; }
    public bool LongPressFired { get; private set; }

    public void Begin(double x, double y, double touchSlop)
    {
        PressId++;
        _startX = x;
        _startY = y;
        _touchSlop = touchSlop;
        TouchActive = true;
        IsPressed = true;
        LongPressFired = false;
    }

    public void Move(double x, double y, bool isScrolling)
    {
        if (TouchActive && (isScrolling ||
            Math.Abs(x - _startX) > _touchSlop || Math.Abs(y - _startY) > _touchSlop))
        {
            Cancel();
        }
    }

    public void Cancel()
    {
        PressId++;
        IsPressed = false;
        TouchActive = false;
    }

    public void Abort() => Cancel();

    public bool End()
    {
        var tapped = TouchActive && !LongPressFired;
        Cancel();
        return tapped;
    }

    public void DispatchLongPress(int pressId, Action<Action> dispatch, Action fire, Func<bool> isScrolling)
    {
        // Always validate on the UI thread. A timer can expire while input,
        // cancellation or a recycled view's new binding is waiting in its queue.
        dispatch(() =>
        {
            if (pressId != PressId || !IsPressed || !TouchActive || LongPressFired || isScrolling())
            {
                return;
            }

            LongPressFired = true;
            fire();
        });
    }
}
