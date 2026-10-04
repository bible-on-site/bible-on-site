namespace BibleOnSite.Helpers;

/// <summary>Two rapid taps must belong to the same chapter and verse.</summary>
public sealed class DoubleTapTracker
{
    private (int Perek, int Pasuk)? _previous;
    private long _time;
    public bool Tap(int perek, int pasuk, long milliseconds)
    {
        var identity = (perek, pasuk);
        var doubled = _previous == identity && milliseconds - _time is >= 0 and <= 350;
        _previous = doubled ? null : identity;
        _time = milliseconds;
        return doubled;
    }
    public void Reset() => _previous = null;
}
