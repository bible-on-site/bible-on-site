using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;
using FlaUI.Core.Input;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>
/// #2839: enabling תיקון קוראים (with שניים מקרא) swaps the pasuk list for the
/// continuous canvas flow. Captures the rendered flow — the 34-Hebrew-letter
/// line cap is a layout rule, so the frame is the device-level evidence.
/// </summary>
[Collection("Offline reader")]
public sealed class TikkunFlowModeTests(OfflineReaderFixture fixture)
{
    [Fact]
    public async Task TikkunKorimMode_RendersTheContinuousFlow()
    {
        await NavigateToBereshitYudAsync();

        foreach (var label in new[] { "שניים מקרא", "תיקון קוראים" })
        {
            // Each row tap also closes the dropdown — reopen it per toggle.
            var menuButton = await fixture.WaitForElementAsync(window =>
                window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuButton"))
                    .FirstOrDefault(button => !button.IsOffscreen), TimeSpan.FromSeconds(30));
            menuButton.Should().NotBeNull("the reader menu button opens the display modes");
            fixture.MainWindow.Focus();
            fixture.Click(menuButton!);

            var row = await fixture.WaitForElementAsync(window =>
                window.FindAllDescendants(fixture.CF.ByName(label))
                    .FirstOrDefault(element => !element.IsOffscreen), TimeSpan.FromSeconds(15));
            row.Should().NotBeNull($"the reader menu exposes {label}");
            fixture.Click(row!);
        }

        // The flow itself is a drawn canvas (no UIA text); its host scroll
        // view proves the mode flipped and the frame below is the artifact.
        var flow = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("TikkunScrollView"))
                .FirstOrDefault(element => !element.IsOffscreen), TimeSpan.FromSeconds(30));
        flow.Should().NotBeNull("תיקון קוראים replaces the pasuk list with the continuous flow");

        // The canvas draws words, not UIA text — the capture is the checkable
        // artifact that lines honor the letter cap and stay intact.
        CaptureScreenshot("tikkun-linecap.png");
    }

    private async Task NavigateToBereshitYudAsync()
    {
        // Same offline search path as PerekReselectScrollTests.
        var source = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSource"))
                .FirstOrDefault(title => !title.IsOffscreen), TimeSpan.FromSeconds(30));
        source.Should().NotBeNull("the reader must finish startup before search opens");
        fixture.MainWindow.Focus();
        fixture.Click(source!);
        var input = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
                .FirstOrDefault(field => !field.IsOffscreen && field.IsEnabled), TimeSpan.FromSeconds(30));
        input.Should().NotBeNull();
        fixture.Click(input!);
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
            .FirstOrDefault(field => field.FrameworkAutomationElement.HasKeyboardFocus)))
            .Should().NotBeNull("typing starts after the native field receives focus");
        Keyboard.TypeSimultaneously(FlaUI.Core.WindowsAPI.VirtualKeyShort.CONTROL, FlaUI.Core.WindowsAPI.VirtualKeyShort.KEY_A);
        Keyboard.Type("בראשית 10");
        (await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchStatus")) is { } status
                && System.Text.RegularExpressions.Regex.IsMatch(status.Name, @"^\d+ תוצאות$") ? status : null,
            TimeSpan.FromSeconds(90))).Should().NotBeNull("search must finish before selecting a result");
        var result = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"))
                ?.FindFirstDescendant(fixture.CF.ByName("בראשית י")), TimeSpan.FromSeconds(45));
        result.Should().NotBeNull("the chapter result must appear for the query");
        fixture.MainWindow.Focus();
        fixture.Click(result!);
        var landed = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSource").And(fixture.CF.ByName("בראשית י"))),
            TimeSpan.FromSeconds(30));
        landed.Should().NotBeNull("the reader opens בראשית י after the search result tap");
    }

    private void CaptureScreenshot(string name)
    {
        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        Capture.Element(fixture.MainWindow).ToFile(Path.Join(artifacts, name));
    }
}
