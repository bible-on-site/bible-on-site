using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The in-flight navigation dedupe behind the repeated-navigation fix
/// (#2640): a second trigger during a push is absorbed, sequential
/// navigations keep working and a failure releases the gate for retry.
/// </summary>
public class NavigationGateTests
{
    [Fact]
    public async Task WhileInFlight_SecondCallIsAbsorbed()
    {
        var gate = new TaskCompletionSource<object?>();
        var calls = 0;
        var nav = new NavigationGate();

        var first = nav.RunAsync(() => { calls++; return gate.Task; });
        var second = nav.RunAsync(() => { calls++; return Task.CompletedTask; });
        await second;

        calls.Should().Be(1, "the in-flight navigation owns the gate");
        gate.SetResult(null);
        await first;
    }

    [Fact]
    public async Task AfterCompletion_NextCallRuns()
    {
        var calls = 0;
        var nav = new NavigationGate();

        await nav.RunAsync(() => { calls++; return Task.CompletedTask; });
        await nav.RunAsync(() => { calls++; return Task.CompletedTask; });

        calls.Should().Be(2);
    }

    [Fact]
    public async Task Failure_ReleasesTheGate()
    {
        var calls = 0;
        var nav = new NavigationGate();

        await Assert.ThrowsAsync<InvalidOperationException>(() => nav.RunAsync(() =>
        {
            calls++;
            throw new InvalidOperationException("route failed");
        }));
        await nav.RunAsync(() => { calls++; return Task.CompletedTask; });

        calls.Should().Be(2, "a failed navigation must not wedge the gate shut");
    }

    [Fact]
    public async Task QueuedCall_OnIdleGate_RunsImmediately()
    {
        var calls = 0;
        var nav = new NavigationGate();

        await nav.RunQueuedAsync(() => { calls++; return Task.CompletedTask; });

        calls.Should().Be(1);
    }

    [Fact]
    public async Task QueuedCall_WaitsOutTheInFlightCall_ThenRuns()
    {
        var gate = new TaskCompletionSource<object?>();
        var calls = 0;
        var nav = new NavigationGate();

        var first = nav.RunAsync(() => { calls++; return gate.Task; });
        var second = nav.RunQueuedAsync(() => { calls++; return Task.CompletedTask; });

        second.IsCompleted.Should().BeFalse(
            "a queued call waits out the in-flight navigation instead of being absorbed");
        gate.SetResult(null);
        await Task.WhenAll(first, second);

        calls.Should().Be(2, "a queued call must reach its destination once the gate frees");
    }

    [Fact]
    public async Task QueuedCalls_BehindInFlightCall_AllEventuallyRun()
    {
        var gate = new TaskCompletionSource<object?>();
        var calls = new List<int>();
        var nav = new NavigationGate();

        var first = nav.RunAsync(() => { calls.Add(1); return gate.Task; });
        var second = nav.RunQueuedAsync(() => { calls.Add(2); return Task.CompletedTask; });
        var third = nav.RunQueuedAsync(() => { calls.Add(3); return Task.CompletedTask; });
        gate.SetResult(null);
        await Task.WhenAll(first, second, third);

        calls.Should().BeEquivalentTo([1, 2, 3],
            "every queued call runs — none may be dropped like a repeated tap");
    }

    [Fact]
    public async Task QueuedCall_BehindAFailedCall_StillRuns()
    {
        var gate = new TaskCompletionSource<object?>();
        var ran = false;
        var nav = new NavigationGate();

        var first = nav.RunAsync(async () =>
        {
            await gate.Task;
            throw new InvalidOperationException("route failed");
        });
        var second = nav.RunQueuedAsync(() => { ran = true; return Task.CompletedTask; });
        gate.SetResult(null);

        await Assert.ThrowsAsync<InvalidOperationException>(() => first);
        await second;

        ran.Should().BeTrue("a failed navigation frees the gate for its queued waiters");
    }
}
