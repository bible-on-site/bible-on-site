using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Ordering rules behind <see cref="AppShell"/>'s back hook: dismissal first
/// (evaluated by the caller), then page/navigation handling, then the
/// single-Back exit confirmation only when the press would leave the app.
/// </summary>
public class BackExitPlanTests
{
	[Fact]
	public void Evaluate_WhenShellHandledBack_ReturnsConsume()
	{
		BackExitPlan.Evaluate(navigationInFlight: false, shellBack: () => true, flyoutPresented: false,
				hasInAppHistory: false)
			.Should().Be(BackExitAction.Consume);
	}

	[Fact]
	public void Evaluate_WhenShellHandledBackWhileFlyoutPresented_ReturnsConsume()
	{
		// A consumed press must not fall through to the exit confirmation even
		// if the flyout happened to be open.
		BackExitPlan.Evaluate(navigationInFlight: false, shellBack: () => true, flyoutPresented: true,
				hasInAppHistory: true)
			.Should().Be(BackExitAction.Consume);
	}

	[Fact]
	public void Evaluate_WhenFlyoutPresentedAndUnhandled_ReturnsDeferToNative()
	{
		// The drawer layout owns the open flyout: keeping the press propagating
		// lets its own back callback close the flyout rather than confirm exit.
		BackExitPlan.Evaluate(navigationInFlight: false, shellBack: () => false, flyoutPresented: true,
				hasInAppHistory: false)
			.Should().Be(BackExitAction.DeferToNative);
	}

	[Fact]
	public void Evaluate_WhenUnhandledAtRoot_ReturnsConfirmExit()
	{
		BackExitPlan.Evaluate(navigationInFlight: false, shellBack: () => false, flyoutPresented: false,
				hasInAppHistory: false)
			.Should().Be(BackExitAction.ConfirmExit);
	}

	[Fact]
	public void Evaluate_WhenUnhandledWithPushedPages_ReturnsDeferToNative()
	{
		// Since MAUI 10.0.120 the iOS edge-swipe gesture runs this hook before
		// popping: the base Shell pipeline answers false and lets the gesture
		// perform the pop itself. Treating that false as "at root" shows the
		// exit confirmation and cancels the gesture's own pop.
		BackExitPlan.Evaluate(navigationInFlight: false, shellBack: () => false, flyoutPresented: false,
				hasInAppHistory: true)
			.Should().Be(BackExitAction.DeferToNative);
	}

	[Fact]
	public void Evaluate_WhenNavigationInFlight_ConsumesWithoutRunningTheShellPipeline()
	{
		// A press arriving mid-navigation must not run the Shell pipeline a
		// second time: the extra pass can pop the page beneath the one already
		// transitioning out, leaving an empty surface after the user stays.
		var shellRan = false;
		BackExitPlan.Evaluate(navigationInFlight: true, shellBack: () =>
		{
			shellRan = true;
			return false;
		}, flyoutPresented: false, hasInAppHistory: true)
			.Should().Be(BackExitAction.Consume);
		shellRan.Should().BeFalse("an in-flight navigation already owns the outcome of this press");
	}
}
