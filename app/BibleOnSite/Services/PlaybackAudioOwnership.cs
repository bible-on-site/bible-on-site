#if IOS || MACCATALYST
using AVFoundation;
#endif
using System.Diagnostics;

namespace BibleOnSite.Services;

/// <summary>
/// Serializes exclusive device-audio ownership across every in-app player.
///
/// CommunityToolkit's iOS MediaElement activates the shared AVAudioSession
/// when its native handler is created and releases it only on dispose, so a
/// page that constructs an idle player still cuts off music playing in
/// another app, and a finished player keeps that interruption forever
/// (#2642). This coordinator owns activation instead: a player marks
/// <see cref="Lease.Playing"/> only while playback actually produces audio
/// and <see cref="Lease.Idle"/> when it pauses, stops, ends or fails, so
/// external music is interrupted exactly while the app is audible and is
/// told it may resume once nothing remains.
///
/// Android's ExoPlayer and Windows' MediaPlayerElement take and release
/// audio focus around real playback on their own, so the shared platform
/// bridge is a no-op outside Apple builds and the lease calls reduce to
/// bookkeeping there.
/// </summary>
public sealed class PlaybackAudioOwnership
{
    /// <summary>
    /// How long the last claim may stay idle before the session is released.
    /// Chained clips and quick pause/resume pairs pass through silent states
    /// on their way to the next playback; releasing only after this quiet
    /// window keeps intentional transitions from churning the session.
    /// </summary>
    private static readonly TimeSpan DefaultReleaseDelay = TimeSpan.FromMilliseconds(500);

    private readonly object _gate = new();
    private readonly IPlatform _platform;
    private readonly TimeSpan _releaseDelay;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private readonly HashSet<object> _claimed = [];
    private CancellationTokenSource? _pendingRelease;
    private bool _active;

    public PlaybackAudioOwnership(IPlatform platform, TimeSpan releaseDelay)
        : this(platform, releaseDelay, null)
    {
    }

    internal PlaybackAudioOwnership(IPlatform platform, TimeSpan releaseDelay,
        Func<TimeSpan, CancellationToken, Task>? delay)
    {
        _platform = platform;
        _releaseDelay = releaseDelay;
        _delay = delay ?? ((d, ct) => Task.Delay(d, ct));
    }

    /// <summary>The coordinator every app player shares.</summary>
    public static PlaybackAudioOwnership Shared { get; } = new(CreatePlatform(), DefaultReleaseDelay);

    /// <summary>Registers a playback owner so it can claim and release audio ownership.</summary>
    public Lease Track(object owner) => new(this, owner);

    /// <summary>The pending release task; tests await it instead of guessing at timers.</summary>
    internal Task? PendingRelease { get; private set; }

    /// <summary>Device-audio hooks the platform supplies.</summary>
    public interface IPlatform
    {
        /// <summary>Takes exclusive playback audio, interrupting other apps' media.</summary>
        void Activate();

        /// <summary>Gives audio ownership up, telling interrupted sessions they may resume.</summary>
        void Deactivate();
    }

    /// <summary>
    /// One owner's claim handle. An owner is counted while it is audible
    /// (<see cref="Playing"/> without a later <see cref="Idle"/>) or while it
    /// holds a <see cref="Hold"/> token; the session stays active only while
    /// at least one owner is counted.
    /// </summary>
    public sealed class Lease : IDisposable
    {
        private readonly PlaybackAudioOwnership _ownership;
        private readonly object _owner;
        private bool _audible;
        private int _holds;
        private bool _disposed;

        internal Lease(PlaybackAudioOwnership ownership, object owner)
        {
            _ownership = ownership;
            _owner = owner;
        }

        /// <summary>
        /// Marks this owner as producing audio: cancels a pending release and
        /// activates the session when the first owner becomes audible. Safe to
        /// call right before an explicit Play so a released session is back
        /// before the platform player emits — and right before handing a valid
        /// source to a player, since the toolkit's handler creation already
        /// activates the session and a source that fails to open must still
        /// release it (#2642).
        /// </summary>
        public void Playing()
        {
            // The platform call stays inside the gate: a release timer that
            // deactivated between the claim change and the call would mute a
            // session its new owner still claims.
            lock (_ownership._gate)
            {
                if (_disposed)
                {
                    return;
                }

                _audible = true;
                _ownership._claimed.Add(_owner);
                _ownership._pendingRelease?.Cancel();
                if (!_ownership._active)
                {
                    _ownership._active = true;
                    _ownership.TryActivate();
                }
            }
        }

        /// <summary>
        /// Marks this owner silent — paused, stopped, ended or failed. The
        /// session is released after the quiet window once nothing stays
        /// claimed, so a state flutter mid-transition does not drop it.
        /// </summary>
        public void Idle()
        {
            lock (_ownership._gate)
            {
                if (_disposed || !_audible)
                {
                    return;
                }

                _audible = false;
                if (_holds == 0 && _ownership._claimed.Remove(_owner) && _ownership._claimed.Count == 0)
                {
                    _ownership.ScheduleRelease();
                }
            }
        }

