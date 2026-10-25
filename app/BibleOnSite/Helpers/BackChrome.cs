using BibleOnSite.Services;

namespace BibleOnSite.Helpers;

/// <summary>
/// Applies <see cref="BackChromePolicy"/> to a navigated page (#2467): the
/// Shell nav-bar Back/Up arrow on pages that keep the native bar, and the
/// shared "BackButton" of custom-chrome pages. Invoked by the Shell on every
/// navigation and again when the Android preference changes, so both existing
/// and newly opened pages pick up the current choice. Visibility only —
/// system Back, gestures, history, and modal dismissal are untouched.
/// </summary>
public static class BackChrome
{
	public static BackChromePlatform CurrentPlatform =>
#if ANDROID
		BackChromePlatform.Android;
#elif WINDOWS
		BackChromePlatform.Windows;
#elif IOS || MACCATALYST
		BackChromePlatform.Apple;
#else
		BackChromePlatform.Other;
#endif

	public static void Apply(ContentPage page)
	{
		var show = BackChromePolicy.ShowInAppBack(CurrentPlatform, PreferencesService.Instance.InAppBackButton);
		if (page is BibleOnSite.Controls.PreferencesPageBase preferences)
		{
			preferences.ShowBack = show;
		}

		// Pages that hide the nav bar (reader, custom-chrome pages) own their
		// chrome; a hidden bar makes the behavior moot, and PerekPage toggles
		// it for search state on its own.
		if (Shell.GetNavBarIsVisible(page))
		{
			var isPushed = page.Navigation.NavigationStack.Count > 1;
			Shell.SetBackButtonBehavior(page, new BackButtonBehavior
			{
				IsVisible = BackChromePolicy.ShowNavBarBack(isPushed, CurrentPlatform,
					PreferencesService.Instance.InAppBackButton),
			});
		}

		// Custom-chrome pushed pages name their in-content "חזור" button
		// "BackButton"; on Android it follows the same preference.
		if (Microsoft.Maui.Controls.Internals.NameScope.GetNameScope(page)
				?.FindByName("BackButton") is VisualElement backButton)
		{
			backButton.IsVisible = show;
		}
	}
}
