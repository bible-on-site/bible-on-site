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
    public void FloatingSearchFindsMisspelledChapterAndUnpointedVerse() => Scenario(() =>
    {
        Assert.NotEmpty(_page.FirstPasuk);
        _page.Tap("SearchFiltersButton");
        _page.WaitFor("SearchKindPerek");
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
        SearchFor("בראשיט 1", "בראשית א");
        _platform.Tap(_driver!, _page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א"));
        _page.WaitFor("PerekSource", element => element.Text == "בראשית א");

        SearchFor("בראשית ברא אלהים", "בראשית א א");
        _page.Tap("SearchFiltersButton");
        _page.WaitFor("SearchKindPerush", _ => !_driver!.IsKeyboardShown());
        _page.Tap("SearchKindPerush");
        _page.Tap("SearchFiltersButton");
        _page.WaitFor("SearchStatus", element => System.Text.RegularExpressions.Regex.IsMatch(element.Text, @"^\d+ תוצאות$"));
        SaveDiagnostics("FloatingSearchVerseResults", "passed");
        var result = _driver!.FindElements(_platform.AutomationId("SearchResultTitle"))
            .First(element => element.Displayed && element.Text == "בראשית א א");
        _platform.Tap(_driver, result);
        Assert.Contains("בראשית", System.Text.RegularExpressions.Regex.Replace(_page.WaitFor("FocusedPasukText").Text, @"\p{M}", ""));
        _platform.GoBackFromFocusedVerse(_driver);
        _page.WaitFor("PerekSearchInput");
        if (_configuration.KeepAppForReview)
        {
            SearchFor("בראשית ברא אלהים", "בראשית א א");
            _page.Tap("SearchFiltersButton");
            _page.WaitFor("SearchKindPerush", _ => !_driver.IsKeyboardShown());
            _page.Tap("SearchKindPerush");
            _page.Tap("SearchFiltersButton");
            _page.WaitFor("SearchResultTitle", element => element.Text == "בראשית א א");
            SaveDiagnostics("FloatingSearchReview", "passed");
        }
    });

    private void SearchFor(string text, string expectedTitle)
    {
        var bar = _page.WaitFor("PerekSearchInput");
        _platform.Tap(_driver!, bar);
        var input = bar.TagName.Contains("TextView", StringComparison.Ordinal) || bar.TagName.Contains("EditText", StringComparison.Ordinal) || bar.TagName.Contains("SearchField", StringComparison.Ordinal) || bar.TagName.Contains("TextField", StringComparison.Ordinal)
            ? bar : bar.FindElement(By.XPath(".//*[@class='android.widget.EditText' or @class='android.widget.AutoCompleteTextView' or @type='XCUIElementTypeSearchField' or @type='XCUIElementTypeTextField']"));
        input.Clear();
        input.SendKeys(text);
        _page.WaitFor("SearchResultTitle", element => element.Text == expectedTitle);
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
