using BibleOnSite.Helpers;

namespace BibleOnSite.Pages;

/// <summary>
/// Windows desktop surface contract for the shared keyboard layer in
/// Platforms/Windows/DesktopWindowChrome (#2766): Alt+Left/Esc peel this
/// page's transient surfaces through the existing reader Back chain, and
/// Ctrl+F opens the perek search, and PgUp/PgDn step to the
/// previous/next perek when no transient surface owns input.
/// </summary>
#pragma warning disable S2333 // partial required: PerekPage is split across 5 declaration parts.
public partial class PerekPage : IWindowsDesktopSurface, IWindowsSearchSurface, IWindowsFullscreenSurface,
    IWindowsUnitNavSurface
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

	void IWindowsFullscreenSurface.ToggleDesktopFullscreen()
	{
		if (!ChapterSearch.IsSearchOpen)
		{
			_chrome.ToggleFullScreen();
		}
	}

	bool IWindowsUnitNavSurface.TryNavigateUnit(int direction) => DesktopUnitNavigation.TryStep(
		ResolveBackOwner(), _viewModel.LoadNextCommand, _viewModel.LoadPreviousCommand, direction);
}
