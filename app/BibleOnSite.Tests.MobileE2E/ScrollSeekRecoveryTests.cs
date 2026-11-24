using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// #3746's merge group was ejected when the display-preferences seek in
// FirebaseEmulatorSyncTests timed out: one scroll step can carry the target
// across the viewport (the injected drag releases with fling inertia), a
// fully offscreen node is absent from the source tree, and the
// downward-only seek then had no way back. This scenario forces exactly
// that overshot state — the switch scrolled past the top edge — and asserts
// the seek still reaches it.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class ScrollSeekRecoveryTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    [Fact]
    public void SeekRecoversAStepOvershotPastTheViewport() => Scenario(() =>
    {
        Page.Tap(Platform.FlyoutButton);
        // The last drawer row sits below the fold on taller drawers (CI's
        // Pixel 7); scroll the drawer to it rather than tapping blind, then
        // tap through the page helper so a recycled view re-resolves.
        Page.ScrollFlyoutTo("FlyoutPreferences");
        Page.Tap("FlyoutPreferences");
        Page.Tap("SettingsDisplayRow");
        // Drive the switch above the viewport before the seek begins: the
        // page's scroll surface is taller than the window, so a burst of
        // steps lands past the target and prunes it from the source tree.
        // Assert the overshoot actually happened — if the switch never left
        // the viewport, the seek never reverses and proves nothing.
        var id = "DivineNameMaskingSwitch";
        Assert.True(ScrolledOffscreen(id, () => Platform.ScrollPageDown(Driver!)),
            $"the display preferences never scrolled {id} off the viewport");
        Assert.NotNull(Page.ScrollToVisible(id));
    });

    [Fact]
    public void SeekRecoversAnOvershotFlyoutItem() => Scenario(() =>
    {
        Page.Tap(Platform.FlyoutButton);
        // The drawer's ScrollView carries no AutomationId on Android; a drawer
        // item marks it open.
        Page.WaitFor("FlyoutAlHaperek");
        // Same overshoot inside the flyout drawer on its FIRST row: a bottom
        // row can never pass the top edge (the scroll clamps at the end), but
        // a leading row does once deeper items fill the viewport. At densities
        // where the item list already fits the drawer (the Android CI
        // emulator), nothing can scroll off — skip rather than assert an
        // unreachable precondition.
        var id = "FlyoutAlHaperek";
        if (!ScrolledOffscreen(id, () => Page.DragFlyoutSurface(down: true)))
        {
            Assert.Skip($"the flyout fits its viewport at this density, so {id} cannot overshoot");
        }
        Assert.NotNull(Page.ScrollFlyoutTo(id));
    });

    // Scrolls down until `id` was displayed and then left the viewport,
    // proving the seek must reverse to recover it — not merely that it never
    // rendered. Android prunes an offscreen node from the source tree; iOS
    // keeps it with visible=false, so the display flag is the shared signal.
    private bool ScrolledOffscreen(string id, Action scrollDown)
    {
        var locator = Platform.AutomationId(id);
        var wasDisplayed = Displayed(locator) is true;
        for (var step = 0; step < 8; step++)
        {
            scrollDown();
            var displayed = Displayed(locator);
            // A stale mid-read is no observation; counting it as "not
            // displayed" would pass the assert without a real overshoot.
            if (displayed == null)
            {
                continue;
            }
            if (wasDisplayed && !displayed.Value)
            {
                return true;
            }
            wasDisplayed |= displayed.Value;
        }
        return false;
    }

    // null when the tree churned mid-read: no observation either way.
    private bool? Displayed(OpenQA.Selenium.By locator)
    {
        try
        {
            return Driver!.FindElements(locator).Any(element => element.Displayed);
        }
        catch (OpenQA.Selenium.StaleElementReferenceException)
        {
            return null;
        }
    }
}
