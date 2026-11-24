namespace BibleOnSite.Helpers;

/// <summary>
/// The gesture timing every scripture reader shares: the scroll cooldown that
/// suppresses long-press arming while a scroll is in flight, the held-pointer
/// duration that qualifies as a long press, and the debounce that keeps the
/// release's tap from undoing the selection that press just made.
/// </summary>
public sealed class ReaderGestureTiming
{
    /// <summary>How long a held pointer counts as a long press.</summary>
    public static int LongPressDurationMs { get; } = 600;
    private const int ScrollCooldownMs = 500; // Don't allow long-press within 500ms of scroll
    private const int LongPressDebounceMs = 300; // A long press swallows the tap its release raises

    private DateTime _lastScrollTime = DateTime.MinValue;
    private DateTime _lastLongPressTime = DateTime.MinValue;

    /// <summary>
    /// True while the user is scrolling or just finished — suppresses
    /// long-press arming and the recitation follow scroll.
    /// </summary>
    public bool IsScrolling => (Now() - _lastScrollTime).TotalMilliseconds < ScrollCooldownMs;

    /// <summary>
    /// True while a just-fired long press still swallows the tap its release
    /// raises, so the tap cannot toggle the selection back off.
    /// </summary>
    public bool IsLongPressDebounced => (Now() - _lastLongPressTime).TotalMilliseconds < LongPressDebounceMs;

    /// <summary>Marks the last scroll event on the reading surface.</summary>
    public void NoteScroll() => _lastScrollTime = Now();

    /// <summary>Marks a fired long press.</summary>
    public void NoteLongPress() => _lastLongPressTime = Now();

    // Seam like ReaderScrollTop.AnimateScroll: tests drive the clock directly.
    internal static Func<DateTime> Now { get; set; } = () => DateTime.Now;
}
