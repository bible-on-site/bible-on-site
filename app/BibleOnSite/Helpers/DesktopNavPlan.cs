namespace BibleOnSite.Helpers;

/// <summary>
/// The Shell's adaptive navigation-pane entry point (#2766). The shared
/// top bar targets this interface rather than the concrete AppShell so the
/// hamburger's toggle contract stays unit-testable without XAML code-behind.
/// </summary>
public interface IAdaptiveNavPane
{
	/// <summary>One hamburger action for both presentations: toggles the
	/// pinned pane when the window locks the flyout, the overlay otherwise.</summary>
	void ToggleNavPane();
}

/// <summary>
/// The desktop navigation pane's persistent state (#2766): whether the
/// window is wide enough to pin the flyout open beside the content, and
/// whether the user left that pinned pane expanded or collapsed.
/// </summary>
public readonly record struct DesktopNavPaneState
{
	/// <summary>The Shell flyout is locked into an always-visible side pane.</summary>
	public required bool Locked { get; init; }

	/// <summary>The user's collapse choice for the locked pane. Survives
	/// narrow-window crossings so re-widening restores it.</summary>
	public required bool PanePinned { get; init; }
}

/// <summary>
/// Pure decision logic for the Windows adaptive navigation pane (#2766),
/// kept platform-free so the collapse/reveal rules stay unit-testable:
///
/// - Wide window (content width ≥ <see cref="DesktopLayout.NavPaneBreakpoint"/>):
///   the flyout locks into a persistent navigation pane. Entering locked
///   mode treats an open overlay as reveal intent — the pane shows pinned
///   and that becomes the remembered pin.
/// - Narrow window: back to the overlay flyout, landing closed; the pin
///   choice is kept untouched for the next crossing back.
/// - Hamburger: toggles the pinned pane in locked mode, the overlay
///   otherwise — one action for both presentations.
/// - Destination row: the overlay closes behind the new page; a pinned
///   pane stays put so navigation keeps its rail.
/// </summary>
public static class DesktopNavPlan
{
	/// <summary>Whether the window's content width supports a pinned nav pane.</summary>
	public static bool UseLockedPane(double contentWidth) =>
		contentWidth >= DesktopLayout.NavPaneBreakpoint;

	/// <summary>
	/// Re-evaluates the pane for a new window width.
	/// </summary>
	/// <param name="current">Current locked/pinned state.</param>
	/// <param name="presented">The live FlyoutIsPresented value.</param>
	/// <param name="contentWidth">Window content width in dips.</param>
	/// <returns>The new state and the FlyoutIsPresented value to apply.</returns>
	public static (DesktopNavPaneState State, bool Presented) ForWidth(
		DesktopNavPaneState current, bool presented, double contentWidth)
	{
		var locked = UseLockedPane(contentWidth);
		if (locked == current.Locked)
		{
			return (current, presented);
		}

		if (locked)
		{
			// Crossing with the overlay open is a reveal intent: the pane
			// lands pinned and remembers it.
			var pinned = current.PanePinned || presented;
			return (new DesktopNavPaneState { Locked = true, PanePinned = pinned }, pinned);
		}

		// Wide→narrow: keep the remembered pin, land with the overlay closed
		// — narrowing the window must not pop a modal over the content.
		return (current with { Locked = false }, false);
	}

	/// <summary>
	/// The hamburger: collapses/expands the pinned pane in locked mode and
	/// toggles the overlay in flyout mode (where the button is unreachable
	/// while the overlay covers it, so a press there still always opens).
	/// </summary>
	public static (DesktopNavPaneState State, bool Presented) Toggle(
		DesktopNavPaneState current, bool presented)
		=> current.Locked
			? (current with { PanePinned = !current.PanePinned }, !current.PanePinned)
			: (current, !presented);

	/// <summary>
	/// A flyout destination was activated: the overlay closes behind the
	/// navigation; a pinned pane stays so the rail keeps showing where the
	/// user is.
	/// </summary>
	public static bool PresentedAfterDestination(DesktopNavPaneState state, bool presented) =>
		state.Locked && presented;

	/// <summary>
	/// Whether the open flyout is a transient overlay that Back/Esc must
	/// peel. A locked pane is persistent chrome — like the window's own
	/// frame it is never a dismissal target.
	/// </summary>
	public static bool OverlayBlocksBack(DesktopNavPaneState state, bool presented) =>
		!state.Locked && presented;
}
