using BibleOnSite.Tests.E2E.Fixtures;

namespace BibleOnSite.Tests.E2E.Navigation;

/// <summary>
/// #3263 device-level regression: the reported four-step flow —
/// על הפרק → פרשה על הפרק → בראשית → על הפרק — must activate the perek
/// reader, not reselect the parasha reader the location ended on.
/// </summary>
[Collection(nameof(AppCollection))]
public class FlyoutReaderDestinationTests
{
    private readonly AppFixture _fixture;

    public FlyoutReaderDestinationTests(AppFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>The pinned nav pane shows the flyout rows directly; a narrow
    /// window needs one hamburger press first.</summary>
    private async Task<AutomationElement> FlyoutRowAsync(string automationId)
    {
        var row = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByAutomationId(automationId)),
            TimeSpan.FromSeconds(5));
        if (row != null)
        {
            return row;
        }

        var hamburger = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByAutomationId("ReaderNavigationButton")),
            TimeSpan.FromSeconds(5));
        hamburger.Should().NotBeNull("the reader hamburger must be available to open the flyout");
        _fixture.Click(hamburger!);

        row = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByAutomationId(automationId)),
            TimeSpan.FromSeconds(5));
        row.Should().NotBeNull($"flyout row {automationId} must be reachable");
        return row!;
    }

    [Fact]
    public async Task AlHaperekFromTheParashaReader_ActivatesThePerekReader()
    {
        _fixture.Click(await FlyoutRowAsync("FlyoutParasha"));

        // בראשית — the first unit in the פרשה על הפרק listing.
        var bereshit = await _fixture.WaitForElementAsync(
            window => window.FindAllDescendants(_fixture.CF.ByAutomationId("ParashaName"))
                .FirstOrDefault(element => element.Name == "בראשית"),
            TimeSpan.FromSeconds(10));
        bereshit.Should().NotBeNull("the בראשית row must be listed");
        _fixture.Click(bereshit!);

        var parashaSource = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByAutomationId("ParashaSource")),
            TimeSpan.FromSeconds(10));
        parashaSource.Should().NotBeNull("the parasha reader must be active after opening בראשית");

        _fixture.Click(await FlyoutRowAsync("FlyoutAlHaperek"));

        var perekSource = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByAutomationId("PerekSource")),
            TimeSpan.FromSeconds(10));
        perekSource.Should().NotBeNull("choosing על הפרק must activate the perek reader");
        _fixture.FindByAutomationId("ParashaSource").Should().BeNull(
            "the parasha reader must not stay active after choosing על הפרק");
    }
}
