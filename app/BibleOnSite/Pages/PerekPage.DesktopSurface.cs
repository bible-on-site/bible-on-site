using BibleOnSite.Helpers;

namespace BibleOnSite.Pages;

/// <summary>
/// Windows desktop surface contract for the shared keyboard layer in
/// Platforms/Windows/DesktopWindowChrome (#2766): Alt+Left/Esc peel this
/// page's transient surfaces through the existing reader Back chain, and
/// Ctrl+F opens the perek search.
/// </summary>
#pragma warning disable S2333 // partial required: PerekPage is split across 5 declaration parts.
public partial class PerekPage : IWindowsDesktopSurface, IWindowsSearchSurface
#pragma warning restore S2333
{
	bool IWindowsDesktopSurface.DismissTopmostSurface() => TryHandleReaderBack();

	void IWindowsDesktopSurface.FocusInitialElement()
	{
		if (Shell.Current?.CurrentPage == this && !ChapterSearch.IsSearchOpen)
		{
			NormalNavigationBar.NavigationButton.Focus();
		}
	}

	void IWindowsSearchSurface.OpenDesktopSearch() => OnPerekSourceClicked(this, EventArgs.Empty);
}
