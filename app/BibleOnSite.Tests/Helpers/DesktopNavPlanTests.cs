using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The Windows adaptive nav pane's transition contract (#2766): the flyout
/// locks into a pinned pane at/above the breakpoint, the collapse choice
/// survives narrow crossings, and a pinned pane never counts as a
/// Back-peelable overlay.
/// </summary>
public class DesktopNavPlanTests
{
	private static readonly DesktopNavPaneState FlyoutPinned = new() { Locked = false, PanePinned = true };
	private static readonly DesktopNavPaneState FlyoutCollapsed = new() { Locked = false, PanePinned = false };
	private static readonly DesktopNavPaneState LockedOpen = new() { Locked = true, PanePinned = true };
	private static readonly DesktopNavPaneState LockedCollapsed = new() { Locked = true, PanePinned = false };

	private static readonly double Wide = DesktopLayout.NavPaneBreakpoint + 100;
	private static readonly double Narrow = DesktopLayout.NavPaneBreakpoint - 100;

	[Fact]
	public void UseLockedPane_OnlyAtOrAboveTheBreakpoint()
	{
		DesktopNavPlan.UseLockedPane(DesktopLayout.NavPaneBreakpoint).Should().BeTrue();
		DesktopNavPlan.UseLockedPane(DesktopLayout.NavPaneBreakpoint - 1).Should().BeFalse();
	}

	[Fact]
	public void ForWidth_SameMode_KeepsStateAndPresentationUntouched()
	{
		// A resize inside one mode must not fight the user's toggle.
		DesktopNavPlan.ForWidth(LockedCollapsed, presented: false, Wide)
			.Should().Be((LockedCollapsed, false));
		DesktopNavPlan.ForWidth(FlyoutPinned, presented: true, Narrow)
			.Should().Be((FlyoutPinned, true));
	}

	[Fact]
	public void ForWidth_WideningWithClosedOverlay_RestoresRememberedPin()
	{
		var (state, presented) = DesktopNavPlan.ForWidth(FlyoutCollapsed, presented: false, Wide);

		state.Should().Be(LockedCollapsed, "the user collapsed the pane earlier — it stays collapsed");
		presented.Should().BeFalse();
	}

	[Fact]
	public void ForWidth_WideningWithOpenOverlay_TreatsItAsRevealIntent()
	{
		var (state, presented) = DesktopNavPlan.ForWidth(FlyoutCollapsed, presented: true, Wide);

		state.PanePinned.Should().BeTrue("an open overlay means the user wanted the nav visible");
		presented.Should().BeTrue();
	}

	[Fact]
	public void ForWidth_Widening_DefaultPinned_OpensThePane()
	{
		DesktopNavPlan.ForWidth(FlyoutPinned, presented: false, Wide)
			.Should().Be((LockedOpen, true));
	}

	[Fact]
	public void ForWidth_Narrowing_LandsClosedAndKeepsThePin()
	{
		var (state, presented) = DesktopNavPlan.ForWidth(LockedOpen, presented: true, Narrow);

		state.Should().Be(FlyoutPinned, "the pin is remembered for the next widening");
		presented.Should().BeFalse("a resize must never pop the modal flyout over content");
	}

	[Fact]
	public void ForWidth_NarrowingCollapsedPane_KeepsTheCollapsedChoice()
	{
		DesktopNavPlan.ForWidth(LockedCollapsed, presented: false, Narrow)
			.State.Should().Be(FlyoutCollapsed);
	}

	[Fact]
	public void Toggle_Locked_FlipsThePinAndPresentationTogether()
	{
		DesktopNavPlan.Toggle(LockedOpen, presented: true)
			.Should().Be((LockedCollapsed, false));
		DesktopNavPlan.Toggle(LockedCollapsed, presented: false)
			.Should().Be((LockedOpen, true));
	}

	[Fact]
	public void Toggle_Flyout_TogglesTheOverlayWithoutTouchingThePin()
	{
		DesktopNavPlan.Toggle(FlyoutPinned, presented: false)
			.Should().Be((FlyoutPinned, true));
		DesktopNavPlan.Toggle(FlyoutPinned, presented: true)
			.Should().Be((FlyoutPinned, false));
	}

	[Fact]
	public void PresentedAfterDestination_Flyout_ClosesTheOverlay()
	{
		DesktopNavPlan.PresentedAfterDestination(FlyoutPinned, presented: true).Should().BeFalse();
	}

	[Fact]
	public void PresentedAfterDestination_Locked_KeepsThePane()
	{
		DesktopNavPlan.PresentedAfterDestination(LockedOpen, presented: true).Should().BeTrue();
	}

	[Fact]
	public void OverlayBlocksBack_OnlyInFlyoutMode()
	{
		DesktopNavPlan.OverlayBlocksBack(FlyoutPinned, presented: true).Should().BeTrue();
		DesktopNavPlan.OverlayBlocksBack(LockedOpen, presented: true)
			.Should().BeFalse("the pinned pane is persistent chrome — Back never peels it");
		DesktopNavPlan.OverlayBlocksBack(FlyoutPinned, presented: false).Should().BeFalse();
	}
}
