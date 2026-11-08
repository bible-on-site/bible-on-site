namespace BibleOnSite.Helpers;

/// <summary>
/// Serializes a user-triggered navigation: while one navigation is still in
/// flight a second trigger is absorbed instead of stacking another page or a
/// second absolute-route transition on top of it (#2640). The gate always
/// releases - a failed navigation leaves the action retryable.
/// </summary>
internal sealed class NavigationGate
{
    private readonly object _sync = new();
    private bool _pending;

    /// <summary>Completes when the currently in-flight call releases the gate.</summary>
    private TaskCompletionSource _inFlight = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>Runs <paramref name="navigate"/> unless a call is still in flight.</summary>
    public async Task RunAsync(Func<Task> navigate)
    {
        if (!TryEnter())
        {
            return;
        }
        await RunOwnedAsync(navigate);
    }

    /// <summary>
    /// Queues behind a call still in flight instead of being absorbed —
    /// dependent navigation (an app link retargeting the reader) must reach
    /// its destination rather than vanish the way a repeated tap does.
    /// </summary>
    public async Task RunQueuedAsync(Func<Task> navigate)
    {
        while (!TryEnter())
        {
            Task inFlight;
            lock (_sync)
            {
                inFlight = _inFlight.Task;
            }
            await inFlight;
        }
        await RunOwnedAsync(navigate);
    }

    /// <summary>Claims the gate and arms its release signal; false when already held.</summary>
    private bool TryEnter()
    {
        lock (_sync)
        {
            if (_pending)
            {
                return false;
            }
            _pending = true;
            _inFlight = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            return true;
        }
    }

    private async Task RunOwnedAsync(Func<Task> navigate)
    {
        try
        {
            await navigate();
        }
        finally
        {
            TaskCompletionSource inFlight;
            lock (_sync)
            {
                _pending = false;
                inFlight = _inFlight;
            }
            inFlight.TrySetResult();
        }
    }
}
