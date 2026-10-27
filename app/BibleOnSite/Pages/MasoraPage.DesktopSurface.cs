using BibleOnSite.Helpers;

namespace BibleOnSite.Pages;

/// <summary>
/// Windows desktop surface contract for the shared keyboard layer in
/// Platforms/Windows/DesktopWindowChrome (#2766): Alt+Left/Esc peel this
/// page's transient surfaces through the existing reader Back chain.
/// The masora reader has no in-page search surface, so it does not
/// implement <see cref="IWindowsSearchSurface"/>.
/// </summary>
public partial class MasoraPage : IWindowsDesktopSurface
{
	bool IWindowsDesktopSurface.DismissTopmostSurface() => TryHandleReaderBack();

	void IWindowsDesktopSurface.FocusInitialElement()
	{
		if (Shell.Current?.CurrentPage == this)
		{
			NormalNavigationBar.NavigationButton.Focus();
		}
	}
}
