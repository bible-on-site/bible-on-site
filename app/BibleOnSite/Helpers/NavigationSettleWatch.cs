namespace BibleOnSite.Helpers;

/// <summary>
/// Tracks the Navigating→Navigated settle window that owns Back presses: a
/// press landing inside it is consumed rather than re-entered into the Shell
/// pipeline, where a second pass can pop the page beneath the one already
/// transitioning out and leave an empty surface (#2460).
/// MAUI fires Navigating for every GoToAsync proposal, but a proposal whose
/// target location equals the current one performs no transition and never
/// reports Navigated — arming on it would consume Back forever (#2926, the
/// packs shortcut leaves <c>PreferencesPage</c> on top and the flyout's
/// העדפות entry targets that same location; locations drop query strings).
/// Any other way a navigation can miss Navigated — cancellation, a faulted
/// transition, a stalled platform animation — is bounded by
/// <see cref="ConsumeBound"/> so the pipeline always recovers.
/// </summary>
internal sealed class NavigationSettleWatch
{
    /// <summary>Liveness bound on the consume window — far longer than any real
    /// transition, short enough that a wedged one frees Back quickly.</summary>
    internal static readonly TimeSpan ConsumeBound = TimeSpan.FromSeconds(2);

    private DateTimeOffset _armedUtc;
    private bool _armed;

    /// <summary>
    /// Arms the consume window for a navigation proposal. Proposals that cannot
    /// change the visible location (target equals current) are ignored: they
    /// never transition and never complete a settle window.
    /// </summary>
    public void Begin(Uri? currentLocation, Uri? targetLocation, DateTimeOffset utcNow)
    {
        if (targetLocation is not null && targetLocation == currentLocation)
        {
            return;
        }
        _armedUtc = utcNow;
        _armed = true;
    }

    /// <summary>Navigation reported Navigated — the settle window is over.</summary>
    public void Complete() => _armed = false;

    /// <summary>
    /// Whether a Back press at <paramref name="utcNow"/> still belongs to an
    /// in-flight transition and must be consumed rather than re-entered.
    /// </summary>
    public bool OwnsBack(DateTimeOffset utcNow) =>
        _armed && utcNow - _armedUtc < ConsumeBound;
}
