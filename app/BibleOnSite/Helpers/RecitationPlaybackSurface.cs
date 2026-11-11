using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// One perek-scoped clip inside a playback plan. <see cref="SectionId"/>
/// scopes the clip to a labelled section when a reader can display the same
/// canonical range more than once (מועדים repeated readings): the word→row
/// mapping highlights the occurrence that is actually playing. 0 means the
/// clip is not bound to one section — word/verses previews and single-pass
/// readers leave it unset.
/// </summary>
public sealed record RecitationSegment(int PerekId, IReadOnlyList<Pasuk> Pasukim,
    double? Start, double? End, IReadOnlyList<(double Start, double End)>? Ranges)
{
    public int SectionId { get; init; }
}

/// <summary>
/// The playback states the shared recitation engine reasons about, mapped
/// from whatever platform player backs it (today MediaElement).
/// </summary>
public enum RecitationPlaybackState
{
    None,
    Opening,
    Buffering,
    Playing,
    Paused,
    Stopped,
    Failed,
}

/// <summary>
/// The platform audio surface the shared recitation engine drives. Each
/// reader adapts its lazily-created player to this seam so the engine —
/// queueing, cursor, timeline, highlight ticks and audio ownership — stays
/// platform-agnostic and unit-testable.
/// </summary>
public interface IRecitationPlaybackSurface
{
    /// <summary>
    /// Whether the native player actually exists. Creation must stay lazy:
    /// constructing the platform handler already activates the device audio
    /// session, so reading must not materialize it (#2642).
    /// </summary>
    bool Exists { get; }

    /// <summary>Current platform state, or <see cref="RecitationPlaybackState.None"/> before the player exists.</summary>
    RecitationPlaybackState CurrentState { get; }

    /// <summary>Playback position in source time.</summary>
    TimeSpan Position { get; }

    double Speed { get; set; }
    double Volume { get; set; }

    /// <summary>Whether a source is currently loaded.</summary>
    bool HasSource { get; }

    /// <summary>
    /// Loads a clip file; null clears it. Setting a path materializes the
    /// player on first use — callers must have already claimed audio
    /// ownership, because handler creation activates the session.
    /// </summary>
    void SetSourcePath(string? path);

    void Play();
    void Pause();
    void Stop();
    Task SeekToAsync(TimeSpan position, CancellationToken cancellationToken);

    /// <summary>Pumps the platform player's reported position before the word marker is painted.</summary>
    void RefreshPosition();

    event EventHandler? MediaOpened;
    event EventHandler? MediaEnded;
    event EventHandler<string?>? MediaFailed;
    event EventHandler<RecitationPlaybackState>? StateChanged;
}

/// <summary>
/// A repeating highlight-frame ticker — the dispatcher timer in production,
/// a test double in unit tests.
/// </summary>
public interface IRecitationFrameTicker
{
    void Start();
    void Stop();
}

/// <summary>The dispatcher-backed <see cref="IRecitationFrameTicker"/>.</summary>
public sealed class DispatcherFrameTicker : IRecitationFrameTicker
{
    private readonly IDispatcherTimer _timer;

    public DispatcherFrameTicker(IDispatcher dispatcher, TimeSpan interval, Action tick)
    {
        _timer = dispatcher.CreateTimer();
        _timer.Interval = interval;
        _timer.Tick += (_, _) => tick();
    }

    public void Start() => _timer.Start();
    public void Stop() => _timer.Stop();
}
