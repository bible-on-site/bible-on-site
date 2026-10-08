using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// One device per matrix runner; scenarios on that device run sequentially.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class PerekPilotTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions) : IAsyncLifetime
{
    private readonly MobileTestConfiguration _configuration = MobileTestConfiguration.FromEnvironment();
    private AppiumDriver? _driver;
    private MobilePlatformAdapter _platform = null!;
    private PerekPage _page = null!;

    public Task InitializeAsync()
    {
        _platform = MobilePlatformAdapter.For(_configuration.Platform);
        _driver = sessions.Create(() => _platform.CreateDriver(_configuration.Server, _platform.CreateOptions(_configuration)));
        _page = new(_driver, _platform);
        try
        {
            _page.WaitForStartup();
        }
        catch
        {
            SaveDiagnostics($"SessionStartup-{Guid.NewGuid():N}", "failed");
            throw;
        }
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _driver?.Quit();
        _driver?.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public void StartupDisplaysPackagedPesukimAndUsableBottomNavigation() => Scenario(() =>
    {
        Assert.NotEmpty(_page.Source);
        Assert.NotEmpty(_page.FirstPasuk);
        _page.AssertBottomNavigationLayout();
    });

    [Fact]
    public void SearchReplacesTheSourceAndGroupsBooksInThreeColumns() => Scenario(() =>
    {
        Assert.NotEmpty(_page.FirstPasuk);
        AssertRegularReader();
        var source = _page.WaitFor("PerekSource");
        var chapterTitle = _page.WaitFor("PerekHeader").Text;
        var sourceTop = source.Location.Y;
        var sourceBottom = sourceTop + source.Size.Height;
        _page.Tap("PerekSource");
        var headerInput = _page.WaitFor("PerekSearchInput");
        Assert.InRange(headerInput.Location.Y + headerInput.Size.Height / 2, sourceTop, sourceBottom);
        _page.WaitFor("SearchStatus", element => element.Text == "הקלידו פרק, פסוק, פירוש או שם רב");
        var emptyDropdown = _page.WaitFor("SearchPanel");
        var chapterHeader = _page.WaitFor("PerekHeader", element => element.Text == chapterTitle);
        Assert.True(chapterHeader.Location.Y >= emptyDropdown.Location.Y + emptyDropdown.Size.Height,
            "The empty search hint belongs above the unchanged chapter heading.");
        SaveDiagnostics("FloatingSearchEmptyHint", "passed");
        _page.Tap("SearchFiltersButton");
        _page.WaitFor("SearchKindPerek");
        AssertBookGroupColumns();
        _page.Tap("SearchNavigationButton");
        SearchFor("בראשיט 1", "בראשית א");
        var settings = _page.WaitFor("SearchFiltersButton");
        var clear = _page.WaitFor("ClearSearchButton");
        var input = _page.WaitFor("PerekSearchInput");
        var navigation = _page.WaitFor("SearchNavigationButton");
        Assert.True(settings.Location.X + settings.Size.Width <= clear.Location.X, "Settings belong at the left edge in RTL.");
        Assert.True(clear.Location.X + clear.Size.Width <= input.Location.X, "The single clear button follows the text field in RTL.");
        Assert.True(input.Location.X + input.Size.Width <= navigation.Location.X, "Back belongs at the right edge in RTL.");
        _page.Tap("ClearSearchButton");
        _page.WaitFor("SearchStatus", element => element.Text == "הקלידו פרק, פסוק, פירוש או שם רב");
        var panel = _page.WaitFor("SearchPanel");
        var panelBottom = panel.Location.Y + panel.Size.Height;
        _platform.Tap(_driver!, _page.WaitFor("PasukText", element => element.Location.Y >= panelBottom));
        AssertRegularReader();
        SaveDiagnostics("FloatingSearchDismissedByVerse", "passed");
    });

    [Fact]
    public void FloatingSearchFindsMisspelledChapterAndUnpointedVerse() => Scenario(() =>
    {
        Assert.NotEmpty(_page.FirstPasuk);
        AssertRegularReader();
        _page.Tap("PerekSource");
        _page.Tap("SearchFiltersButton");
        if (_platform.IsChecked(_page.WaitFor("SearchKindPerush")))
        {
            _page.Tap("SearchKindPerush");
        }
        _page.Tap("SearchFiltersButton");
        SearchFor("בראשיט 1", "בראשית א");
        _platform.Tap(_driver!, _page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א"));
        _page.WaitFor("PerekSource", element => element.Text == "בראשית א");
        AssertRegularReader();
        _platform.GoBack(_driver!);
        _page.WaitFor("PerekSearchInput", element => element.Text == "בראשיט 1");
        _page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א");

        SearchFor("ויעש אלהים את הרקיע", "בראשית א ז");
        _page.WaitFor("SearchStatus", element => System.Text.RegularExpressions.Regex.IsMatch(element.Text, @"^\d+ תוצאות$"));
        SaveDiagnostics("FloatingSearchVerseResults", "passed");
        var result = _driver!.FindElements(_platform.AutomationId("SearchResultTitle"))
            .First(element => element.Displayed && element.Text == "בראשית א ז");
        _platform.Tap(_driver, result);
        AssertRegularReader();
        _page.WaitFor("PasukNumber", element => element.Text == "ז");
        _platform.GoBack(_driver);
        _page.WaitFor("PerekSearchInput", element => element.Text == "ויעש אלהים את הרקיע");
        _page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א ז");
        _page.Tap("SearchNavigationButton");
        AssertRegularReader();
    });

    [Fact]
    public void FloatingSearchCommentaryJumpRestoresPhraseResultsAndPosition() => Scenario(() =>
    {
        var driver = _driver!;
        Assert.NotEmpty(_page.FirstPasuk);
        AssertRegularReader();
        _page.Tap("PerekSource");
        _page.Tap("SearchFiltersButton");
        if (!_platform.IsChecked(_page.WaitFor("SearchKindPerush")))
        {
            _page.Tap("SearchKindPerush");
        }
        _page.Tap("SearchFiltersButton");
        SearchFor("בראשית ברא אלהים", "בראשית א א");
        // A fresh installation builds the local index for the entire commentary
        // package. Subsequent result and history assertions use normal deadlines.
        var commentary = _page.WaitFor("SearchResultTitle", element => element.Text.Contains(" - בראשית א א", StringComparison.Ordinal), TimeSpan.FromMinutes(6));
        var title = commentary.Text;
        var commentaryName = title.Split(" - ", StringSplitOptions.None)[0];
        var position = commentary.Location;
        _platform.Tap(driver, commentary);
        AssertRegularReader();
        _page.WaitFor("InlinePerushName", element => element.Text == commentaryName);
        SaveDiagnostics("FloatingSearchCommentaryReader", "passed");
        // Menu navigation must keep this reader above the retained search page.
        var readerSource = _page.Source;
        _page.Tap(_platform.FlyoutButton);
        _page.Tap("FlyoutPreferences");
        _page.WaitFor("FontFactorSlider");
        _platform.GoBack(driver);
        _page.WaitFor("PerekSource", element => element.Text == readerSource);
        _page.WaitFor("InlinePerushName", element => element.Text == commentaryName);
        AssertRegularReader();
        _platform.GoBack(driver);
        _page.WaitFor("PerekSearchInput", element => element.Text == "בראשית ברא אלהים");
        var restored = _page.WaitFor("SearchResultTitle", element => element.Text == title);
        Assert.Equal(position, restored.Location);
        var alternative = _page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א א");
        _platform.Tap(driver, alternative);
        AssertRegularReader();
        _platform.GoBack(driver);
        _page.WaitFor("PerekSearchInput", element => element.Text == "בראשית ברא אלהים");
        if (_configuration.KeepAppForReview)
        {
            _platform.Tap(driver, _page.WaitFor("SearchResultTitle", element => element.Text == title));
            AssertRegularReader();
            _page.WaitFor("InlinePerushName", element => element.Text == commentaryName);
            SaveDiagnostics("FloatingSearchReview", "passed");
        }
    });

    private void AssertRegularReader()
    {
        _page.WaitFor("PerekSource", element => !string.IsNullOrEmpty(element.Text));
        Assert.True(_page.WaitFor("ReaderMenuButton").Enabled);
        Assert.DoesNotContain(_driver!.FindElements(_platform.AutomationId("PerekSearchInput")), element => element.Displayed);
        Assert.DoesNotContain(_driver!.FindElements(_platform.AutomationId("SearchPanel")), element => element.Displayed);
        Assert.DoesNotContain(_driver!.FindElements(_platform.AutomationId("SelectionBackButton")), element => element.Displayed);
        Assert.DoesNotContain(_driver.FindElements(_platform.AutomationId("FocusedPasukText")), element => element.Displayed);
    }

    private void SearchFor(string text, string expectedTitle)
    {
        if (!_driver!.FindElements(_platform.AutomationId("PerekSearchInput")).Any(element => element.Displayed))
        {
            _page.Tap("PerekSource");
        }
        var bar = _page.WaitFor("PerekSearchInput", element => element.Enabled);
        _platform.Tap(_driver!, bar);
        var input = bar.TagName.Contains("TextView", StringComparison.Ordinal) || bar.TagName.Contains("EditText", StringComparison.Ordinal) || bar.TagName.Contains("SearchField", StringComparison.Ordinal) || bar.TagName.Contains("TextField", StringComparison.Ordinal)
            ? bar : bar.FindElement(By.XPath(".//*[@class='android.widget.EditText' or @class='android.widget.AutoCompleteTextView' or @type='XCUIElementTypeSearchField' or @type='XCUIElementTypeTextField']"));
        input.Clear();
        input.SendKeys(text);
        _page.WaitFor("SearchResultTitle", element => element.Text == expectedTitle);
    }

    private void AssertBookGroupColumns()
    {
        _page.Tap("SearchBooksTab");
        var torah = _page.WaitFor("SearchGroup1");
        var neviim = _page.WaitFor("SearchGroup2");
        var ketuvim = _page.WaitFor("SearchGroup3");
        Assert.True(torah.Location.X > neviim.Location.X && neviim.Location.X > ketuvim.Location.X);
        Assert.Equal(torah.Location.Y, neviim.Location.Y);
        Assert.Equal(torah.Location.Y, ketuvim.Location.Y);
        Assert.True(_page.WaitFor("SearchBook1").Location.Y > torah.Location.Y);
        _page.Tap("SearchGroup1");
        _page.WaitFor("SearchBook1", element => !_platform.IsChecked(element));
        _page.WaitFor("SearchBook2", element => !_platform.IsChecked(element));
        Assert.True(_platform.IsChecked(_page.WaitFor("SearchGroup2")));
        Assert.True(_platform.IsChecked(_page.WaitFor("SearchGroup3")));
        _page.Tap("SearchBook1");
        _page.WaitFor("SearchBook1", element => _platform.IsChecked(element));
        Assert.False(_platform.IsChecked(_page.WaitFor("SearchGroup1")));
        _page.Tap("SearchGroup1");
        _page.WaitFor("SearchBook2", element => _platform.IsChecked(element));
        SaveDiagnostics("FloatingSearchBookColumns", "passed");
        _page.Tap("SearchKindsTab");
    }

    [Fact]
    public void AdjacentPerekNavigationChangesTheTextAndReturnsToTheOriginal() => Scenario(() =>
    {
        var source = _page.Source;
        var pasuk = _page.FirstPasuk;
        _page.OpenCircularMenu();
        var next = _page.WaitFor("NextPerekButton");
        var forward = next.Enabled ? "NextPerekButton" : "PrevPerekButton";
        var backward = next.Enabled ? "PrevPerekButton" : "NextPerekButton";
        _page.Tap(forward);
        _page.WaitFor("PerekSource", element => element.Text != source);
        _page.WaitFor("PasukText", element => !string.IsNullOrWhiteSpace(element.Text) && element.Text != pasuk);
        // Satellite navigation keeps the menu open for further chapter changes.
        _page.Tap(backward);
        _page.WaitFor("PerekSource", element => element.Text == source);
        _page.WaitFor("PasukText", element => element.Text == pasuk);
        _page.AssertBottomNavigationLayout();
    });

    [Fact]
    public void NativeFlyoutOpensPreferencesAndBackReturnsToThePerek() => Scenario(() =>
    {
        var source = _page.Source;
        _page.Tap(_platform.FlyoutButton);
        _page.Tap("FlyoutPreferences");
        Assert.True(_page.WaitFor("FontFactorSlider").Enabled);
        Assert.True(_page.WaitFor("PerekTodaysRadio").Enabled);
        Assert.True(_page.WaitFor("PerekLastRadio").Enabled);
        _platform.GoBack(_driver!);
        _page.WaitFor("PerekSource", element => element.Text == source);
        _page.AssertBottomNavigationLayout();
    });

    private void Scenario(Action run, [System.Runtime.CompilerServices.CallerMemberName] string name = "")
    {
        try
        {
            run();
            SaveDiagnostics(name, "passed");
        }
        catch
        {
            SaveDiagnostics(name, "failed");
            throw;
        }
    }

    private void SaveDiagnostics(string name, string outcome)
    {
        var prefix = Path.Join(_configuration.ArtifactDirectory, $"{name}-{outcome}");
        Directory.CreateDirectory(_configuration.ArtifactDirectory);
        try
        {
            _driver!.GetScreenshot().SaveAsFile(prefix + ".png");
            File.WriteAllText(prefix + ".xml", _driver.PageSource);
        }
        catch (WebDriverException exception)
        {
            // Preserve the scenario failure when a crashed app prevents diagnostics.
            File.WriteAllText(prefix + "-diagnostics-error.txt", exception.ToString());
            output.WriteLine($"Could not capture device diagnostics: {exception}");
            if (outcome == "passed")
            {
                throw;
            }
        }
        output.WriteLine($"{_configuration.Platform}: {name} {outcome}; artifacts: {prefix}");
    }
}

[CollectionDefinition("Mobile device", DisableParallelization = true)]
public sealed class MobileDeviceCollection : ICollectionFixture<MobileDeviceSessionFactory>;
