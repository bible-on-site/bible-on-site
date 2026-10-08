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
        try { await VerifyOfflineSearchAsync(); }
        catch
        {
            if (!fixture.App.HasExited)
            {
                CapturePreview("floating-search-failed.png");
            }
            throw;
        }
    }

    private async Task VerifyOfflineSearchAsync()
    {
        (await fixture.WaitForElementAsync(window =>
        {
            return window.FindAllDescendants(fixture.CF.ByAutomationId("PasukText"))
                .FirstOrDefault(verse => !string.IsNullOrWhiteSpace(verse.Name) && !verse.IsOffscreen);
        }, TimeSpan.FromSeconds(30))).Should().NotBeNull("the reader finishes startup before search interactions");
        (await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("ReaderMenuButton"))))
            .Should().NotBeNull("the reader toolbar finishes loading before resizing the window");
        fixture.MainWindow.Patterns.Transform.Pattern.Move(20, 20);
        fixture.MainWindow.Patterns.Transform.Pattern.Resize(860, 900);
        await AssertRegularReaderAsync();
        await OpenSearchAsync();
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
        var emptyStatus = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchStatus")));
        var panelBottom = emptyStatus!.BoundingRectangle.Bottom;
        var outsideVerse = await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PasukText"))
            .FirstOrDefault(verse => !verse.IsOffscreen && verse.BoundingRectangle.Top >= panelBottom));
        outsideVerse.Should().NotBeNull();
        fixture.Click(outsideVerse!);
        await AssertRegularReaderAsync();
        CapturePreview("floating-search-dismissed.png");
        await OpenSearchAsync();
        settings = fixture.FindByAutomationId("SearchFiltersButton")!;
        navigation = fixture.FindByAutomationId("SearchNavigationButton")!;
        fixture.Click(settings);
        (await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchKindPerek"))))
            .Should().NotBeNull("settings are accessible before typing a query");
        fixture.Click(fixture.FindByAutomationId("SearchBooksTab")!);
        var torah = (await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchGroup1"))))!;
        var neviim = fixture.FindByAutomationId("SearchGroup2")!;
        var ketuvim = fixture.FindByAutomationId("SearchGroup3")!;
        torah.BoundingRectangle.Left.Should().BeGreaterThan(neviim.BoundingRectangle.Left);
        neviim.BoundingRectangle.Left.Should().BeGreaterThan(ketuvim.BoundingRectangle.Left);
        torah.AsCheckBox().IsChecked = false;
        fixture.FindByAutomationId("SearchBook1")!.AsCheckBox().IsChecked.Should().BeFalse();
        fixture.FindByAutomationId("SearchBook2")!.AsCheckBox().IsChecked.Should().BeFalse();
        neviim.AsCheckBox().IsChecked.Should().BeTrue();
        torah.AsCheckBox().IsChecked = true;
        fixture.FindByAutomationId("SearchBook2")!.AsCheckBox().IsChecked.Should().BeTrue();
        CapturePreview("floating-search-book-columns.png");
        fixture.Click(fixture.FindByAutomationId("SearchKindsTab")!);
        fixture.Click(navigation);
        await OpenSearchAsync();
        input = fixture.FindByAutomationId("PerekSearchInput")!;
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
        await WaitForFinishedSearchAsync("בראשית א ז");
        var filters = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchFiltersButton")));
        fixture.Click(filters!);
        CapturePreview("floating-search-filters.png");
        var chapterFilter = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchKindPerek")));
        chapterFilter.Should().NotBeNull("the settings panel opens after the verse query finishes");
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
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSource"))
            .FirstOrDefault(source => !source.IsOffscreen)))
            .Should().NotBeNull("the ordinary reader shows its chapter source");
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuButton"))
            .FirstOrDefault(button => !button.IsOffscreen)))
            .Should().NotBeNull("reader jumps keep the usual hamburger");
        fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
            .Should().NotContain(field => !field.IsOffscreen, "search replaces the source only when opened");
        fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId("SelectionBackButton"))
            .Should().NotContain(button => !button.IsOffscreen, "search must not open the blue selection toolbar");
    }

    private async Task OpenSearchAsync()
    {
        var source = await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSource"))
            .FirstOrDefault(title => !title.IsOffscreen));
        source.Should().NotBeNull();
        var bounds = source!.BoundingRectangle;
        fixture.MainWindow.Focus();
        fixture.Click(source);
        var input = await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
            .FirstOrDefault(field => !field.IsOffscreen && field.IsEnabled));
        input.Should().NotBeNull();
        input!.BoundingRectangle.Y.Should().BeLessThanOrEqualTo(bounds.Bottom, "search occupies the source toolbar");
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
        fixture.AssertForeground();
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuButton"))
            .FirstOrDefault(button => button.FrameworkAutomationElement.HasKeyboardFocus)))
            .Should().NotBeNull("reader navigation gives keyboard focus to its toolbar");
        Keyboard.TypeSimultaneously(FlaUI.Core.WindowsAPI.VirtualKeyShort.ALT, FlaUI.Core.WindowsAPI.VirtualKeyShort.LEFT);
        (await fixture.WaitForElementAsync(window => window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
            .FirstOrDefault(field => !field.IsOffscreen && field.AsTextBox().Text == query)))
            .Should().NotBeNull("Back restores the original search phrase");
    }

    private async Task WaitForFinishedSearchAsync(string? expectedTitle = null)
    {
        // Query completion can replace the initially published chapter rows.
        (await fixture.WaitForElementAsync(window =>
        {
            var status = window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchStatus"));
            var results = window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"));
            return status != null && System.Text.RegularExpressions.Regex.IsMatch(status.Name, @"^\d+ תוצאות$")
                && (expectedTitle == null || results?.FindFirstDescendant(fixture.CF.ByName(expectedTitle)) != null) ? status : null;
        }, TimeSpan.FromSeconds(90))).Should().NotBeNull("search must finish before selecting a result");
    }

    private void CapturePreview(string name)
    {
        var artifacts = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        Capture.Element(fixture.MainWindow).ToFile(Path.Combine(artifacts, name));
    }
}
