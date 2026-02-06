namespace BibleOnSite.Services;

/// <summary>
/// Analytics service for screen and event tracking (Firebase Analytics on Android, no-op elsewhere).
/// Mirrors legacy app: AlHaperek/{perekId}, route-based screens, and search events.
/// </summary>
public interface IAnalyticsService
{
	/// <summary>
	/// Logs the current screen (GA4 screen_view). Use route or legacy-style names e.g. "AlHaperek/42", "AuthorsPage".
	/// </summary>
	void SetScreen(string screenName, string? screenClassOverride = null);

	/// <summary>
	/// Logs a search event (GA4 search). Mirrors legacy analytics.logSearch(searchTerm).
	/// </summary>
	void LogSearch(string searchTerm);
}
