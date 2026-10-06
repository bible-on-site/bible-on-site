using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Interactions;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// Regression test for TestFlight crash F0AF3C74 (5.0.121): HtmlView's
// NSAttributedString NSHTML import ran synchronously on the main thread while
// UICollectionView prefetched pasuk cells. The import's nested run loop
// re-entered _updateVisibleCellsNow: and aborted the app. Rapid flick scrolls
// force cell prefetch/recycle churn that reliably surfaced the crash.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "iOS")]
public sealed class PerekScrollStabilityTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions) : IAsyncLifetime
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
        _page.WaitForStartup();
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _driver?.Quit();
        _driver?.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public void RapidPasukScrollingKeepsTheAppAlive()
    {
        var list = _page.WaitFor("PasukimCollection");
        var location = list.Location;
        var size = list.Size;
        var centerX = location.X + size.Width / 2;
        var topY = location.Y + size.Height / 5;
        var bottomY = location.Y + size.Height * 4 / 5;

        // Fast back-to-back flicks maximize prefetch churn: cells are created,
        // dequeued and recycled while perushim HTML is being imported.
        for (var i = 0; i < 40; i++)
        {
            _driver!.PerformActions([CreateFlickSequence(centerX, bottomY, centerX, topY)]);
        }
        for (var i = 0; i < 40; i++)
        {
            _driver!.PerformActions([CreateFlickSequence(centerX, topY, centerX, bottomY)]);
        }

        var appState = _driver!.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        output.WriteLine($"App state after scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));
        Assert.NotEmpty(_page.Source);
        Assert.NotEmpty(_page.FirstPasuk);
    }

    private static ActionSequence CreateFlickSequence(int fromX, int fromY, int toX, int toY)
    {
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, fromX, fromY, TimeSpan.Zero));
        sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, toX, toY, TimeSpan.FromMilliseconds(120)));
        sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
        return sequence;
    }
}
