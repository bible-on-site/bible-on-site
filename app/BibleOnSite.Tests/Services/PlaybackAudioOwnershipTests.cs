using BibleOnSite.Services;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// #2642: exclusive device audio must be interrupted only while an app player
/// is actually audible, and interrupted players must be told they may resume
/// once nothing remains — never at player construction or preparation.
/// </summary>
public class PlaybackAudioOwnershipTests
{
    private sealed class FakePlatform : PlaybackAudioOwnership.IPlatform
    {
        public int Activations { get; private set; }
        public int Deactivations { get; private set; }
        public bool ThrowOnActivate { get; set; }
        public bool ThrowOnDeactivate { get; set; }

        public void Activate()
        {
            Activations++;
            if (ThrowOnActivate) { throw new InvalidOperationException("session refused"); }
        }

        public void Deactivate()
        {
            Deactivations++;
            if (ThrowOnDeactivate) { throw new InvalidOperationException("session refused"); }
        }
    }

    /// <summary>Captures each scheduled release so tests decide when (and whether) it lands.</summary>
    private sealed class Rig
    {
        public FakePlatform Platform { get; } = new();
        public List<TaskCompletionSource> Releases { get; } = [];
        public PlaybackAudioOwnership Ownership { get; }

        public Rig()
        {
            Ownership = new PlaybackAudioOwnership(Platform, TimeSpan.FromMilliseconds(250),
                (_, ct) =>
                {
                    var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                    ct.Register(() => tcs.TrySetCanceled(ct));
                    Releases.Add(tcs);
                    return tcs.Task;
                });
        }
    }

