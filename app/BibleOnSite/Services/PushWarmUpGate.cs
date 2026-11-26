namespace BibleOnSite.Services;

/// <summary>
/// Guards push-platform warm-up (the Play-services validity check / token
/// warm-up): event wiring runs exactly once, while a failed warm-up
/// propagates so the caller's cached init task faults and the next attempt
/// retries the check without re-subscribing the handlers.
/// </summary>
internal sealed class PushWarmUpGate
{
    private bool _wired;

    /// <summary>Runs <paramref name="wire"/> the first time only — a throwing
    /// <paramref name="wire"/> leaves the gate open so the retry wires again —
    /// then awaits <paramref name="warmUp"/>; its exceptions propagate.</summary>
    public async Task RunAsync(Action wire, Func<Task> warmUp)
    {
        if (!_wired)
        {
            wire();
            _wired = true;
        }
        await warmUp();
    }
}
