using BibleOnSite.Helpers;

namespace BibleOnSite.Pages;

/// <summary>
/// Windows desktop surface contract for the shared keyboard layer in
/// Platforms/Windows/DesktopWindowChrome (#2766): Alt+Left/Esc peel this
/// page's transient surfaces through the existing reader Back chain, and
/// Ctrl+F opens the parasha search.
/// </summary>
public partial class ParashaPage : IWindowsDesktopSurface, IWindowsSearchSurface
{
	bool IWindowsDesktopSurface.DismissTopmostSurface() => TryHandleReaderBack();

	void IWindowsDesktopSurface.FocusInitialElement()
	{
		if (Shell.Current?.CurrentPage == this && !ChapterSearch.IsSearchOpen)
		{
			NormalNavigationBar.NavigationButton.Focus();
		}
	}

	void IWindowsSearchSurface.OpenDesktopSearch() => OnParashaSourceClicked(this, EventArgs.Empty);
}
