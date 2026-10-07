using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.Definitions;
using FlaUI.Core.Capturing;

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
    public async Task OfflineSearch_FindsMisspelledChapter_FiltersVerses_AndOpensFocusedVerse()
    {
        fixture.MainWindow.Patterns.Transform.Pattern.Move(20, 20);
        fixture.MainWindow.Patterns.Transform.Pattern.Resize(860, 900);
        var bar = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSearchInput")), TimeSpan.FromSeconds(30));
        bar.Should().NotBeNull();
        var input = bar!.ControlType == ControlType.Edit ? bar : bar.FindFirstDescendant(fixture.CF.ByControlType(ControlType.Edit));
        input.Should().NotBeNull();
        input!.Focus();
        input.AsTextBox().Text = "בראשיט 1";
        await WaitForFinishedSearchAsync();
        var chapter = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"))
            ?.FindFirstDescendant(fixture.CF.ByName("בראשית א")), TimeSpan.FromSeconds(45));
        chapter.Should().NotBeNull("chapter references accept spelling mistakes and Arabic numerals");
        chapter!.IsOffscreen.Should().BeFalse($"the result should be visible at {chapter.BoundingRectangle}");
        CapturePreview("floating-search-chapter.png");
        fixture.MainWindow.Focus();
        fixture.Click(chapter!);
        (await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSource").And(fixture.CF.ByName("בראשית א"))))).Should().NotBeNull();

        bar = fixture.FindByAutomationId("PerekSearchInput");
        input = bar!.ControlType == ControlType.Edit ? bar : bar.FindFirstDescendant(fixture.CF.ByControlType(ControlType.Edit));
        input!.Focus();
        input.AsTextBox().Text = "בראשית ברא אלהים";
        await WaitForFinishedSearchAsync();
        var filters = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchFiltersButton")));
        fixture.Click(filters!);
        CapturePreview("floating-search-filters.png");
        var chapterFilter = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchKindPerek")));
        chapterFilter!.AsCheckBox().IsChecked = false;
        fixture.Click(filters!);
        await WaitForFinishedSearchAsync();
        var verse = await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"))
            ?.FindFirstDescendant(fixture.CF.ByName("בראשית א א")), TimeSpan.FromSeconds(45));
        CapturePreview("floating-search.png");
        verse.Should().NotBeNull("unpointed text must match the packaged pointed scripture");
        fixture.Click(verse!);
        (await fixture.WaitForElementAsync(window => window.FindFirstDescendant(fixture.CF.ByAutomationId("FocusedPasukText"))))
            .Should().NotBeNull("the selected search result opens its exact verse");
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
