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
        Page.Tap("FlyoutPreferences");
        Page.Tap("SettingsDisplayRow");
        // Drive the switch above the viewport before the seek begins: the
        // page's scroll surface is taller than the window, so a burst of
        // steps lands past the target and prunes it from the source tree.
        // Assert the overshoot actually happened — if the switch never left
        // the viewport, the seek never reverses and proves nothing.
        var id = "DivineNameMaskingSwitch";
        var overshot = false;
        var lastSurface = Driver!.PageSource;
        for (var step = 0; step < 8 && !overshot; step++)
        {
            Platform.ScrollPageDown(Driver!);
            var surface = Driver!.PageSource;
            overshot = surface != lastSurface && !surface.Contains(id);
            lastSurface = surface;
        }
        Assert.True(overshot, $"the display preferences never scrolled {id} off the viewport");
        Assert.NotNull(Page.ScrollToVisible(id));
    });
}
