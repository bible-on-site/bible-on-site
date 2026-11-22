using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Interactions;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Regression test for TestFlight crash F0AF3C74 (5.0.121): HtmlView's
// NSAttributedString NSHTML import ran synchronously on the main thread while
// UICollectionView prefetched pasuk cells. The import's nested run loop
// re-entered _updateVisibleCellsNow: and aborted the app. Rapid flick scrolls
// force cell prefetch/recycle churn that reliably surfaced the crash.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "iOS")]
public sealed class PerekScrollStabilityTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    [Fact]
    public void RapidPasukScrollingKeepsTheAppAlive() => Scenario(() =>
    {
        CheckFirstPerushIfAvailable();

        var (location, size) = Page.WaitForStableFrame("PasukimCollection");
        var centerX = location.X + size.Width / 2;
        var topY = location.Y + size.Height / 5;
        var bottomY = location.Y + size.Height * 4 / 5;

        // Fast back-to-back flicks maximize prefetch churn: cells are created,
        // dequeued and recycled while perushim HTML is being imported.
        // WDA resolves every pointer move through XCTest's app coordinates.
        // A ten-flick burst normally took 9-12s, but repeated AX frame queries
        // grew to several seconds each on a loaded host and exceeded 45s.
        // Two-flick bursts bound that synthesis work without changing any of
        // the 80 lifted touches, their travel time or the gap within a burst.
        foreach (var sequence in CreateFlickBursts(centerX, bottomY, centerX, topY, 40)
            .Concat(CreateFlickBursts(centerX, topY, centerX, bottomY, 40)))
        {
            Driver!.PerformActions([sequence]);
        }

        // queryAppState asks the driver for the app lifecycle state without
        // walking the view tree — cheap even while the main thread is busy.
        // Probe it before the settle wait so a crashed or stalled app surfaces
        // now instead of after the stable-frame deadline.
        var appState = Driver!.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        Output.WriteLine($"App state after scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));

        // The last flick's inertia keeps the collection decelerating and
        // recycling cells on the main thread, starving the WDA lookups that
        // follow. A short gutter drag takes scroll tracking and stops it. The
        // frame re-resolves — the storm may have recycled the earlier handle.
        var (brakeLocation, brakeSize) = Page.WaitForStableFrame("PasukimCollection");
        Driver!.PerformActions([ReaderScrollActions.Brake(
            new System.Drawing.Rectangle(brakeLocation, brakeSize),
            DriverTelemetry.WindowSize(Driver))]);

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
        // RenderedElements reads displayed state inside the lookup's snapshot.
        var available = false;
        for (var attempt = 0; attempt < 10 && !available; attempt++)
        {
            Thread.Sleep(300);
            try
            {
                available = Page.RenderedElements("PerushCheckBox").Count > 0;
            }
            catch (StaleElementReferenceException)
            {
                // The panel was mid-render; the next poll sees a fresh tree.
            }
        }
        if (!available)
        {
            Output.WriteLine("No perushim available in this build; scrolling without inline commentary.");
        }
        else
        {
            // Tap's poll keeps the same center-in-viewport rule as the
            // discovery scan and re-resolves a recycled handle — all inside
            // this optional step's own five-second budget.
            try
            {
                Page.Tap("PerushCheckBox", _ => true, TimeSpan.FromSeconds(5));
                Output.WriteLine("Checked the first perush so scrolling churns HtmlView cells.");
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // The only rendered checkboxes sit outside the viewport —
                // treat like an unavailable pack instead of failing setup.
                Output.WriteLine("The rendered perush checkbox never became tappable; scrolling without it.");
            }
        }
        // An open sheet always renders one of the markers — checkboxes when
        // the perek has perushim, the empty state when it does not — so
        // verifying both left the tree proves the panel really closed where
        // either marker alone would be vacuously absent (#3737).
        Page.TapToDismiss("PerushimChevronButton", "PerushCheckBox", "PerushimEmptyState");
    }

    internal static IReadOnlyList<ActionSequence> CreateFlickBursts(int fromX, int fromY, int toX, int toY, int repetitions)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(repetitions);
        const int maximumFlicksPerCommand = 2;
        var bursts = new List<ActionSequence>();
        for (var remaining = repetitions; remaining > 0; remaining -= maximumFlicksPerCommand)
        {
            bursts.Add(CreateFlickSequence(fromX, fromY, toX, toY, Math.Min(remaining, maximumFlicksPerCommand)));
        }
        return bursts;
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
