using BibleOnSite.Services;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

public class PushWarmUpGateTests
{
    [Fact]
    public async Task RunAsync_OnSuccess_WiresOnceAndRunsWarmUp()
    {
        var gate = new PushWarmUpGate();
        var wires = 0;
        var warmUps = 0;

        await gate.RunAsync(() => wires++, () => { warmUps++; return Task.CompletedTask; });

        wires.Should().Be(1);
        warmUps.Should().Be(1);
    }

    [Fact]
    public async Task RunAsync_WhenWarmUpFaults_PropagatesSoTheCallerRetries()
    {
        var gate = new PushWarmUpGate();

        var act = () => gate.RunAsync(() => { }, () => Task.FromException(new InvalidOperationException("Play services not ready")));

        await act.Should().ThrowAsync<InvalidOperationException>().WithMessage("Play services not ready");
    }

    [Fact]
    public async Task RunAsync_WhenWarmUpFaults_RetryDoesNotRewire()
    {
        var gate = new PushWarmUpGate();
        var wires = 0;
        var warmUps = 0;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            gate.RunAsync(() => wires++, () => { warmUps++; return Task.FromException(new InvalidOperationException()); }));
        await gate.RunAsync(() => wires++, () => { warmUps++; return Task.CompletedTask; });

        // The regression: the Android client subscribed NotificationTapped /
        // TokenChanged / Error with += before a swallowed Play-services check —
        // rethrowing alone would have double-subscribed them on retry.
        wires.Should().Be(1);
        warmUps.Should().Be(2);
    }

    [Fact]
    public async Task RunAsync_WhenWireThrows_RetryWiresAgain()
    {
        var gate = new PushWarmUpGate();
        var wires = 0;
        var attempts = 0;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            gate.RunAsync(() => { attempts++; throw new InvalidOperationException(); }, () => Task.CompletedTask));
        await gate.RunAsync(() => { attempts++; wires++; }, () => Task.CompletedTask);

        attempts.Should().Be(2);
        wires.Should().Be(1);
    }
}
