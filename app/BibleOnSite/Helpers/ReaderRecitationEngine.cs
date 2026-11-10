using BibleOnSite.Models;
using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>
/// The shared recitation playback engine every scripture reader uses
/// (על הפרק, פרשה, מסורה and the upcoming מועדים sections). It owns the
/// playback cursor and resume bookmark, the multi-perek clip queue, prepare
/// and open sequencing, the word-highlight ticker and this owner's claim on
/// exclusive device audio (#2642). Pages keep only the UX: gestures, the
/// focused-pasuk overlay, the selection bar and word→row highlight mapping.
///
/// Audio ownership rules the engine preserves: the platform player and the
/// decoder are only materialized through explicit playback — browsing never
/// activates the audio session; the lease is claimed before a source loads,
/// held across deliberate silent gaps while clips chain, marked idle on
/// quiet states and disposed when the reading context resets.
/// </summary>
public sealed class ReaderRecitationEngine
{
    /// <summary>Highlight cadence — matches the perek/parasha readers' 25ms paint tick.</summary>
    private static readonly TimeSpan FrameInterval = TimeSpan.FromMilliseconds(25);

    private readonly RecitationService _service;
    private readonly PreferencesService _preferences;
    private readonly PlaybackAudioOwnership _ownership;
    private readonly object _audioOwner;
    private readonly IRecitationPlaybackSurface _player;
    private readonly Func<IRecitationAudioDecoder> _decoderFactory;
    private readonly Func<TimeSpan, Action, IRecitationFrameTicker> _tickerFactory;
    private readonly Func<string, string, string, Task> _alert;

    private readonly RecitationPlaybackCursor _cursor = new();
    private readonly Queue<RecitationSegment> _queue = new();
    private CancellationTokenSource? _request;
    private bool _playWhenOpened;
    private double? _pendingSeekMs;
    // Invalidates a MediaOpened handler still awaiting its resume seek.
    private int _generation;
    private IRecitationAudioDecoder? _decoder;
    private IRecitationFrameTicker? _ticker;
    private RecitationTimeline? _timeline;
    private int _timelinePerekId;
    private RecitationSegment? _currentSegment;
    private RecitationWord? _highlightedWord;
    private PlaybackAudioOwnership.Lease? _lease;

    /// <summary>
    /// <paramref name="audioOwner"/> is the lease identity — one per page
    /// instance. <paramref name="player"/> and <paramref name="decoderFactory"/>
    /// keep the native player and WebView decoder lazy (#2642); the factory is
    /// only invoked inside an explicit playback request.
    /// </summary>
    public ReaderRecitationEngine(
        RecitationService service,
        PreferencesService preferences,
        PlaybackAudioOwnership ownership,
        object audioOwner,
        IRecitationPlaybackSurface player,
        Func<IRecitationAudioDecoder> decoderFactory,
        Func<TimeSpan, Action, IRecitationFrameTicker> tickerFactory,
        Func<string, string, string, Task> alert)
    {
        _service = service;
        _preferences = preferences;
        _ownership = ownership;
        _audioOwner = audioOwner;
        _player = player;
        _decoderFactory = decoderFactory;
        _tickerFactory = tickerFactory;
        _alert = alert;
        _player.MediaOpened += OnMediaOpened;
        _player.MediaEnded += OnMediaEnded;
        _player.MediaFailed += OnMediaFailed;
        _player.StateChanged += OnStateChanged;
    }

    /// <summary>The playback identity and perek-scoped resume bookmark the page's bar reads.</summary>
    public RecitationPlaybackCursor Cursor => _cursor;

    /// <summary>Whether a clip prepare/open cycle is in flight — the bar's loading state.</summary>
    public bool Busy { get; private set; }

    /// <summary>
    /// Playback is allowed on this device: the catalog is installed AND the
    /// global קריינות preference (העדפות → על הפרק, default on) is enabled.
    /// </summary>
    public bool Available => _service.IsInstalled && _preferences.QriynotEnabled;

    /// <summary>The live platform state, or null before the player exists.</summary>
    public RecitationPlaybackState? PlayerState => _player.Exists ? _player.CurrentState : null;

    /// <summary>The perek the active highlight timeline maps, or 0 while none is loaded.</summary>
    public int TimelinePerekId => _timelinePerekId;

    /// <summary>
    /// The clip whose audio is loaded — its <see cref="RecitationSegment.SectionId"/>
    /// tells the page which labelled occurrence a highlight maps to.
    /// </summary>
    public RecitationSegment? CurrentSegment => _currentSegment;

