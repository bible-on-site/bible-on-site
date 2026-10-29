using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>
/// Platform the Back/Up policy is evaluated for, kept as a parameter so the
/// rule stays unit-testable off-device.
/// </summary>
public enum BackChromePlatform
{
	Android,
	Apple,
	Windows,
	Other,
}

/// <summary>
/// Shared visibility rule for the in-app Back/Up affordance (#2467).
///
/// Platform defaults follow each platform's navigation guidance:
/// - Android relies on the system Back path (button, gesture, predictive
///   Back) which is already routed through the shared Shell back pipeline;
///   no duplicate in-app button is shown by default. The persisted
///   <see cref="InAppBackButtonPreference"/> override applies on Android only.
/// - iOS/iPadOS have no universal system Back, so pushed pages keep a
///   discoverable in-app control next to the native edge-swipe Back.
/// - Windows keeps Back in the window title bar (plus Alt+Left); the
///   Android override must not leak into Windows behavior.
/// The rule covers visibility only — it never disables OS Back, gesture
/// handling, navigation history, or modal dismissal.
/// </summary>
public static class BackChromePolicy
{
	/// <summary>
	/// Whether a pushed page shows an in-app Back/Up control (the custom
	/// "חזור" button of custom-chrome pages and the Shell nav-bar arrow).
	/// </summary>
	public static bool ShowInAppBack(BackChromePlatform platform, InAppBackButtonPreference preference)
	{
		if (platform == BackChromePlatform.Android)
		{
			// Default and Hide both rely on system Back; only an explicit
			// Show opt-in duplicates it in the app chrome.
			return preference == InAppBackButtonPreference.Show;
		}

		return true;
	}

	/// <summary>
	/// Whether the <see cref="Controls.SharedTopBar"/> capsule reserves its
	/// Back slot. Same visibility rule as the in-app control, except Windows:
	/// Windows Back lives exclusively in the window title bar (plus Alt+Left),
	/// so an in-content capsule button would be a second Windows Back (#2467).
	/// </summary>
	public static bool ShowCapsuleBack(BackChromePlatform platform,
		InAppBackButtonPreference preference) =>
		platform != BackChromePlatform.Windows && ShowInAppBack(platform, preference);

	/// <summary>
	/// Whether the Shell nav-bar Back/Up arrow is shown. Up is navigation
	/// history only: at a root destination there is no in-app arrow at all,
	/// so it can never become an app-exit button.
	/// </summary>
	public static bool ShowNavBarBack(bool isPushed, BackChromePlatform platform,
		InAppBackButtonPreference preference) =>
		isPushed && ShowInAppBack(platform, preference);
}
