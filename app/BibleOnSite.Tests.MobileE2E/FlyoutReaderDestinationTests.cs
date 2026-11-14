using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// #3263: flyout reader destinations carry their own division identity —
// choosing על הפרק while a parasha unit is open must activate the perek
// reader, not reselect whichever reader the location ended on. The unit
// tests cover the route matrix; this scenario is the rendered evidence
// for the reported four-step flow on a real device surface.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class FlyoutReaderDestinationTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    [Fact]
    public void AlHaperekFromTheParashaReaderActivatesThePerekReader() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);

        // פרשה על הפרק → בראשית — a foreign-division reader is now active.
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutParasha");
        // iOS exposes the row as one accessible element and folds its child
        // labels into the announced heading. Target that actual tap surface,
        // retaining a single snapshot lookup and the existing tap deadline.
        var bereshit = Page.RenderedElements("ParashaUnit1",
            element => Platform.SemanticDescription(element) ?? element.Text).Single();
        Assert.Equal("בראשית", bereshit.Text);
        Platform.Tap(Driver!, bereshit.Element);
        Page.WaitFor("ParashaSource", element => !string.IsNullOrEmpty(element.Text));
        SaveDiagnostics("ParashaReaderOpen", "passed");

        // על הפרק — the perek division must take over, toolbar and all.
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutAlHaperek");

        Page.WaitFor("PerekSource", element => !string.IsNullOrEmpty(element.Text));
        Assert.Empty(Page.RenderedElements("ParashaSource"));
        Assert.Empty(Page.RenderedElements("ParashaUnitHeading"));
        Assert.NotEmpty(Page.FirstPasuk);
        SaveDiagnostics("PerekReaderActive", "passed");
    });
}
