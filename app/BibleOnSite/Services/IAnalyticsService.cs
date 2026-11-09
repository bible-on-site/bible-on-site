namespace BibleOnSite.Services;

/// <summary>
/// Analytics service for screen tracking (Firebase Analytics on Android, no-op elsewhere).
/// Mirrors legacy app: AlHaperek/{perekId}, route-based screens.
/// </summary>
public interface IAnalyticsService
{
    /// <summary>
    /// Logs the current screen (GA4 screen_view). Use route or legacy-style names e.g. "AlHaperek/42", "AuthorsPage".
    /// </summary>
    void SetScreen(string screenName, string? screenClassOverride);
}
