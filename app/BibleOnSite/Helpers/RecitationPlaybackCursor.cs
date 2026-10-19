namespace BibleOnSite.Helpers;

/// <summary>
/// The shared recitation playback cursor: which clip is playing, whether it is
/// the unbounded chapter stream, and the perek-scoped bookmark a tapped word or
/// pasuk leaves for the next continuous Play (#2157). Pausing never touches the
/// bookmark — it lives on the player position itself; only a completed chapter
/// consumes it and perek/page changes drop it.
/// </summary>
public sealed class RecitationPlaybackCursor
{
    /// <summary>The in-flight playback identity ("chapter:", "verses:", "pasuk:", "word:"), or null.</summary>
    public string? PlayingKey { get; private set; }

    /// <summary>Whether <see cref="PlayingKey"/> is the unbounded chapter stream.</summary>
    public bool PlayingContinuous { get; private set; }

    /// <summary>Where the next continuous playback resumes, in recording milliseconds.</summary>
    public (int PerekId, double StartMs)? ResumePosition { get; private set; }

    /// <summary>
    /// Playback the recitation controls themselves issued — the chapter, a verses
    /// range, or a pasuk preview — pauses and resumes through the shared toggle.
    /// A tapped-word preview is a bookmark, not the bar's playback (#2157): Play
    /// during one starts continuous playback at that word instead of pausing it.
    /// </summary>
    public bool BarIssued =>
        PlayingKey != null && !PlayingKey.StartsWith("word:", StringComparison.Ordinal);

    /// <summary>Whether a bookmark for this perek waits for the next continuous Play.</summary>
    public bool HasBookmarkFor(int perekId) =>
        ResumePosition is { } point && point.PerekId == perekId;

    /// <summary>Marks the new playback identity once its clip is prepared.</summary>
    public void Begin(string key, bool continuous)
    {
        PlayingKey = key;
        PlayingContinuous = continuous;
    }

    /// <summary>A tapped word or pasuk bookmarks where continuous playback resumes.</summary>
    public void MarkResume(int perekId, double sourceMs) => ResumePosition = (perekId, sourceMs);

    /// <summary>Maps the bookmark into this clip's position for the pending seek.</summary>
    public double? PendingSeekFor(int perekId, bool continuous, RecitationTimeline? timeline) =>
        continuous && ResumePosition is { } point && point.PerekId == perekId
            ? timeline?.PositionOf(point.StartMs)
            : null;

    /// <summary>Natural end: only a completed chapter consumes the bookmark.</summary>
    public void End()
    {
        if (PlayingContinuous)
        {
            ResumePosition = null;
        }

        PlayingKey = null;
        PlayingContinuous = false;
    }

    /// <summary>Explicit stop or source replacement keeps the bookmark.</summary>
    public void Stop()
    {
        PlayingKey = null;
        PlayingContinuous = false;
    }

    /// <summary>Perek and page changes drop the bookmark together with playback.</summary>
    public void Reset()
    {
        Stop();
        ResumePosition = null;
    }
}
