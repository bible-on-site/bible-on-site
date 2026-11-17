namespace BibleOnSite.Services;

/// <summary>
/// Analytics service for screen tracking (Firebase Analytics on Android/iOS, no-op elsewhere).
/// Screen names are logical routes e.g. "AlHaperek/42 בראשית א"; content
/// identity rides along as GA4 event parameters (#3378).
/// </summary>
public interface IAnalyticsService
{
    /// <summary>
    /// Logs the current screen (GA4 screen_view) with only the logical name
    /// and the stable page-family class.
    /// </summary>
    void SetScreen(string screenName, string? screenClassOverride);

    /// <summary>
    /// Logs the current screen (GA4 screen_view) with public content-identity
    /// parameters (ids and labels) for report drill-down (#3378).
    /// </summary>
    void SetScreen(string screenName, string? screenClassOverride,
        IReadOnlyDictionary<string, object>? parameters);
}
