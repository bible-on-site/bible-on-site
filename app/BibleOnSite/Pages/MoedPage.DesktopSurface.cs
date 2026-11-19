using BibleOnSite.Helpers;

namespace BibleOnSite.Pages;

/// <summary>
/// Windows desktop surface contract for the shared keyboard layer in
/// Platforms/Windows/DesktopWindowChrome (#2766): Alt+Left/Esc peel this
/// page's transient surfaces through the existing reader Back chain.
/// The moed reader has no in-page search surface, so it does not
/// implement <see cref="IWindowsSearchSurface"/>; PgUp/PgDn still step
/// moed units when no transient surface owns input.
/// </summary>
#pragma warning disable S2333 // partial required: MoedPage is split across 3 declaration parts.
public partial class MoedPage : IWindowsDesktopSurface, IWindowsFullscreenSurface, IWindowsUnitNavSurface
#pragma warning restore S2333
{
	bool IWindowsDesktopSurface.DismissTopmostSurface() => TryHandleReaderBack();

	void IWindowsDesktopSurface.FocusInitialElement()
	{
		if (Shell.Current?.CurrentPage == this)
		{
			NormalNavigationBar.NavigationButton.Focus();
		}
	}

	void IWindowsFullscreenSurface.ToggleDesktopFullscreen()
	{
		if (Shell.Current?.CurrentPage == this)
		{
			_chrome.ToggleFullScreen();
		}
	}

	bool IWindowsUnitNavSurface.TryNavigateUnit(int direction) => DesktopUnitNavigation.TryStep(
		ResolveBackOwner(), _viewModel.LoadNextCommand, _viewModel.LoadPreviousCommand, direction);
}
