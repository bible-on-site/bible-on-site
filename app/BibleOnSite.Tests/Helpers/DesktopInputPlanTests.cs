using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Shared Windows keyboard/mouse precedence (#2766): Alt+Left and the mouse
/// Back button share one pipeline — open flyout → page surface → in-app
/// navigation; Esc only peels surfaces and never navigates.
/// </summary>
public class DesktopInputPlanTests
{
    [Fact]
    public void Back_FlyoutOpen_ClosesFlyoutFirst()
    {
        DesktopInputPlan.EvaluateBack(flyoutOpen: true, surfaceDismissed: false, hasInAppHistory: false)
            .Should().Be(DesktopBackRoute.CloseFlyout);
    }

    [Fact]
    public void Back_FlyoutOpen_TakesPrecedenceOverSurfaceAndHistory()
    {
        DesktopInputPlan.EvaluateBack(flyoutOpen: true, surfaceDismissed: true, hasInAppHistory: true)
            .Should().Be(DesktopBackRoute.CloseFlyout);
    }

    [Fact]
    public void Back_SurfaceDismissed_ConsumesBeforeNavigation()
    {
        DesktopInputPlan.EvaluateBack(flyoutOpen: false, surfaceDismissed: true, hasInAppHistory: true)
            .Should().Be(DesktopBackRoute.Consume);
    }

    [Fact]
    public void Back_NothingDismissed_WithHistory_Navigates()
    {
        DesktopInputPlan.EvaluateBack(flyoutOpen: false, surfaceDismissed: false, hasInAppHistory: true)
            .Should().Be(DesktopBackRoute.NavigateBack);
    }

    [Fact]
    public void Back_NothingDismissed_AtRoot_Consumes()
    {
        // Alt+Left/mouse-back never exits the app — exit confirmation lives
        // behind the title-bar Back and the window close button only.
        DesktopInputPlan.EvaluateBack(flyoutOpen: false, surfaceDismissed: false, hasInAppHistory: false)
            .Should().Be(DesktopBackRoute.Consume);
    }

    [Fact]
    public void Escape_FlyoutOpen_IsHandled()
    {
        DesktopInputPlan.EvaluateEscape(flyoutOpen: true, surfaceDismissed: false).Should().BeTrue();
    }

    [Fact]
    public void Escape_SurfaceDismissed_IsHandled()
    {
        DesktopInputPlan.EvaluateEscape(flyoutOpen: false, surfaceDismissed: true).Should().BeTrue();
    }

    [Fact]
    public void Escape_NothingToPeel_StaysUnhandled()
    {
        // Even with in-app history available, Esc never navigates.
        DesktopInputPlan.EvaluateEscape(flyoutOpen: false, surfaceDismissed: false).Should().BeFalse();
    }
}
