using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.Capturing;
using FlaUI.Core.Input;

namespace BibleOnSite.Tests.E2E.Pages;

public sealed class OfflineSearchFixture : AppFixture
{
    protected override bool RequiresApi => false;
}

[CollectionDefinition("Offline search", DisableParallelization = true)]
public sealed class OfflineSearchCollection : ICollectionFixture<OfflineSearchFixture>;

[Collection("Offline search")]
public sealed class FloatingSearchBarTests(OfflineSearchFixture fixture)
{
    [Fact]
    public async Task OfflineSearch_OpensRegularReader_AndBackRestoresQueryAndResults()
    {
        (await fixture.WaitForElementAsync(window =>
        {
            return window.FindAllDescendants(fixture.CF.ByAutomationId("PasukText"))
                .FirstOrDefault(verse => !string.IsNullOrWhiteSpace(verse.Name) && !verse.IsOffscreen);
        }, TimeSpan.FromSeconds(30))).Should().NotBeNull("the reader finishes startup before search interactions");
        fixture.MainWindow.Patterns.Transform.Pattern.Move(20, 20);
        fixture.MainWindow.Patterns.Transform.Pattern.Resize(860, 900);
        var bar = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSearchInput")), TimeSpan.FromSeconds(30));
        bar.Should().NotBeNull();
        var input = bar;
        input.Should().NotBeNull();
        fixture.Click(input!);
        await EnterQueryAsync("בראשיט 1");
        await WaitForFinishedSearchAsync();
        var clear = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("ClearSearchButton")));
        var navigation = fixture.FindByAutomationId("SearchNavigationButton")!;
        var settings = fixture.FindByAutomationId("SearchFiltersButton")!;
        settings.BoundingRectangle.Right.Should().BeLessThanOrEqualTo(clear!.BoundingRectangle.Left);
        clear.BoundingRectangle.Right.Should().BeLessThanOrEqualTo(input.BoundingRectangle.Left);
        input.BoundingRectangle.Right.Should().BeLessThanOrEqualTo(navigation.BoundingRectangle.Left);
        CapturePreview("floating-search-rtl.png");
        fixture.Click(clear);
        input.AsTextBox().Text.Should().BeEmpty("the single X clears the query and keeps search open");
        fixture.Click(navigation);
        fixture.Click(settings);
        (await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchKindPerek"))))
            .Should().NotBeNull("settings are accessible before typing a query");
        fixture.Click(navigation);
        fixture.Click(input);
        await EnterQueryAsync("בראשיט 1");
        await WaitForFinishedSearchAsync();
        var chapter = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"))
            ?.FindFirstDescendant(fixture.CF.ByName("בראשית א")), TimeSpan.FromSeconds(45));
        chapter.Should().NotBeNull("chapter references accept spelling mistakes and Arabic numerals");
        chapter!.IsOffscreen.Should().BeFalse($"the result should be visible at {chapter.BoundingRectangle}");
        CapturePreview("floating-search-chapter.png");
        fixture.MainWindow.Focus();
        fixture.Click(chapter!);
        (await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSource").And(fixture.CF.ByName("בראשית א"))))).Should().NotBeNull();
        await AssertRegularReaderAsync();
        await GoBackToSearchAsync("בראשיט 1");

        bar = fixture.FindByAutomationId("PerekSearchInput");
        input = bar;
        fixture.Click(input!);
        await EnterQueryAsync("ויעש אלהים את הרקיע");
        await WaitForFinishedSearchAsync();
        var filters = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchFiltersButton")));
        fixture.Click(filters!);
        CapturePreview("floating-search-filters.png");
        var chapterFilter = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchKindPerek")));
        chapterFilter!.AsCheckBox().IsChecked = false;
        fixture.Click(filters!);
        await WaitForFinishedSearchAsync();
        var verse = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"))
            ?.FindFirstDescendant(fixture.CF.ByName("בראשית א ז")), TimeSpan.FromSeconds(45));
        CapturePreview("floating-search.png");
        verse.Should().NotBeNull("unpointed text must match the packaged pointed scripture");
        fixture.Click(verse!);
        await AssertRegularReaderAsync();
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PasukNumber"))
            .FirstOrDefault(number => !number.IsOffscreen && number.Name == "ז")))
            .Should().NotBeNull("the ordinary reader scrolls to the selected verse");
        await GoBackToSearchAsync("ויעש אלהים את הרקיע");

        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("SearchResultTitle"))
            .FirstOrDefault(result => !result.IsOffscreen && result.Name == "בראשית א ז")))
            .Should().NotBeNull("Back keeps the result available without typing again");
        CapturePreview("search-restored-after-back.png");
    }

    private async Task AssertRegularReaderAsync()
    {
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
            .FirstOrDefault(field => !field.IsOffscreen && field.AsTextBox().Text == string.Empty)))
            .Should().NotBeNull("results open on a separate ordinary reader page");
        fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId("SelectionBackButton"))
            .Should().NotContain(button => !button.IsOffscreen, "search must not open the blue selection toolbar");
    }

    private async Task EnterQueryAsync(string query)
    {
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
            .FirstOrDefault(field => field.FrameworkAutomationElement.HasKeyboardFocus)))
            .Should().NotBeNull("typing starts after the native field receives focus");
        Keyboard.TypeSimultaneously(FlaUI.Core.WindowsAPI.VirtualKeyShort.CONTROL, FlaUI.Core.WindowsAPI.VirtualKeyShort.KEY_A);
        Keyboard.Type(query);
    }

    private async Task GoBackToSearchAsync(string query)
    {
        var back = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByName("Back")));
        back.Should().NotBeNull("the result is on the standard navigation stack");
        fixture.Click(back!);
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
            .FirstOrDefault(field => !field.IsOffscreen && field.AsTextBox().Text == query)))
            .Should().NotBeNull("Back restores the original search phrase");
    }

    private async Task WaitForFinishedSearchAsync()
    {
        // Query completion can replace the initially published chapter rows.
        (await fixture.WaitForElementAsync(window =>
        {
            var status = window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchStatus"));
            return status != null && System.Text.RegularExpressions.Regex.IsMatch(status.Name, @"^\d+ תוצאות$") ? status : null;
        }, TimeSpan.FromSeconds(90))).Should().NotBeNull("search must finish before selecting a result");
    }

    private void CapturePreview(string name)
    {
        var artifacts = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        Capture.Element(fixture.MainWindow).ToFile(Path.Combine(artifacts, name));
    }
}