    [Fact]
    public void Playing_FirstOwner_ActivatesOnce()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());

        lease.Playing();
        lease.Playing();

        rig.Platform.Activations.Should().Be(1);
        rig.Platform.Deactivations.Should().Be(0);
    }

    [Fact]
    public void Playing_TwoOwners_OnlyActivatesOnce()
    {
        var rig = new Rig();
        var a = rig.Ownership.Track("a");
        var b = rig.Ownership.Track("b");

        a.Playing();
        b.Playing();

        rig.Platform.Activations.Should().Be(1);
    }

    [Fact]
    public async Task Idle_LastOwner_ReleasesAfterTheQuietWindow()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();

        lease.Idle();

        rig.Platform.Deactivations.Should().Be(0);
        rig.Releases.Should().HaveCount(1);
        rig.Releases[0].SetResult();
        await rig.Ownership.PendingRelease!;
        rig.Platform.Deactivations.Should().Be(1);
    }

    [Fact]
    public async Task Idle_ThenPlayingBeforeWindow_CancelsTheRelease()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();

        lease.Idle();
        lease.Playing();

        // Cancelling the pending release voids the captured delay, so no
        // deactivate ever runs even though the window elapsed.
        rig.Releases[0].Task.IsCanceled.Should().BeTrue();
        await rig.Ownership.PendingRelease!;
        rig.Platform.Deactivations.Should().Be(0);
    }

    [Fact]
    public void Idle_OtherOwnersStillPlay_KeepsTheSession()
    {
        var rig = new Rig();
        var a = rig.Ownership.Track("a");
        var b = rig.Ownership.Track("b");
        a.Playing();
        b.Playing();

        a.Idle();

        rig.Platform.Deactivations.Should().Be(0);
        rig.Releases.Should().BeEmpty();
    }

    [Fact]
    public void Idle_WithoutPlaying_IsANoOp()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());

        lease.Idle();

        rig.Platform.Activations.Should().Be(0);
        rig.Platform.Deactivations.Should().Be(0);
        rig.Releases.Should().BeEmpty();
    }

    [Fact]
    public async Task Dispose_AudibleOwner_ReleasesImmediately()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        lease.Idle();

        lease.Dispose();

        // A disposed player does not wait out the release window — it gives
        // ownership back at once, ahead of any handler teardown (#2642).
        rig.Platform.Deactivations.Should().Be(1);
        rig.Releases[0].Task.IsCanceled.Should().BeTrue();
        await rig.Ownership.PendingRelease!;
    }

    [Fact]
    public void Dispose_WhileOthersPlay_KeepsTheSession()
    {
        var rig = new Rig();
        var a = rig.Ownership.Track("a");
        var b = rig.Ownership.Track("b");
        a.Playing();
        b.Playing();

        a.Dispose();

        rig.Platform.Deactivations.Should().Be(0);
        rig.Platform.Activations.Should().Be(1);
    }

    [Fact]
    public void Dispose_ThenPlaybackCalls_AreIgnored()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Dispose();

        lease.Playing();
        lease.Idle();
        lease.Hold().Dispose();
        lease.Dispose();

        rig.Platform.Activations.Should().Be(0);
        rig.Platform.Deactivations.Should().Be(0);
    }

    [Fact]
    public void Hold_WithoutPlayback_DoesNotActivate()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());

        using var hold = lease.Hold();

        rig.Platform.Activations.Should().Be(0);
    }

    [Fact]
    public void Hold_SurvivesIdle_SoChainedClipsDoNotRelease()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        using var hold = lease.Hold();

        // The clip ends (idle) while the next one is prepared — the session
        // must not drop and retake mid-transition.
        lease.Idle();

        rig.Platform.Deactivations.Should().Be(0);
        rig.Releases.Should().BeEmpty();
    }

    [Fact]
    public void Hold_ReleasedAfterIdle_SchedulesTheRelease()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        var hold = lease.Hold();
        lease.Idle();

        hold.Dispose();

        rig.Releases.Should().HaveCount(1);
        rig.Platform.Deactivations.Should().Be(0);
    }

    [Fact]
    public void Hold_ThenPlaying_KeepsOwnershipContinuous()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        var hold = lease.Hold();
        lease.Idle();

        lease.Playing();
        hold.Dispose();

        rig.Platform.Activations.Should().Be(1);
        rig.Platform.Deactivations.Should().Be(0);
        rig.Releases.Should().BeEmpty();
    }

    [Fact]
    public void Hold_OnDisposedLease_ReturnsAnInertToken()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Dispose();

        var hold = lease.Hold();
        hold.Dispose();

        rig.Platform.Activations.Should().Be(0);
        rig.Platform.Deactivations.Should().Be(0);
        rig.Releases.Should().BeEmpty();
    }

    [Fact]
    public async Task Playing_AfterRelease_Reactivates()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        lease.Idle();
        rig.Releases[0].SetResult();
        await rig.Ownership.PendingRelease!;

        lease.Playing();

        rig.Platform.Activations.Should().Be(2);
    }

    [Fact]
    public void PlatformFailure_OnActivate_DoesNotEscape_AndRetries()
    {
        var rig = new Rig();
        rig.Platform.ThrowOnActivate = true;
        var lease = rig.Ownership.Track(new object());

        lease.Playing();

        rig.Platform.Activations.Should().Be(1);

        // A refused activation leaves the session unowned, so the next
        // playback request tries again instead of staying silent.
        rig.Platform.ThrowOnActivate = false;
        lease.Playing();
        rig.Platform.Activations.Should().Be(2);
    }

    [Fact]
    public async Task PlatformFailure_OnDeactivate_DoesNotEscape()
    {
        var rig = new Rig();
        rig.Platform.ThrowOnDeactivate = true;
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        lease.Idle();
        rig.Releases[0].SetResult();

        // The swallowed failure completes the release task normally — a throw
        // here would fault the await and fail the test by itself.
        await rig.Ownership.PendingRelease!;
        rig.Platform.Deactivations.Should().Be(1);
    }

    [Fact]
    public async Task ConcurrentOwners_ReleaseOnlyWhenTheLastStops()
    {
        var rig = new Rig();
        var recitation = rig.Ownership.Track("recitation");
        var article = rig.Ownership.Track("article");
        recitation.Playing();
        article.Playing();

        recitation.Idle();
        rig.Releases.Should().BeEmpty("the article player still owns the session");

        article.Idle();
        rig.Releases.Should().HaveCount(1);
        rig.Releases[0].SetResult();
        await rig.Ownership.PendingRelease!;
        rig.Platform.Deactivations.Should().Be(1);
    }

    [Fact]
    public async Task IdleAfterACanceledRelease_SchedulesAFreshOne()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        lease.Idle();
        lease.Playing();

        lease.Idle();

        rig.Releases.Should().HaveCount(2);
        rig.Releases[1].SetResult();
        await rig.Ownership.PendingRelease!;
        rig.Platform.Deactivations.Should().Be(1);
    }

    [Fact]
    public async Task HoldOnly_Release_DoesNotDeactivate()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        var hold = lease.Hold();

        hold.Dispose();

        rig.Releases.Should().HaveCount(1);
        rig.Releases[0].SetResult();
        // A claim that never activated the session releases it silently — the
        // platform is not told to resume what was never interrupted.
        await rig.Ownership.PendingRelease!;
        rig.Platform.Activations.Should().Be(0);
        rig.Platform.Deactivations.Should().Be(0);
    }

    [Fact]
    public void Holds_Nest_UntilAllAreReleased()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        var first = lease.Hold();
        var second = lease.Hold();
        lease.Idle();

        first.Dispose();
        rig.Releases.Should().BeEmpty("the second hold still claims the session");

        second.Dispose();
        rig.Releases.Should().HaveCount(1);
    }

    [Fact]
    public void Dispose_WhileAHoldIsOpen_ReleasesImmediatelyAndInertsTheToken()
    {
        var rig = new Rig();
        var lease = rig.Ownership.Track(new object());
        lease.Playing();
        var hold = lease.Hold();

        lease.Dispose();
        rig.Platform.Deactivations.Should().Be(1);

        hold.Dispose();
        rig.Platform.Deactivations.Should().Be(1);
    }

    [Fact]
    public void Shared_TracksOnEveryPlatform()
    {
        // Outside Apple builds the bridge is a no-op by design — the lease
        // calls must still work so playback code stays platform-agnostic.
        var lease = PlaybackAudioOwnership.Shared.Track(new object());
        lease.Playing();
        lease.Idle();
        lease.Hold().Dispose();
        lease.Dispose();
        PlaybackAudioOwnership.Shared.Should().NotBeNull();
    }
}
