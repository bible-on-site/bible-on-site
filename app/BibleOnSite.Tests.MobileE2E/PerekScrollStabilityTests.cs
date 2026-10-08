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
public sealed class PerekScrollStabilityTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions)
    : MobileDeviceTest(output, sessions)
{
    [Fact]
    public void RapidPasukScrollingKeepsTheAppAlive() => Scenario(() =>
    {
        CheckFirstPerushIfAvailable();

        var list = Page.WaitFor("PasukimCollection");
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
        Driver!.PerformActions([CreateFlickSequence(centerX, bottomY, centerX, topY, 40)]);
        Driver.PerformActions([CreateFlickSequence(centerX, topY, centerX, bottomY, 40)]);

        var appState = Driver.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        Output.WriteLine($"App state after scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));
        Assert.NotEmpty(Page.Source);
        Assert.NotEmpty(Page.FirstPasuk);
    });

    // PerushNotes only render (through HtmlView, the crashed code path) when a
    // perush is checked and the perushim notes pack is available on the device.
    // Check the first perush when present; the scroll storm still runs either way.
    private void CheckFirstPerushIfAvailable()
    {
        Page.Tap("PerushimChevronButton");
        // The panel animates up (~250 ms); poll briefly for a rendered checkbox.
        AppiumElement? checkbox = null;
        for (var attempt = 0; attempt < 10 && checkbox == null; attempt++)
        {
            Thread.Sleep(300);
            checkbox = Driver!
                .FindElements(Platform.AutomationId("PerushCheckBox"))
                .FirstOrDefault(element => element.Displayed);
        }
        if (checkbox == null)
        {
            Output.WriteLine("No perushim available in this build; scrolling without inline commentary.");
        }
        else
        {
            Platform.Tap(Driver!, checkbox);
            Output.WriteLine("Checked the first perush so scrolling churns HtmlView cells.");
        }
        Page.Tap("PerushimChevronButton");
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