    /// <summary>The word under the playhead right now, or null.</summary>
    public RecitationWord? HighlightedWord => _highlightedWord;

    /// <summary>The bar refreshes — playback state, busy flag or availability changed.</summary>
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    public event EventHandler? Changed;
#pragma warning restore S3264

    /// <summary>The highlighted word changed; the page maps it onto its displayed pasuk.</summary>
#pragma warning disable S3264 // Subscribed by the reader pages' code-behind; Codacy's per-file analysis misses them.
    public event EventHandler<RecitationWord?>? WordChanged;
#pragma warning restore S3264

    /// <summary>This owner's claim on exclusive device audio (#2642).</summary>
    private PlaybackAudioOwnership.Lease AudioLease => _lease ??= _ownership.Track(_audioOwner);

    private void RaiseChanged() => Changed?.Invoke(this, EventArgs.Empty);

    /// <summary>Catalog init is best-effort: a failure leaves availability off.</summary>
    public async Task InitializeAsync()
    {
        try
        {
            await _service.InitializeAsync();
            RaiseChanged();
            _ = _service.RefreshIfStaleAsync();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: recitation-pack init is best-effort; availability simply stays off
        catch (Exception ex) //NOSONAR — recitation-pack init is best-effort; availability simply stays off.
        {
            #pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"Recitation extension: {ex.Message}");
        }
    }

    /// <summary>
    /// Preference changes act on the live session: losing availability stops
    /// playback and releases the decoder, while the שמע/קריינות sliders update
    /// an in-flight playback, not only the next play.
    /// </summary>
    public void PreferencesChanged()
    {
        if (!Available)
        {
            StopPlayback();
            ReleaseDecoder();
        }

        if (_player.Exists)
        {
            _player.Volume = _preferences.RecitationVolume;
            _player.Speed = _preferences.RecitationSpeed;
        }
        RaiseChanged();
    }

    /// <summary>Queues a multi-clip plan and starts its first segment.</summary>
    public async Task PlayPlanAsync(string key, bool continuous, IReadOnlyList<RecitationSegment> segments)
    {
        if (!Available || segments.Count == 0)
        {
            return;
        }

        StopPlayback();
        _cursor.Begin(key, continuous);
        _queue.Clear();
        foreach (var segment in segments.Skip(1))
        {
            _queue.Enqueue(segment);
        }
        await PlaySegmentClipAsync(segments[0]);
    }

    /// <summary>Single-segment playback entry point with the shared key toggle.</summary>
    public Task PlayClipAsync(string key, bool continuous, RecitationSegment segment) =>
        PlayClipAsync(key, continuous, segment, null);

    /// <summary>Single-segment playback entry point that also marks the perek-scoped resume bookmark.</summary>
    public async Task PlayClipAsync(string key, bool continuous, RecitationSegment segment,
        double? resumeFromMs)
    {
        // A tapped word or pasuk marks where the next continuous playback
        // resumes. It is set on request so pressing Play before the preview
        // finishes still resumes there, and it outlives the preview's own
        // stop/reset (#2157).
        if (resumeFromMs is double resume)
        {
            _cursor.MarkResume(segment.PerekId, resume);
        }

        if (_cursor.PlayingKey == key && _player.Exists &&
            _player.CurrentState is RecitationPlaybackState.Playing or RecitationPlaybackState.Paused)
        {
            TogglePaused();
            return;
        }
        StopPlayback();
        _cursor.Begin(key, continuous);
        await PlaySegmentClipAsync(segment);
    }

    /// <summary>
    /// The bar's own toggle: an active or paused clip the controls issued
    /// pauses/resumes — the glyph stays honest because only bar-issued
    /// playback reaches here (#2157).
    /// </summary>
    public bool ToggleBarPlayback()
    {
        // The bar's glyph only ever represents bar-issued playback — during a
        // tapped-word preview it shows Play, which starts continuous playback
        // at the bookmark rather than pausing the word (#2157).
        if (!_cursor.BarIssued || !_player.Exists || _player.CurrentState is not
            (RecitationPlaybackState.Playing or RecitationPlaybackState.Paused))
        {
            return false;
        }

        TogglePaused();
        return true;
    }

    private void TogglePaused()
    {
        if (_player.CurrentState == RecitationPlaybackState.Playing)
        {
            _player.Pause();
        }
        else
        {
            ResumePlayback();
        }
    }

    /// <summary>
    /// Re-claims device audio before the platform player resumes — a pause may
    /// already have released the session, and the toolkit only activates it at
    /// handler creation (#2642).
    /// </summary>
    public void ResumePlayback()
    {
        if (!_player.Exists)
        {
            return;
        }
        AudioLease.Playing();
        _player.Play();
    }

    /// <summary>
    /// Full stop that keeps the resume bookmark — back, explicit stop or a
    /// unit/session change that only silences the current clip.
    /// </summary>
    public void StopPlayback()
    {
        ClearHighlight();
        // Invalidates any MediaOpened handler still awaiting its seek.
        _generation++;
        _request?.Cancel();
        _playWhenOpened = false;
        _cursor.Stop();
        _queue.Clear();
        _pendingSeekMs = null;
        Busy = false;
        if (_player.Exists)
        {
            if (_player.HasSource) { _player.Stop(); }
            _player.SetSourcePath(null);
        }
        _lease?.Idle();
    }

    /// <summary>Drops the decoder's held source state; recreated lazily on the next clip.</summary>
    public void ReleaseDecoder()
    {
        if (_decoder is { } decoder)
        {
            _decoder = null;
            _ = decoder.ReleaseAsync();
        }
    }

    /// <summary>
    /// Unit changes and page exits also drop the continuous-playback resume
    /// position and the audio claim at once — a hidden player must not keep
    /// external music paused (#2642).
    /// </summary>
    public void ResetSession()
    {
        StopPlayback();
        ReleaseDecoder();
        _cursor.Reset();
        _lease?.Dispose();
        _lease = null;
    }

    /// <summary>
    /// Prepares one perek's clip and hands it to the player — the per-segment
    /// half of the perek reader's playback, unchanged except that the perek
    /// comes from the segment, not the page.
    /// </summary>
    private async Task PlaySegmentClipAsync(RecitationSegment segment)
    {
        if (!Available)
        {
            return;
        }

        // Keep the claim across the deliberate gap — stopping the old clip,
        // decoding and opening the next segment run through silent player
        // states on the way back to Playing (#2642).
        using var audioHold = AudioLease.Hold();
        using var request = new CancellationTokenSource();
        _request = request;
        Busy = true;
        RaiseChanged();
        try
        {
            var track = _service.GetTrack(segment.PerekId);
            var ranges = segment.Ranges;
            if (ranges == null && segment.Start == null && _preferences.RecitationVersePauseMs >= 0 &&
                track?.AlignmentStatus == "ready")
            {
                ranges = track.GetPasukRanges();
            }
            // MediaElement's position is in source time; scale generated silence so
            // the user's pause retains its wall-clock length at every speed.
            var pauseMs = ranges is { Count: > 1 } && _preferences.RecitationVersePauseMs >= 0
                ? _preferences.RecitationVersePauseMs * _preferences.RecitationSpeed : 0;
            _decoder ??= _decoderFactory();
            var path = await _service.PrepareAudioAsync(segment.PerekId, segment.Pasukim,
                segment.Start, segment.End, request.Token, ranges, _decoder, pauseMs);
            if (request.IsCancellationRequested || !Available || _cursor.PlayingKey == null)
            {
                return;
            }

            _timelinePerekId = segment.PerekId;
            _currentSegment = segment;
            _timeline = track?.AlignmentStatus == "ready"
                ? new RecitationTimeline(track, ranges ??
                    (segment.Start.HasValue && segment.End.HasValue ? [(segment.Start.Value, segment.End.Value)] : null), pauseMs)
                : null;
            // The timeline maps the tapped-word resume point into this clip's position.
            _pendingSeekMs = _cursor.PendingSeekFor(segment.PerekId, _cursor.PlayingContinuous, _timeline);
            // Claim before the handler attaches: creating it already activates
            // the session, so a source that fails to open must still release it
            // — MediaFailed can fire without the player ever reaching Playing.
            AudioLease.Playing();
            _player.Speed = _preferences.RecitationSpeed;
            _player.Volume = _preferences.RecitationVolume;
            _playWhenOpened = true;
            _player.SetSourcePath(path);
        }
        catch (OperationCanceledException) { /* Navigation or another selection cancels the old request. */ }
        #pragma warning disable S2221 // Deliberate failure boundary: playback failure shows the user alert unless the request was canceled
        catch (Exception ex) //NOSONAR — playback failure shows the user alert unless the request was canceled.
        {
            #pragma warning restore S2221
            _lease?.Idle();
            System.Diagnostics.Debug.WriteLine($"Recitation playback: {ex}");
            if (!request.IsCancellationRequested)
            {
                // A failed prepare leaves no source to play — drop the cursor,
                // the queued clips and the pending seek so the bar does not
                // stay up over dead audio (#3261 review).
                StopPlayback();
                await _alert("הקראה", "לא ניתן להשמיע את ההקלטה. בדקו את חבילת ההקראה בהעדפות.", "אישור");
            }
        }
        finally
        {
            if (_request == request) { _request = null; Busy = false; RaiseChanged(); }
        }
    }

#pragma warning disable S1172 // EventHandler signature requires sender.
    private async void OnMediaOpened(object? sender, EventArgs e)
#pragma warning restore S1172
    {
        if (!_playWhenOpened || !Available)
        {
            return;
        }

        _playWhenOpened = false;
        var generation = _generation;
        if (_pendingSeekMs is double seekMs)
        {
            _pendingSeekMs = null;
            try
            {
                // Resume continuous playback from the tapped word's position.
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await _player.SeekToAsync(TimeSpan.FromMilliseconds(seekMs), timeout.Token);
            }
            catch (Exception ex) //NOSONAR — a platform that cannot seek here still plays from the start.
            {
                System.Diagnostics.Debug.WriteLine($"Recitation resume: {ex.Message}");
            }
        }
        if (generation != _generation)
        {
            // StopPlayback ran during the seek — do not revive the old source.
            return;
        }
        ResumePlayback();
        await Task.CompletedTask;
    }

#pragma warning disable S1172 // EventHandler signature requires sender.
    private void OnMediaEnded(object? sender, EventArgs e)
#pragma warning restore S1172
    {
        // iOS can keep CurrentState at Playing once an item finishes, so the
        // end event releases the audio claim itself — a chained next clip
        // holds it before the release lands (#2642).
        _lease?.Idle();
        // A unit plan chains its next perek clip before the playback is done.
        if (_queue.Count > 0 && _cursor.PlayingKey != null)
        {
            _ = PlaySegmentClipAsync(_queue.Dequeue());
            RaiseChanged();
            return;
        }
        // A completed playback consumes the resume bookmark; a finished preview keeps it.
        _cursor.End();
        ClearHighlight();
        RaiseChanged();
    }

#pragma warning disable S1172 // EventHandler signature requires sender.
    private void OnStateChanged(object? sender, RecitationPlaybackState state)
#pragma warning restore S1172
    {
        // The lease follows audible states only — buffering/opening keep the
        // claim so intentional gaps don't churn the session (#2642).
        if (state == RecitationPlaybackState.Playing)
        {
            AudioLease.Playing();
        }
        else if (state is RecitationPlaybackState.Paused or RecitationPlaybackState.Stopped or
            RecitationPlaybackState.None or RecitationPlaybackState.Failed)
        {
            _lease?.Idle();
        }
        _ticker?.Stop();
        if (_cursor.PlayingKey != null && _timeline != null && _player.Exists &&
            _player.CurrentState == RecitationPlaybackState.Playing)
        {
            _ticker ??= _tickerFactory(FrameInterval, UpdateHighlight);
            UpdateHighlight();
            _ticker.Start();
        }
        else if (_player.Exists && _player.CurrentState is RecitationPlaybackState.Stopped or
            RecitationPlaybackState.None or RecitationPlaybackState.Failed)
        {
            SetHighlightedWord(null);
        }
        RaiseChanged();
    }

#pragma warning disable S1172 // EventHandler signature requires sender.
    private async void OnMediaFailed(object? sender, string? message)
#pragma warning restore S1172
    {
        if (_cursor.PlayingKey == null)
        {
            return;
        }

        System.Diagnostics.Debug.WriteLine($"Recitation playback failed: {message}");
        StopPlayback();
        RaiseChanged();
        await _alert("הקראה", "לא ניתן להשמיע את ההקלטה במכשיר זה.", "אישור");
    }

    private void ClearHighlight()
    {
        _ticker?.Stop();
        _timeline = null;
        _currentSegment = null;
        SetHighlightedWord(null);
    }

    private void SetHighlightedWord(RecitationWord? word)
    {
        if (_highlightedWord == word)
        {
            return;
        }

        _highlightedWord = word;
        WordChanged?.Invoke(this, word);
    }

    private void UpdateHighlight()
    {
        if (_cursor.PlayingKey == null || !_player.Exists ||
            _player.CurrentState != RecitationPlaybackState.Playing)
        {
            return;
        }

        // Refresh the platform player's reported position before painting the word.
        _player.RefreshPosition();
        SetHighlightedWord(_timeline?.WordAt(_player.Position.TotalMilliseconds));
    }
}
