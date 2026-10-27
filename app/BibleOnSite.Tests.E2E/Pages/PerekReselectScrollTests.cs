using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;
using FlaUI.Core.Input;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>Offline app instance for reader tests that need no API.</summary>
public sealed class OfflineReaderFixture : AppFixture
{
    protected override bool RequiresApi => false;
}

[CollectionDefinition("Offline reader", DisableParallelization = true)]
public sealed class OfflineReaderCollection : ICollectionFixture<OfflineReaderFixture>;

/// <summary>
/// #2624: while scripture is already active, tapping the bottom bar's א ב ג
/// tab animates the visible perek's vertical content back to its start — the
/// same perek, same reader, no reload. Captures native before/after frames.
/// </summary>
[Collection("Offline reader")]
public sealed class PerekReselectScrollTests(OfflineReaderFixture fixture)
{
    [Fact]
    public async Task TextTabReselect_ReturnsScrolledPerekToItsFirstPasuk()
    {
        // A deterministic long perek (31 pesukim) regardless of today's reading.
        await NavigateToBereshitAlephAsync();
        var list = fixture.FindByAutomationId("PasukimCollection");
        list.Should().NotBeNull("the regular reader's pasuk list is on screen");
        var listTop = list!.BoundingRectangle.Top;

        FirstVisiblePasuk().Name.Should().StartWith("א ", "the perek opens at its first pasuk");

        ScrollReaderDown(list);
        var scrolled = await WaitForFirstPasukNotAsync("א ");
        scrolled.Should().BeTrue("the wheel gestures must actually move the list before the reselect");
        CaptureScreenshot("reselect-scrolled.png");

        var button = fixture.FindByAutomationId("TextButton");
        button.Should().NotBeNull("the bottom bar's text tab is the reselect trigger");
        fixture.Click(button!);

        var backAtTop = await WaitForFirstPasukAsync("א ");
        backAtTop.Should().BeTrue("reselecting א ב ג scrolls the active list back to its first pasuk");
        var first = FirstVisiblePasuk();
        (first.BoundingRectangle.Top - listTop).Should().BeLessThanOrEqualTo(120,
            "the first pasuk lands at the top of the list, beneath the perek header");
        fixture.FindByAutomationId("PerekSource")!.Name.Should().Be("בראשית א",
            "the reselect keeps the same perek — no navigation or reload");
        CaptureScreenshot("reselect-top.png");
    }

    private async Task NavigateToBereshitAlephAsync()
    {
        // Reuse the offline search path: query the perek and open its result —
        // the same sequence FloatingSearchBarTests drives, on the packaged index.
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
        Keyboard.Type("בראשית 1");
        (await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchStatus")) is { } status
                && System.Text.RegularExpressions.Regex.IsMatch(status.Name, @"^\d+ תוצאות$") ? status : null,
            TimeSpan.FromSeconds(90))).Should().NotBeNull("search must finish before selecting a result");
        var result = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"))
                ?.FindFirstDescendant(fixture.CF.ByName("בראשית א")), TimeSpan.FromSeconds(45));
        result.Should().NotBeNull("the chapter result must appear for the query");
        fixture.MainWindow.Focus();
        fixture.Click(result!);
        var landed = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSource").And(fixture.CF.ByName("בראשית א"))),
            TimeSpan.FromSeconds(30));
        landed.Should().NotBeNull("the reader opens בראשית א after the search result tap");
    }

    /// <summary>Wheel-scrolls the reader down a few screens.</summary>
    private void ScrollReaderDown(AutomationElement list)
    {
        fixture.MainWindow.Focus();
        var bounds = list.BoundingRectangle;
        var point = new System.Drawing.Point(
            (int)(bounds.Left + bounds.Width / 2), (int)(bounds.Top + bounds.Height / 2));
        Mouse.MoveTo(point);
        for (var i = 0; i < 6; i++)
        {
            // Negative wheel delta scrolls the content down, revealing later pesukim.
            Mouse.Scroll(-4);
        }
    }

    /// <summary>The topmost rendered pasuk row — document order tracks the list top.</summary>
    private AutomationElement FirstVisiblePasuk() =>
        fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId("PasukText"))
            .First(element => !element.IsOffscreen && !string.IsNullOrWhiteSpace(element.Name));

    private async Task<bool> WaitForFirstPasukNotAsync(string prefix)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            if (!FirstVisiblePasuk().Name.StartsWith(prefix, StringComparison.Ordinal))
            {
                return true;
            }
            await Task.Delay(250, TestContext.Current.CancellationToken);
        }
        return false;
    }

    private async Task<bool> WaitForFirstPasukAsync(string prefix)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            if (FirstVisiblePasuk().Name.StartsWith(prefix, StringComparison.Ordinal))
            {
                return true;
            }
            await Task.Delay(250, TestContext.Current.CancellationToken);
        }
        return false;
    }

    private void CaptureScreenshot(string name)
    {
        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        Capture.Element(fixture.MainWindow).ToFile(Path.Join(artifacts, name));
    }
}
