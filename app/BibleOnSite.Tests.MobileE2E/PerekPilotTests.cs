using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// One device per matrix runner; scenarios on that device run sequentially.
// iOS shards the suite across per-shard runners (#2263): each runner executes
// the case manifest the dynamic planner assigned it. Android runs every
// applicable scenario on one emulator.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class PerekPilotTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    [Fact]
    public void StartupDisplaysPackagedPesukimAndUsableBottomNavigation() => Scenario(() =>
    {
        Assert.NotEmpty(Page.Source);
        Assert.NotEmpty(Page.FirstPasuk);
        Assert.Empty(Driver!.FindElements(Platform.AutomationId("RecitationDecoder")));
        Page.AssertBottomNavigationLayout();
    });

    [Fact]
    public void SearchReplacesTheSourceAndGroupsBooksInThreeColumns() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        AssertRegularReader();
        // RenderedElements returns text and frame inside one lookup response —
        // on iOS that spares a Location+Size round-trip pair per element.
        var source = Page.RenderedElements("PerekSource").First();
        var sourceTop = source.Frame.Location.Y;
        var sourceBottom = sourceTop + source.Frame.Size.Height;
        Page.Tap("PerekSource");
        var headerInput = Page.RenderedElements("PerekSearchInput").First();
        Assert.InRange(headerInput.Frame.Location.Y + headerInput.Frame.Size.Height / 2, sourceTop, sourceBottom);
        Page.WaitFor("SearchStatus", element => element.Text == "חיפושים אחרונים");
        Page.WaitFor("RecentSearches");
        Assert.Empty(Page.RenderedElements("PerekHeader"));
        var searchPage = Page.RenderedElements("SearchPanel").First();
        var windowWidth = DriverTelemetry.WindowSize(Driver!).Width;
        Assert.InRange(searchPage.Frame.Size.Width, windowWidth - 8, windowWidth);
        SaveDiagnostics("SearchPageRecentSearches", "passed");
        Page.Tap("SearchKindsTab");
        Page.WaitFor("SearchKindPerek");
        Platform.DismissSearchSheet(Driver!);
        Page.WaitForHidden("SearchSheet");
        AssertBookGroupColumns();
        Platform.RevealTrailingSearchChips(Driver!);
        Page.Tap("SearchClearAll");
        Page.WaitForHidden("SearchClearAll");
        Page.WaitFor("SearchKindsSummary", element => element.Text == "מה לחפש");
        Page.WaitFor("SearchBooksSummary", element => element.Text == "היכן לחפש");
        Page.Tap("SearchSortButton");
        Page.Tap("SearchSortGeneration");
        Page.WaitForHidden("SearchSheet");
        SearchFor("בראשיט 1", "בראשית א");
        var clear = Page.RenderedElements("ClearSearchButton").First();
        var input = Page.RenderedElements("PerekSearchInput").First();
        var navigation = Page.RenderedElements("SearchNavigationButton").First();
        Assert.True(clear.Frame.Location.X + clear.Frame.Size.Width <= input.Frame.Location.X, "The single clear button follows the text field in RTL.");
        Assert.True(input.Frame.Location.X + input.Frame.Size.Width <= navigation.Frame.Location.X, "Back belongs at the right edge in RTL.");
        Platform.Tap(Driver!, Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א"));
        AssertRegularReader();
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSearchInput", element => element.Text == "בראשיט 1");
        Page.Tap("ClearSearchButton");
        Page.WaitFor("RecentSearchPhrase", element => element.Text == "בראשיט 1");
        Platform.Tap(Driver!, Page.WaitFor("RecentSearchPhrase", element => element.Text == "בראשיט 1"));
        Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א");
        SaveDiagnostics("RecentSearchRestoredResults", "passed");
        Page.Tap("SearchNavigationButton");
        AssertRegularReader();
        SaveDiagnostics("SearchPageClosed", "passed");
    });

    [Fact]
    public void FloatingSearchFindsMisspelledChapterAndUnpointedVerse() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        AssertRegularReader();
        Page.Tap("PerekSource");
        Page.Tap("SearchKindsTab");
        if (Platform.IsChecked(Page.WaitFor("SearchKindPerush")))
        {
            Page.Tap("SearchKindPerush");
        }
        Platform.DismissSearchSheet(Driver!);
        Page.WaitForHidden("SearchSheet");
        SearchFor("בראשיט 1", "בראשית א");
        SaveDiagnostics("FloatingSearchChapterResults", "passed");
        Platform.Tap(Driver!, Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א"));
        Page.WaitFor("PerekSource", element => element.Text == "בראשית א");
        AssertRegularReader();
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSearchInput", element => element.Text == "בראשיט 1");
        Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א");

        SearchFor("ויעש אלהים את הרקיע", "בראשית א ז");
        Page.WaitFor("SearchStatus", element => System.Text.RegularExpressions.Regex.IsMatch(element.Text, @"^\d+ תוצאות$"));
        SaveDiagnostics("FloatingSearchVerseResults", "passed");
        // One snapshot read carries every result's text — the previous
        // FindElements + per-element Displayed/Text reads cost 2N+1 WDA calls.
        var result = Page.RenderedElements("SearchResultTitle")
            .First(element => element.Text == "בראשית א ז");
        Platform.Tap(Driver!, result.Element);
        AssertRegularReader();
        Page.WaitFor("PasukText", element => element.Text.StartsWith("ז "));
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSearchInput", element => element.Text == "ויעש אלהים את הרקיע");
        Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א ז");
        SaveDiagnostics("FloatingSearchVerseReturn", "passed");
        Page.Tap("SearchNavigationButton");
        AssertRegularReader();
    });

    [Fact]
    public void FloatingSearchCommentaryJumpRestoresPhraseResultsAndPosition() => Scenario(() =>
    {
        var driver = Driver!;
        Assert.NotEmpty(Page.FirstPasuk);
        AssertRegularReader();
        Page.Tap("PerekSource");
        Page.Tap("SearchKindsTab");
        if (!Platform.IsChecked(Page.WaitFor("SearchKindPerush")))
        {
            Page.Tap("SearchKindPerush");
        }
        Platform.DismissSearchSheet(Driver!);
        Page.WaitForHidden("SearchSheet");
        SearchFor("בראשית ברא אלהים", "בראשית א א");
        // CI ships the generation-matched index; this must be an ordinary local query.
        var (title, position) = OpenCommentaryResult(" - בראשית א א", "בראשית ברא אלהים");
        var commentaryName = title.Split(" - ", StringSplitOptions.None)[0];
        // Capture the highlighted match, then scroll back to the selected heading.
        SaveDiagnostics("FloatingSearchCommentaryLanding", "passed");
        Page.ScrollBackTo("InlinePerushName", commentaryName);
        SaveDiagnostics("FloatingSearchCommentaryReader", "passed");
        // Menu navigation must keep this reader above the retained search page.
        var readerSource = Page.Source;
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutPreferences");
        Page.WaitFor("SettingsDisplayRow");
        Page.Tap("SettingsDisplayRow");
        Page.WaitFor("FontFactorSlider");
        Platform.GoBack(driver);
        Page.WaitFor("SettingsDisplayRow");
        Platform.GoBack(driver);
        Page.WaitFor("PerekSource", element => element.Text == readerSource);
        Page.WaitFor("InlinePerushName", element => element.Text == commentaryName);
        AssertRegularReader();
        Platform.GoBack(driver);
        Page.WaitFor("PerekSearchInput", element => element.Text == "בראשית ברא אלהים");
        var restored = Page.WaitFor("SearchResultTitle", element => element.Text == title);
        Assert.Equal(position, restored.Location);
        var alternative = Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א א");
        Platform.Tap(driver, alternative);
        AssertRegularReader();
        Platform.GoBack(driver);
        Page.WaitFor("PerekSearchInput", element => element.Text == "בראשית ברא אלהים");
        if (Configuration.KeepAppForReview)
        {
            Platform.Tap(driver, Page.WaitFor("SearchResultTitle", element => element.Text == title));
            AssertRegularReader();
            Page.ScrollBackTo("InlinePerushName", commentaryName);
            SaveDiagnostics("FloatingSearchReview", "passed");
        }
    });

    private void AssertRegularReader()
    {
        Page.WaitFor("PerekSource", element => !string.IsNullOrEmpty(element.Text));
        Assert.True(Page.WaitFor("ReaderNavigationButton").Enabled);
        Assert.DoesNotContain(Driver!.FindElements(
            Platform.AnyOfAutomationIds("PerekSearchInput", "SearchPanel", "SelectionBackButton", "FocusedPasukText")),
            element => element.Displayed);
    }

    private void SearchFor(string text, string expectedTitle)
    {
        if (!Driver!.FindElements(Platform.AutomationId("PerekSearchInput")).Any(element => element.Displayed))
        {
            Page.Tap("PerekSource");
        }
        var bar = Page.WaitFor("PerekSearchInput", element => element.Enabled);
        Platform.Tap(Driver!, bar);
        var input = bar.TagName.Contains("TextView", StringComparison.Ordinal) || bar.TagName.Contains("EditText", StringComparison.Ordinal) || bar.TagName.Contains("SearchField", StringComparison.Ordinal) || bar.TagName.Contains("TextField", StringComparison.Ordinal)
            ? bar : bar.FindElement(By.XPath(".//*[@class='android.widget.EditText' or @class='android.widget.AutoCompleteTextView' or @type='XCUIElementTypeSearchField' or @type='XCUIElementTypeTextField']"));
        input.Clear();
        input.SendKeys(text);
        Page.WaitFor("SearchResultTitle", element => element.Text == expectedTitle);
    }

    // Commentary matches arrive on the slowest results wave, and a later
    // publish can still move rows between resolving the element and the
    // coordinate tap dispatching — a stray touch lands on a sibling row and
    // opens no perush. Settle the row's frame, tap, and if no commentary
    // reader appeared go back to the retained search page and tap once more.
    private (string Title, System.Drawing.Point Position) OpenCommentaryResult(string rowSuffix, string searchPhrase)
    {
        // The shipped index serves the first search. A missed coordinate tap
        // gets one retry, within the same ordinary interaction deadline.
        for (var attempt = 0; attempt < 2; attempt++)
        {
            var (commentary, _) = WaitForSettledRow(rowSuffix, TimeSpan.FromSeconds(45));
            var title = commentary.Text;
            var position = commentary.Location;
            Platform.Tap(Driver!, commentary);
            AssertRegularReader();
            var commentaryName = title.Split(" - ", StringSplitOptions.None)[0];
            try
            {
                var perushTimeout = attempt == 0 ? TimeSpan.FromSeconds(15) : TimeSpan.FromSeconds(45);
                Page.WaitFor("InlinePerushName", element => element.Text == commentaryName, perushTimeout);
                return (title, position);
            }
            catch (WebDriverTimeoutException) when (attempt == 0)
            {
                Platform.GoBack(Driver!);
                Page.WaitFor("PerekSearchInput", element => element.Text == searchPhrase);
            }
        }
        throw new InvalidOperationException("The commentary tap retry loop exited without returning a result.");
    }

    private (AppiumElement Element, System.Drawing.Rectangle Frame) WaitForSettledRow(string suffix, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        var frame = System.Drawing.Rectangle.Empty;
        while (DateTime.UtcNow < deadline)
        {
            // Read cached row geometry without extra requests to the device.
            var row = Page.RenderedElements("SearchResultTitle")
                .FirstOrDefault(element => element.Text.Contains(suffix, StringComparison.Ordinal));
            if (row.Element != null)
            {
                var current = new System.Drawing.Rectangle(row.Frame.Location, row.Frame.Size);
                if (current == frame)
                {
                    return (row.Element, current);
                }
                frame = current;
            }
            else
            {
                frame = System.Drawing.Rectangle.Empty;
            }
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException($"No settled SearchResultTitle row containing '{suffix}' within {timeout.TotalSeconds} seconds.");
    }

    private void AssertBookGroupColumns()
    {
        Page.Tap("SearchBooksTab");
        var torah = Page.WaitFor("SearchGroup1");
        var neviim = Page.WaitFor("SearchGroup2");
        var ketuvim = Page.WaitFor("SearchGroup3");
        Assert.True(torah.Location.X > neviim.Location.X && neviim.Location.X > ketuvim.Location.X);
        Assert.Equal(torah.Location.Y, neviim.Location.Y);
        Assert.Equal(torah.Location.Y, ketuvim.Location.Y);
        Assert.True(Page.WaitFor("SearchBook1").Location.Y > torah.Location.Y);
        Page.Tap("SearchGroup1");
        Page.WaitFor("SearchBook1", element => !Platform.IsChecked(element));
        Page.WaitFor("SearchBook2", element => !Platform.IsChecked(element));
        Assert.True(Platform.IsChecked(Page.WaitFor("SearchGroup2")));
        Assert.True(Platform.IsChecked(Page.WaitFor("SearchGroup3")));
        Page.Tap("SearchBook1");
        Page.WaitFor("SearchBook1", element => Platform.IsChecked(element));
        Assert.False(Platform.IsChecked(Page.WaitFor("SearchGroup1")));
        Page.Tap("SearchGroup1");
        Page.WaitFor("SearchBook2", element => Platform.IsChecked(element));
        Page.Tap("SearchGroup2");
        Page.Tap("SearchGroup3");
        Platform.DismissSearchSheet(Driver!);
        Page.WaitForHidden("SearchSheet");
        // XCTest correctly marks background chips as covered by the sheet.
        // Assert each summary after applying the selection, as a user reads it.
        Page.WaitFor("SearchBooksSummary", element => element.Text == "תורה");
        Page.Tap("SearchBooksTab");
        Page.Tap("SearchBook1");
        Platform.DismissSearchSheet(Driver!);
        Page.WaitForHidden("SearchSheet");
        Page.WaitFor("SearchBooksSummary", element => element.Text == "שמות +3");
        Page.Tap("SearchBooksTab");
        Page.Tap("SearchBook1");
        SaveDiagnostics("FloatingSearchBookColumns", "passed");
        Platform.DismissSearchSheet(Driver!);
        Page.WaitForHidden("SearchSheet");
        Page.WaitFor("SearchBooksSummary", element => element.Text == "תורה");
    }

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
        // The open menu's scrim covers the reader; XCTest marks covered text
        // invisible, so close the menu before asserting pasuk content.
        Page.Tap("CircularMenuButton");
        Page.WaitFor("PasukText", element => !string.IsNullOrWhiteSpace(element.Text) && element.Text != pasuk);
        Page.OpenCircularMenu();
        // Satellite navigation keeps the menu open for further chapter changes.
        Page.Tap(backward);
        Page.WaitFor("PerekSource", element => element.Text == source);
        Page.Tap("CircularMenuButton");
        Page.WaitFor("PasukText", element => element.Text == pasuk);
        Page.AssertBottomNavigationLayout();
    });

    [Fact]
    public void NativeFlyoutOpensPreferencesAndBackReturnsToThePerek() => Scenario(() =>
    {
        var source = Page.Source;
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutPreferences");
        Assert.True(Page.WaitFor("SettingsDisplayRow").Enabled);
        Assert.True(Page.WaitFor("SettingsPerekRow").Enabled);
        Assert.True(Page.WaitFor("SettingsPacksRow").Enabled);
        Assert.True(Page.WaitFor("RecitationSettingsRow").Enabled);
        Assert.True(Page.WaitFor("SettingsSoundRow").Enabled);
        Assert.True(Page.WaitFor("SettingsSupportRow").Enabled);
        Page.Tap("SettingsDisplayRow");
        Assert.True(Page.WaitFor("FontFactorSlider").Enabled);
        Platform.GoBack(Driver!);
        Page.Tap("SettingsPerekRow");
        Assert.True(Page.WaitFor("PerekTodaysOption").Enabled);
        Assert.True(Page.WaitFor("PerekLastLearntOption").Enabled);
        Platform.GoBack(Driver!);
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSource", element => element.Text == source);
        Page.AssertBottomNavigationLayout();
    });
}