        /// <summary>
        /// Keeps this owner counted through a deliberate gap — preparing the
        /// next chained clip or swapping sources — so the session is not
        /// dropped and retaken mid-transition. The token never activates on
        /// its own; it only prevents release.
        /// </summary>
        public IDisposable Hold()
        {
            lock (_ownership._gate)
            {
                if (_disposed)
                {
                    return EmptyHold.Instance;
                }

                _holds++;
                _ownership._claimed.Add(_owner);
                _ownership._pendingRelease?.Cancel();
                return new HoldToken(this);
            }
        }

        private void ReleaseHold()
        {
            lock (_ownership._gate)
            {
                if (_disposed || _holds == 0)
                {
                    return;
                }

                _holds--;
                if (_holds == 0 && !_audible && _ownership._claimed.Remove(_owner) &&
                    _ownership._claimed.Count == 0)
                {
                    _ownership.ScheduleRelease();
                }
            }
        }

        /// <summary>
        /// Drops every claim this owner holds at once — a disposed or hidden
        /// player must neither keep the session nor wait out the release
        /// delay. Other still-playing owners keep it active.
        /// </summary>
        public void Dispose()
        {
            lock (_ownership._gate)
            {
                if (_disposed)
                {
                    return;
                }

                _disposed = true;
                _audible = false;
                _holds = 0;
                _ownership._claimed.Remove(_owner);
                if (_ownership._claimed.Count == 0)
                {
                    _ownership._pendingRelease?.Cancel();
                    _ownership._pendingRelease = null;
                    if (_ownership._active)
                    {
                        _ownership._active = false;
                        _ownership.TryDeactivate();
                    }
                }
            }
        }

        private sealed class HoldToken : IDisposable
        {
            private Lease? _lease;

            public HoldToken(Lease lease) => _lease = lease;

            public void Dispose() => Interlocked.Exchange(ref _lease, null)?.ReleaseHold();
        }

        private sealed class EmptyHold : IDisposable
        {
            public static readonly EmptyHold Instance = new();
            public void Dispose() { /* A disposed lease hands out inert tokens — nothing to release. */ }
        }
    }

    // Callers hold _gate with _claimed already empty.
    private void ScheduleRelease()
    {
        _pendingRelease?.Cancel();
        var cts = _pendingRelease = new CancellationTokenSource();
        PendingRelease = ReleaseWhenQuietAsync(cts);
    }

    private async Task ReleaseWhenQuietAsync(CancellationTokenSource cts)
    {
        // Disposed at scope exit — after the finally below detaches it from
        // _pendingRelease, so a racing Cancel cannot land on a disposed source.
        using var _ = cts;
        try
        {
            await _delay(_releaseDelay, cts.Token).ConfigureAwait(false);
            lock (_gate)
            {
                if (!cts.IsCancellationRequested && _claimed.Count == 0 && _active)
                {
                    _active = false;
                    TryDeactivate();
                }
            }
        }
        catch (OperationCanceledException) { /* A new claim canceled this release before the quiet window ran out. */ }
        finally
        {
            // A newer claim may already have replaced the pending release, so
            // detach before the using disposes the source.
            lock (_gate)
            {
                if (ReferenceEquals(_pendingRelease, cts))
                {
                    _pendingRelease = null;
                }
            }
        }
    }

    private void TryActivate()
    {
        try
        {
            _platform.Activate();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: a session refusal must not break playback; the next Playing retries
        catch (Exception ex) //NOSONAR — a session refusal must not break playback; the next Playing retries.
        {
            #pragma warning restore S2221
            lock (_gate)
            {
                _active = false;
            }
            Debug.WriteLine($"Audio session activate failed: {ex.Message}");
        }
    }

    private void TryDeactivate()
    {
        try
        {
            _platform.Deactivate();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: releasing the session is best-effort; the claim is already dropped
        catch (Exception ex) //NOSONAR — releasing the session is best-effort; the claim is already dropped.
        {
            #pragma warning restore S2221
            Debug.WriteLine($"Audio session deactivate failed: {ex.Message}");
        }
    }

    private static IPlatform CreatePlatform()
    {
#if IOS || MACCATALYST
        return new AppleAudioSession();
#else
        // Only Apple's stack activates the shared session at player
        // construction and holds it until dispose; the other platforms'
        // players already scope focus to real playback.
        return NullPlatform.Instance;
#endif
    }

#if IOS || MACCATALYST
    private sealed class AppleAudioSession : IPlatform
    {
        public void Activate()
        {
            var session = AVAudioSession.SharedInstance();
            session.SetCategory(AVAudioSessionCategory.Playback);
            session.SetActive(true);
        }

        public void Deactivate()
        {
            // NotifyOthersOnDeactivation lets the app whose audio the session
            // interrupted resume once ownership is given up — the toolkit's
            // own dispose path deactivates without it.
            AVAudioSession.SharedInstance().SetActive(false, AVAudioSessionSetActiveOptions.NotifyOthersOnDeactivation);
        }
    }
#endif

    private sealed class NullPlatform : IPlatform
    {
        public static readonly NullPlatform Instance = new();
        public void Activate() { /* Non-Apple players scope audio focus to real playback themselves. */ }
        public void Deactivate() { /* Non-Apple players scope audio focus to real playback themselves. */ }
    }
}
