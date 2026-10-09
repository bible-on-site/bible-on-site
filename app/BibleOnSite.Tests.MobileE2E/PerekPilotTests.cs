using OpenQA.Selenium;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// One device per matrix runner; scenarios on that device run sequentially.
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
        Page.AssertBottomNavigationLayout();
    });

    [Fact]
    public void SearchReplacesTheSourceAndGroupsBooksInThreeColumns() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        AssertRegularReader();
        var source = Page.WaitFor("PerekSource");
        var sourceTop = source.Location.Y;
        var sourceBottom = sourceTop + source.Size.Height;
        Page.Tap("PerekSource");
        var headerInput = Page.WaitFor("PerekSearchInput");
        Assert.InRange(headerInput.Location.Y + headerInput.Size.Height / 2, sourceTop, sourceBottom);
        Page.WaitFor("SearchStatus", element => element.Text == "חיפושים אחרונים");
        Page.WaitFor("RecentSearches");
        Assert.DoesNotContain(Driver!.FindElements(Platform.AutomationId("PerekHeader")), element => element.Displayed);
        var searchPage = Page.WaitFor("SearchPanel");
        Assert.InRange(searchPage.Size.Width, Driver.Manage().Window.Size.Width - 8, Driver.Manage().Window.Size.Width);
        SaveDiagnostics("SearchPageRecentSearches", "passed");
        Page.Tap("SearchKindsTab");
        Page.WaitFor("SearchKindPerek");
        Platform.DismissSearchSheet(Driver);
        Page.WaitForHidden("SearchSheet");
        AssertBookGroupColumns();
        Platform.RevealTrailingSearchChips(Driver);
        Page.Tap("SearchClearAll");
        Page.WaitForHidden("SearchClearAll");
        Page.WaitFor("SearchKindsSummary", element => element.Text == "מה לחפש");
        Page.WaitFor("SearchBooksSummary", element => element.Text == "היכן לחפש");
        Page.Tap("SearchSortButton");
        Page.Tap("SearchSortGeneration");
        Page.WaitForHidden("SearchSheet");
        SearchFor("בראשיט 1", "בראשית א");
        var clear = Page.WaitFor("ClearSearchButton");
        var input = Page.WaitFor("PerekSearchInput");
        var navigation = Page.WaitFor("SearchNavigationButton");
        Assert.True(clear.Location.X + clear.Size.Width <= input.Location.X, "The single clear button follows the text field in RTL.");
        Assert.True(input.Location.X + input.Size.Width <= navigation.Location.X, "Back belongs at the right edge in RTL.");
        Platform.Tap(Driver, Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א"));
        AssertRegularReader();
        Platform.GoBack(Driver);
        Page.WaitFor("PerekSearchInput", element => element.Text == "בראשיט 1");
        Page.Tap("ClearSearchButton");
        Page.WaitFor("RecentSearchPhrase", element => element.Text == "בראשיט 1");
        Platform.Tap(Driver, Page.WaitFor("RecentSearchPhrase", element => element.Text == "בראשיט 1"));
        Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א");
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
        Page.Tap("SearchSheetApplyButton");
        Page.WaitForHidden("SearchSheet");
        SearchFor("בראשיט 1", "בראשית א");
        Platform.Tap(Driver!, Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א"));
        Page.WaitFor("PerekSource", element => element.Text == "בראשית א");
        AssertRegularReader();
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSearchInput", element => element.Text == "בראשיט 1");
        Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א");

        SearchFor("ויעש אלהים את הרקיע", "בראשית א ז");
        Page.WaitFor("SearchStatus", element => System.Text.RegularExpressions.Regex.IsMatch(element.Text, @"^\d+ תוצאות$"));
        SaveDiagnostics("FloatingSearchVerseResults", "passed");
        var result = Driver!.FindElements(Platform.AutomationId("SearchResultTitle"))
            .First(element => element.Displayed && element.Text == "בראשית א ז");
        Platform.Tap(Driver, result);
        AssertRegularReader();
        Page.WaitFor("PasukNumber", element => element.Text == "ז");
        Platform.GoBack(Driver);
        Page.WaitFor("PerekSearchInput", element => element.Text == "ויעש אלהים את הרקיע");
        Page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א ז");
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
        Page.Tap("SearchSheetApplyButton");
        Page.WaitForHidden("SearchSheet");
        SearchFor("בראשית ברא אלהים", "בראשית א א");
        // A fresh installation builds the local index for the entire commentary
        // package. Subsequent result and history assertions use normal deadlines.
        var commentary = Page.WaitFor("SearchResultTitle", element => element.Text.Contains(" - בראשית א א", StringComparison.Ordinal), TimeSpan.FromMinutes(6));
        var title = commentary.Text;
        var commentaryName = title.Split(" - ", StringSplitOptions.None)[0];
        var position = commentary.Location;
        Platform.Tap(driver, commentary);
        AssertRegularReader();
        Page.WaitFor("InlinePerushName", element => element.Text == commentaryName);
        SaveDiagnostics("FloatingSearchCommentaryReader", "passed");
        // Menu navigation must keep this reader above the retained search page.
        var readerSource = Page.Source;
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutPreferences");
        Page.WaitFor("FontFactorSlider");
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
            Page.WaitFor("InlinePerushName", element => element.Text == commentaryName);
            SaveDiagnostics("FloatingSearchReview", "passed");
        }
    });

    private void AssertRegularReader()
    {
        Page.WaitFor("PerekSource", element => !string.IsNullOrEmpty(element.Text));
        Assert.True(Page.WaitFor("ReaderNavigationButton").Enabled);
        Assert.DoesNotContain(Driver!.FindElements(Platform.AutomationId("PerekSearchInput")), element => element.Displayed);
        Assert.DoesNotContain(Driver!.FindElements(Platform.AutomationId("SearchPanel")), element => element.Displayed);
        Assert.DoesNotContain(Driver!.FindElements(Platform.AutomationId("SelectionBackButton")), element => element.Displayed);
        Assert.DoesNotContain(Driver.FindElements(Platform.AutomationId("FocusedPasukText")), element => element.Displayed);
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
        Page.Tap("SearchSheetApplyButton");
        Page.WaitForHidden("SearchSheet");
        // XCTest correctly marks background chips as covered by the sheet.
        // Assert each summary after applying the selection, as a user reads it.
        Page.WaitFor("SearchBooksSummary", element => element.Text == "תורה");
        Page.Tap("SearchBooksTab");
        Page.Tap("SearchBook1");
        Page.Tap("SearchSheetApplyButton");
        Page.WaitForHidden("SearchSheet");
        Page.WaitFor("SearchBooksSummary", element => element.Text == "שמות +3");
        Page.Tap("SearchBooksTab");
        Page.Tap("SearchBook1");
        SaveDiagnostics("FloatingSearchBookColumns", "passed");
        Page.Tap("SearchSheetApplyButton");
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
