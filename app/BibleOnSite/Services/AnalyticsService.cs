namespace BibleOnSite.Services;

#if ANDROID || IOS || MACCATALYST
using Plugin.Firebase.Analytics;
#endif

/// <summary>
/// Firebase Analytics on Android and iOS (same project as legacy app: tanah-al-haperek).
/// No-op on other platforms.
/// </summary>
public sealed class AnalyticsService : IAnalyticsService
{
	public void SetScreen(string screenName, string? screenClassOverride = null)
	{
#if ANDROID || IOS || MACCATALYST
		try
		{
			var analytics = CrossFirebaseAnalytics.Current;
			// GA4: log screen_view event (replaces deprecated setCurrentScreen)
			analytics.LogEvent("screen_view", new Dictionary<string, object>
			{
				["screen_name"] = screenName,
				["screen_class"] = screenClassOverride ?? screenName
			});
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[Analytics] SetScreen failed: {ex.Message}");
		}
#endif
	}

	public void LogSearch(string searchTerm)
	{
#if ANDROID || IOS || MACCATALYST
		try
		{
			CrossFirebaseAnalytics.Current.LogEvent("search", new Dictionary<string, object>
			{
				["search_term"] = searchTerm ?? string.Empty
			});
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[Analytics] LogSearch failed: {ex.Message}");
		}
#endif
	}
}
