namespace BibleOnSite.Services;

#if ANDROID || IOS
using Plugin.Firebase.Analytics;
#endif

/// <summary>
/// Firebase Analytics on Android and iOS (same project as legacy app: tanah-al-haperek).
/// No-op on other platforms. Gracefully degrades when Firebase isn't initialized (e.g. iOS 26
/// where the SDK crashes during init — see MauiProgram.IsFirebaseInitialized).
/// </summary>
public sealed class AnalyticsService : IAnalyticsService
{
	// The e2e marker also gates managed events here: collection is disabled at
	// the SDK layer for marked launches, but this keeps custom events no-ops
	// even if a persisted flag ever let the SDK stay enabled. DISABLE_ANALYTICS
	// builds (Debug/e2e — see DisableAnalytics in the csproj) never emit at all.
	private static bool IsAvailable =>
#if DISABLE_ANALYTICS
		false;
#elif ANDROID
		!SearchIndexService.IsE2eMarkedProcess();
#elif IOS
		MauiProgram.IsFirebaseInitialized && !SearchIndexService.IsE2eMarkedProcess();
#else
		false;
#endif

	public void SetScreen(string screenName, string? screenClassOverride = null)
	{
#if ANDROID || IOS
		if (!IsAvailable) return;
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
#if ANDROID || IOS
		if (!IsAvailable) return;
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

