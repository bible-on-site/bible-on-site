namespace BibleOnSite.Helpers;

/// <summary>Reading starts with controls visible; a drag arms idle hiding after release.</summary>
public sealed class ReaderChromeIdleState
{
    public static long CooldownMilliseconds => 1800;
    public bool IsVisible { get; private set; } = true;
    public bool IsDragging { get; private set; }
    public bool HasInteracted { get; private set; }
    private long _lastActivity;

    public void Reset()
    {
        IsVisible = true;
        IsDragging = HasInteracted = false;
        _lastActivity = 0;
    }

    public void Reveal(long now)
    {
        IsVisible = true;
        _lastActivity = now;
    }

    public void DragStarted(long now)
    {
        HasInteracted = IsDragging = true;
        Reveal(now);
    }

    public void DragEnded(long now)
    {
        if (!IsDragging) { return; }
        IsDragging = false;
        _lastActivity = now;
    }

    public void NoteScroll(long now)
    {
        HasInteracted = true;
        Reveal(now);
    }

    public bool Tick(long now, bool keepVisible)
    {
        if (keepVisible) { Reveal(now); }
        else if (HasInteracted && !IsDragging && now - _lastActivity >= CooldownMilliseconds)
        {
            IsVisible = false;
        }
        return IsVisible;
    }
}
