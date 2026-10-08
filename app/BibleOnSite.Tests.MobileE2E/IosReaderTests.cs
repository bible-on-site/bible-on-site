using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// Regression coverage for iPhone issues #1306 and #1308. The RTL navigation
// drawer must open on a right-edge swipe even though the perek carousel listens
// on the same touches, and the reader must span the window width in landscape
// instead of sitting inside symmetric safe-area bands.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "iOS")]
public sealed class IosReaderTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions) : IAsyncLifetime
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
    public void RightEdgeSwipeOpensAndScrimTapClosesTheFlyout() => Scenario(() =>
    {
        _platform.OpenFlyoutViaRightEdgeSwipe(_driver!);
        Assert.True(_page.WaitFor("FlyoutPreferences", element => element.Enabled).Displayed);
        _platform.DismissFlyoutViaScrim(_driver!);
        _page.WaitForHidden("FlyoutPreferences");
        Assert.NotEmpty(_page.Source);
    });

    [Fact]
    public void LandscapeReaderSpansTheWindowWidth() => Scenario(() =>
    {
        try
        {
            _driver!.Orientation = ScreenOrientation.Landscape;
            var window = WaitForLandscapeWindow();
            var frame = _page.WaitForStableFrame("PasukimCollection");
            Assert.True(frame.Location.X <= 24,
                $"PasukimCollection starts {frame.Location.X}pt from the left of a {window.Width}pt window: " +
                "the reader keeps its small page margin but must not sit inside the landscape safe-area band (#1308).");
            Assert.True(frame.Location.X + frame.Size.Width >= window.Width - 24,
                $"PasukimCollection ends {window.Width - frame.Location.X - frame.Size.Width}pt before the right of a {window.Width}pt window: " +
                "the reader keeps its small page margin but must not sit inside the landscape safe-area band (#1308).");
        }
        finally
        {
            _driver!.Orientation = ScreenOrientation.Portrait;
        }
    });

    private Size WaitForLandscapeWindow()
    {
        var timeout = TimeSpan.FromSeconds(15);
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            var size = _driver!.Manage().Window.Size;
            if (size.Width > size.Height)
            {
                return size;
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"The simulator never reported a landscape window within {timeout.TotalSeconds} seconds.");
    }

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
