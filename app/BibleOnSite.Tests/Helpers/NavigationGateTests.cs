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
}
