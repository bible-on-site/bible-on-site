using BibleOnSite.Tests.E2E.Fixtures;
using BibleOnSite.Tests.E2E.Pages;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;

namespace BibleOnSite.Tests.E2E.Navigation;

/// <summary>
/// #3263 device-level regression: the reported four-step flow —
/// על הפרק → פרשה על הפרק → בראשית → על הפרק — must activate the perek
/// reader, not reselect the parasha reader the location ended on. The two
/// captures (parasha reader active, then perek reader active) are the
/// visual evidence the transition actually switched divisions.
/// </summary>
[Collection("Offline reader")]
public sealed class FlyoutReaderDestinationTests(OfflineReaderFixture fixture)
{
    /// <summary>The pinned nav pane shows the flyout rows directly; a narrow
    /// window needs one hamburger press first.</summary>
    private async Task<AutomationElement> FlyoutRowAsync(string automationId)
    {
        var row = await fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(fixture.CF.ByAutomationId(automationId)),
            TimeSpan.FromSeconds(5));
        if (row != null)
        {
            return row;
        }

        var hamburger = await fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(fixture.CF.ByAutomationId("ReaderNavigationButton")),
            TimeSpan.FromSeconds(5));
        hamburger.Should().NotBeNull("the reader hamburger must be available to open the flyout");
        fixture.Click(hamburger!);

        row = await fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(fixture.CF.ByAutomationId(automationId)),
            TimeSpan.FromSeconds(5));
        row.Should().NotBeNull($"flyout row {automationId} must be reachable");
        return row!;
    }

    [Fact]
    public async Task AlHaperekFromTheParashaReader_ActivatesThePerekReader()
    {
        fixture.MainWindow.Focus();
        fixture.Click(await FlyoutRowAsync("FlyoutParasha"));

        // בראשית — the first unit in the פרשה על הפרק listing.
        var bereshit = await fixture.WaitForElementAsync(
            window => window.FindAllDescendants(fixture.CF.ByAutomationId("ParashaName"))
                .FirstOrDefault(element => element.Name == "בראשית"),
            TimeSpan.FromSeconds(10));
        bereshit.Should().NotBeNull("the בראשית row must be listed");
        fixture.Click(bereshit!);

        var parashaSource = await fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(fixture.CF.ByAutomationId("ParashaSource")),
            TimeSpan.FromSeconds(10));
        parashaSource.Should().NotBeNull("the parasha reader must be active after opening בראשית");
        CaptureScreenshot("flyout-parasha-reader.png");

        fixture.MainWindow.Focus();
        fixture.Click(await FlyoutRowAsync("FlyoutAlHaperek"));

        var perekSource = await fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSource")),
            TimeSpan.FromSeconds(10));
        perekSource.Should().NotBeNull("choosing על הפרק must activate the perek reader");
        fixture.FindByAutomationId("ParashaSource").Should().BeNull(
            "the parasha reader must not stay active after choosing על הפרק");

        // The shared fixture may leave the reader in either display mode,
        // and the two containers are mutually exclusive: list mode shows
        // PasukimCollection with realized PasukText rows, תיקון קוראים mode
        // shows TikkunScrollView with the rendered TikkunText flow. A single
        // wait must accept either — a bare PerekSource could still be the
        // empty reader shell mid-load. TikkunText itself surfaces as soon
        // as the mode flips, but the drawable collapses the view to its
        // 8-unit padding until words layout — a tall bounding box is the
        // realized-content signal there.
        (await fixture.WaitForElementAsync(
            window => window.FindAllDescendants(fixture.CF.ByAutomationId("PasukText"))
                    .FirstOrDefault(element => !element.IsOffscreen && element.Name.Length > 0)
                ?? window.FindAllDescendants(fixture.CF.ByAutomationId("TikkunText"))
                    .FirstOrDefault(element => !element.IsOffscreen
                        && element.BoundingRectangle.Height > 40),
            TimeSpan.FromSeconds(60)))
            .Should().NotBeNull("pasuk content must render in whichever reader mode is active");
        CaptureScreenshot("flyout-back-on-perek-reader.png");
    }

    private void CaptureScreenshot(string name)
    {
        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        Capture.Element(fixture.MainWindow).ToFile(Path.Join(artifacts, name));
    }
}
