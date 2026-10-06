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
        CheckFirstPerushIfAvailable();

        var list = _page.WaitFor("PasukimCollection");
        var location = list.Location;
        var size = list.Size;
        var centerX = location.X + size.Width / 2;
        var topY = location.Y + size.Height / 5;
        var bottomY = location.Y + size.Height * 4 / 5;

        // Fast back-to-back flicks maximize prefetch churn: cells are created,
        // dequeued and recycled while perushim HTML is being imported.
        // One native sequence per direction avoids a separate XCTest idle wait
        // and HTTP round trip for every flick. The old 80-command storm reached
        // the hang guard while the app was still alive and responding normally.
        _driver!.PerformActions([CreateFlickSequence(centerX, bottomY, centerX, topY, 40)]);
        _driver.PerformActions([CreateFlickSequence(centerX, topY, centerX, bottomY, 40)]);

        var appState = _driver!.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        output.WriteLine($"App state after scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));
        Assert.NotEmpty(_page.Source);
        Assert.NotEmpty(_page.FirstPasuk);
    }

    // PerushNotes only render (through HtmlView, the crashed code path) when a
    // perush is checked and the perushim notes pack is available on the device.
    // Check the first perush when present; the scroll storm still runs either way.
    private void CheckFirstPerushIfAvailable()
    {
        _page.Tap("PerushimChevronButton");
        // The panel animates up (~250 ms); poll briefly for a rendered checkbox.
        AppiumElement? checkbox = null;
        for (var attempt = 0; attempt < 10 && checkbox == null; attempt++)
        {
            Thread.Sleep(300);
            checkbox = _driver!
                .FindElements(_platform.AutomationId("PerushCheckBox"))
                .FirstOrDefault(element => element.Displayed);
        }
        if (checkbox == null)
        {
            output.WriteLine("No perushim available in this build; scrolling without inline commentary.");
        }
        else
        {
            _platform.Tap(_driver!, checkbox);
            output.WriteLine("Checked the first perush so scrolling churns HtmlView cells.");
        }
        _page.Tap("PerushimChevronButton");
    }

    internal static ActionSequence CreateFlickSequence(int fromX, int fromY, int toX, int toY, int repetitions)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(repetitions);
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        for (var i = 0; i < repetitions; i++)
        {
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, fromX, fromY, TimeSpan.Zero));
            sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, toX, toY, TimeSpan.FromMilliseconds(120)));
            sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
            // Preserve distinct lifted touches while keeping prefetch/recycle
            // churn continuous, without a server idle wait between gestures.
            if (i + 1 < repetitions)
            {
                sequence.AddAction(finger.CreatePause(TimeSpan.FromMilliseconds(100)));
            }
        }
        return sequence;
    }
}
