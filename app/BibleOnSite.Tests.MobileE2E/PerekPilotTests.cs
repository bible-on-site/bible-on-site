using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// One device per matrix runner; scenarios on that device run sequentially.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class PerekPilotTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions)
    : MobileDeviceTest(output, sessions)
{
    [Fact]
    public void StartupDisplaysPackagedPesukimAndUsableBottomNavigation() => Scenario(() =>
    {
        Assert.NotEmpty(Page.Source);
        Assert.NotEmpty(Page.FirstPasuk);
        Page.AssertBottomNavigationLayout();
    });

    [Fact]
    public void AdjacentPerekNavigationChangesTheTextAndReturnsToTheOriginal() => Scenario(() =>
    {
        var source = Page.Source;
        var pasuk = Page.FirstPasuk;
        Page.OpenCircularMenu();
        var next = Page.WaitFor("NextPerekButton");
        var forward = next.Enabled ? "NextPerekButton" : "PrevPerekButton";
        var backward = next.Enabled ? "PrevPerekButton" : "NextPerekButton";
        Page.Tap(forward);
        Page.WaitFor("PerekSource", element => element.Text != source);
        Page.WaitFor("PasukText", element => !string.IsNullOrWhiteSpace(element.Text) && element.Text != pasuk);
        // Satellite navigation keeps the menu open for further chapter changes.
        Page.Tap(backward);
        Page.WaitFor("PerekSource", element => element.Text == source);
        Page.WaitFor("PasukText", element => element.Text == pasuk);
        Page.AssertBottomNavigationLayout();
    });

    [Fact]
    public void NativeFlyoutOpensPreferencesAndBackReturnsToThePerek() => Scenario(() =>
    {
        var source = Page.Source;
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutPreferences");
        Assert.True(Page.WaitFor("FontFactorSlider").Enabled);
        Assert.True(Page.WaitFor("PerekTodaysRadio").Enabled);
        Assert.True(Page.WaitFor("PerekLastRadio").Enabled);
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSource", element => element.Text == source);
        Page.AssertBottomNavigationLayout();
    });
}
