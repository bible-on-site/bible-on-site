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
		BackExitPlan.Evaluate(shellHandled: true, flyoutPresented: false)
			.Should().Be(BackExitAction.Consume);
	}

	[Fact]
	public void Evaluate_WhenShellHandledBackWhileFlyoutPresented_ReturnsConsume()
	{
		// A consumed press must not fall through to the exit confirmation even
		// if the flyout happened to be open.
		BackExitPlan.Evaluate(shellHandled: true, flyoutPresented: true)
			.Should().Be(BackExitAction.Consume);
	}

	[Fact]
	public void Evaluate_WhenFlyoutPresentedAndUnhandled_ReturnsDeferToNative()
	{
		// The drawer layout owns the open flyout: keeping the press propagating
		// lets its own back callback close the flyout rather than confirm exit.
		BackExitPlan.Evaluate(shellHandled: false, flyoutPresented: true)
			.Should().Be(BackExitAction.DeferToNative);
	}

	[Fact]
	public void Evaluate_WhenUnhandledAtRoot_ReturnsConfirmExit()
	{
		BackExitPlan.Evaluate(shellHandled: false, flyoutPresented: false)
			.Should().Be(BackExitAction.ConfirmExit);
	}
}
