namespace BibleOnSite.Helpers;

/// <summary>
/// Release velocity of a pan gesture, measured over a trailing window of
/// recent move samples. MAUI's <c>PanUpdatedEventArgs</c> exposes only the
/// cumulative offset and no velocity, so the handler records each move's
/// offset and timestamp and asks for the speed near the release instant.
/// A paused drag reports ~0 instead of its pre-pause speed, and a short
/// nudge never reaches flick speed no matter how soon the release follows
/// the last move.
/// </summary>
public sealed class PanVelocityTracker
{
    /// <summary>
    /// How far back from the release instant movement still counts —
    /// the window Android's VelocityTracker uses for flick detection.
    /// </summary>
    public static int WindowMilliseconds => 100;

    private readonly List<(double Offset, DateTime Time)> _samples = new();

    /// <summary>Starts a new gesture; drops the previous gesture's samples.</summary>
    public void Begin() => _samples.Clear();

    /// <summary>Records the gesture's cumulative offset at a move event.</summary>
    public void Add(double offset, DateTime time)
    {
        _samples.Add((offset, time));
        // Keep a little more than the window so a ReleaseVelocity call can
        // still span the full window; bound memory on long drags.
        var cutoff = time.AddMilliseconds(-2 * WindowMilliseconds);
        _samples.RemoveAll(sample => sample.Time < cutoff);
    }

    /// <summary>
    /// Speed in units/second of the motion inside the trailing
    /// <see cref="WindowMilliseconds"/> ending at <paramref name="now"/>.
    /// Returns 0 when the pointer barely moved recently — fewer than two
    /// samples in the window means the drag stalled before release.
    /// </summary>
    public double ReleaseVelocity(DateTime now)
    {
        var cutoff = now.AddMilliseconds(-WindowMilliseconds);
        var first = -1;
        for (var i = 0; i < _samples.Count; i++)
        {
            if (_samples[i].Time >= cutoff)
            {
                first = i;
                break;
            }
        }
        if (first < 0 || _samples.Count - first < 2)
        {
            return 0;
        }

        var displacement = Math.Abs(_samples[^1].Offset - _samples[first].Offset);
        var elapsed = (_samples[^1].Time - _samples[first].Time).TotalMilliseconds;
        return elapsed > 0 ? displacement / (elapsed / 1000.0) : 0;
    }
}
