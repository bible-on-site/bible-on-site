using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// #3704 — one reader download→play request: the first Play tap starts the
/// sefer's pack download, repeated taps join it instead of queueing extra
/// downloads or playback starts, and a superseding request or cancel drops
/// the pending auto-play.
/// </summary>
public class ReaderRecitationDownloadTests
{
    /// <summary>A download delegate the test controls step by step.</summary>
    private sealed class ControllableDownload
    {
        private readonly TaskCompletionSource _gate = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int Calls { get; private set; }
        public CancellationToken LastToken { get; private set; }
        public bool CancelObserved { get; private set; }

        public async Task Run(CancellationToken token)
        {
            Calls++;
            LastToken = token;
            try
            {
                await _gate.Task.WaitAsync(token);
            }
            catch (OperationCanceledException)
            {
                CancelObserved = true;
                throw;
            }
        }

        public void Release() => _gate.TrySetResult();
    }

    [Fact]
    public async Task FirstTap_DownloadsThenPlaysOnce()
    {
        var request = new ReaderRecitationDownload();
        var downloads = 0;
        var plays = 0;

        var played = await request.RunAsync(3,
            _ => { downloads++; return Task.CompletedTask; },
            () => { plays++; return Task.CompletedTask; });

        played.Should().BeTrue();
        downloads.Should().Be(1);
        plays.Should().Be(1, "a successful download replays the stored tap exactly once");
        request.IsPending.Should().BeFalse();
        request.PendingPerekId.Should().BeNull();
    }

    [Fact]
    public async Task RepeatedTap_JoinsTheInFlightRequest()
    {
        var request = new ReaderRecitationDownload();
        var download = new ControllableDownload();
        var plays = 0;

        var first = request.RunAsync(3, download.Run, () => { plays++; return Task.CompletedTask; });
        // The request is pending once RunAsync's synchronous prefix ran.
        download.Calls.Should().Be(1);
        request.IsPending.Should().BeTrue();
        request.PendingPerekId.Should().Be(3);

        var joined = await request.RunAsync(3, download.Run,
            () => { plays++; return Task.CompletedTask; });

        joined.Should().BeFalse("the second tap is represented by the pending request");
        download.Calls.Should().Be(1, "no duplicate download is queued");

        download.Release();
        (await first).Should().BeTrue();
        plays.Should().Be(1, "joined taps share the one automatic playback");
        request.IsPending.Should().BeFalse();
    }

    [Fact]
    public async Task Cancel_DropsThePendingAutoPlay()
    {
        var request = new ReaderRecitationDownload();
        var download = new ControllableDownload();
        var plays = 0;

        var run = request.RunAsync(3, download.Run, () => { plays++; return Task.CompletedTask; });
        request.Cancel();

        request.IsPending.Should().BeFalse();
        await run.Awaiting(r => r).Should().ThrowAsync<OperationCanceledException>();
        plays.Should().Be(0, "navigation cancels the request before the audio lands");
    }

    [Fact]
    public async Task CancelledDownload_ThatReturnsNormally_SkipsPlayback()
    {
        var request = new ReaderRecitationDownload();
        var plays = 0;
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        // A delegate that swallows cancellation instead of throwing still
        // must not trigger the stored play — the token state decides. The
        // release gate keeps the ordering deterministic: the download
        // returns only after Cancel() already landed.
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var run = request.RunAsync(3,
            async _ => { started.TrySetResult(); await release.Task; },
            () => { plays++; return Task.CompletedTask; });
        await started.Task.WaitAsync(TestContext.Current.CancellationToken);
        request.Cancel();
        release.TrySetResult();

        (await run).Should().BeFalse();
        plays.Should().Be(0);
    }

    [Fact]
    public async Task NewPerekRequest_SupersedesThePendingOne()
    {
        var request = new ReaderRecitationDownload();
        var first = new ControllableDownload();
        var plays = new List<int>();

        var run1 = request.RunAsync(3, first.Run, () => { plays.Add(3); return Task.CompletedTask; });
        var run2 = request.RunAsync(8,
            _ => Task.CompletedTask,
            () => { plays.Add(8); return Task.CompletedTask; });

        await run1.Awaiting(r => r).Should().ThrowAsync<OperationCanceledException>(
            "the superseded request's token is cancelled");
        (await run2).Should().BeTrue();
        first.CancelObserved.Should().BeTrue("the old download's token fired");
        plays.Should().Equal(new[] { 8 }, "only the live request auto-plays");
    }

    [Fact]
    public async Task FailedDownload_ReleasesTheRequest_AndTheNextTapRetries()
    {
        var request = new ReaderRecitationDownload();
        var attempts = 0;

        var failed = request.RunAsync(3,
            _ => { attempts++; throw new InvalidOperationException("offline"); },
            () => Task.CompletedTask);
        await failed.Awaiting(r => r).Should().ThrowAsync<InvalidOperationException>();

        request.IsPending.Should().BeFalse("a failed request frees the button for retry");

        var retried = await request.RunAsync(3,
            _ => { attempts++; return Task.CompletedTask; },
            () => Task.CompletedTask);

        retried.Should().BeTrue();
        attempts.Should().Be(2);
    }
}
