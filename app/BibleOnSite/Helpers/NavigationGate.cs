namespace BibleOnSite.Helpers;

/// <summary>
/// Serializes a user-triggered navigation: while one navigation is still in
/// flight a second trigger is absorbed instead of stacking another page or a
/// second absolute-route transition on top of it (#2640). The gate always
/// releases - a failed navigation leaves the action retryable.
/// </summary>
internal sealed class NavigationGate
{
    private bool _pending;

    /// <summary>Runs <paramref name="navigate"/> unless a call is still in flight.</summary>
    public async Task RunAsync(Func<Task> navigate)
    {
        if (_pending)
        {
            return;
        }
        _pending = true;
        try
        {
            await navigate();
        }
        finally
        {
            _pending = false;
        }
    }
}
