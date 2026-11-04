using BibleOnSite.Controls;
using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>
/// Applies <see cref="BackChromePolicy"/> to a navigated page (#2467): the
/// Shell nav-bar Back/Up arrow on any page that still keeps the native bar,
/// and the hamburger/Back capsule of every <see cref="SharedTopBar"/> in the
/// page — including the ones inside a preferences control template. Invoked
/// by the Shell on every navigation and again when the Android preference
/// changes, so both existing and newly opened pages pick up the current
/// choice. Visibility and enabled-state only — system Back, gestures,
/// history, and modal dismissal are untouched.
/// </summary>
public static class BackChrome
{
	/// <summary>
	/// Test seam for the chrome policy (#2927): unit tests pin the persisted
	/// first-frame Back visibility under Android's own rule — the path whose
	/// late correction used to reflow the article header — without a device.
	/// Null outside tests.
	/// </summary>
	internal static BackChromePlatform? TestPlatform { get; set; }

	/// <summary>The platform this binary was compiled for — the fixed
	/// platform default before the persisted override applies.</summary>
	internal static BackChromePlatform CompileTimePlatform =>
#if ANDROID
		BackChromePlatform.Android;
#elif WINDOWS
		BackChromePlatform.Windows;
#elif IOS || MACCATALYST
		BackChromePlatform.Apple;
#else
		BackChromePlatform.Other;
#endif

	public static BackChromePlatform CurrentPlatform =>
		TestPlatform ?? CompileTimePlatform;

	public static void Apply(ContentPage page)
	{
		var preference = PreferencesService.Instance.InAppBackButton;
		var capsuleShow = BackChromePolicy.ShowCapsuleBack(CurrentPlatform, preference);
		if (page is PreferencesPageBase preferences)
		{
			preferences.ShowBack = capsuleShow;
		}

		// Pages that hide the nav bar (every migrated page) own their chrome —
		// a hidden bar makes the behavior moot, and PerekPage toggles it for
		// search state on its own.
		if (Shell.GetNavBarIsVisible(page))
		{
			var isPushed = page.Navigation.NavigationStack.Count > 1;
			Shell.SetBackButtonBehavior(page, new BackButtonBehavior
			{
				IsVisible = BackChromePolicy.ShowNavBarBack(isPushed, CurrentPlatform, preference),
			});
		}

		var stackDepth = page.Navigation.NavigationStack.Count;
		foreach (var bar in page.GetVisualTreeDescendants().OfType<SharedTopBar>())
		{
			bar.ShowBack = capsuleShow;
			bar.RefreshBackState(stackDepth);
		}
	}
}
