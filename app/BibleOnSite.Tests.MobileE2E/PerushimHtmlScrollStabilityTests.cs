using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Regression test for TestFlight crash 351F87DB (5.0.132): NSAttributedString's
// NSHTML import marshals the parse back to the main thread through
// performSelectorOnMainThread, so the worker-thread offload in #1991 never
// removed the UICollectionView reentrancy — scroll churn during perushim cell
// rendering still aborted the app. The fix replaces WebKit's import with the
// managed HtmlRuns parser; this test exercises perushim HtmlView cells under
// scroll stress. iOS simulator builds carry no ODR notes pack, so the app
// launches with BIBLE_E2E_PERUSHIM=1 which fabricates perushim notes.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "iOS")]
public sealed class PerushimHtmlScrollStabilityTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions)
    : MobileDeviceTest(output, sessions)
{
    protected override AppiumOptions CreateOptions() =>
        Platform.CreateOptions(Configuration,
            new Dictionary<string, string> { ["BIBLE_E2E_PERUSHIM"] = "1" });

    [Fact]
    public void PerushimCellsSurviveScrollStorm() => Scenario(() =>
    {
        var checkedCount = CheckAllPerushim();
        Assert.True(checkedCount > 0,
            "Synthetic perushim must render checkboxes — otherwise HtmlView cells are never created");

        var list = Page.WaitFor("PasukimCollection");
        var centerX = list.Location.X + list.Size.Width / 2;
        var topY = list.Location.Y + list.Size.Height / 5;
        var bottomY = list.Location.Y + list.Size.Height * 4 / 5;

        // 40 flicks still force heavy cell prefetch/recycle churn while every
        // pasuk cell renders HtmlView commentary blocks, and the whole test has
        // to finish well inside the 10-minute blame-hang budget.
        Storm(bottomY, topY);
        Storm(topY, bottomY);

        // WDA resolves every pointerMove against the app element's AX snapshot
        // during synthesis, so keep each request short. queryAppState asks the
        // driver for the app lifecycle state without walking the view tree —
        // cheap even while the main thread is busy — and fails fast instead of
        // stalling for minutes if the app did crash.
        void Storm(int fromY, int toY)
        {
            for (var burst = 0; burst < 2; burst++)
            {
                var midState = Convert.ToInt64(Driver!.ExecuteScript("mobile: queryAppState",
                    new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" }));
                Assert.Equal(4L, midState);
                Driver!.PerformActions([PerekScrollStabilityTests.CreateFlickSequence(
                    centerX, fromY, centerX, toY, 10)]);
            }
        }

        var appState = Driver!.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        Output.WriteLine($"App state after perushim scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));
        Assert.NotEmpty(Page.Source);
        Assert.NotEmpty(Page.FirstPasuk);
    });

    // Opens the perushim panel and checks the first two synthetic commentaries
    // so each pasuk cell renders HtmlView notes; returns how many were checked.
    // Checking all three triples attributed-text layout cost without covering
    // any additional code path — one HtmlView per commentary already exercises
    // the parse/render pipeline that crashed.
    private int CheckAllPerushim()
    {
        Page.Tap("PerushimChevronButton");

        // The panel animates up (~250 ms); poll briefly for rendered checkboxes.
        List<AppiumElement> checkboxes = [];
        for (var attempt = 0; attempt < 10 && checkboxes.Count == 0; attempt++)
        {
            Thread.Sleep(300);
            checkboxes = Driver!
                .FindElements(Platform.AutomationId("PerushCheckBox"))
                .Where(element => element.Displayed)
                .ToList();
        }

        foreach (var checkbox in checkboxes.Take(2))
        {
            Platform.Tap(Driver!, checkbox);
        }
        Output.WriteLine($"Checked {Math.Min(checkboxes.Count, 2)} synthetic perushim.");

        Page.Tap("PerushimChevronButton");
        return Math.Min(checkboxes.Count, 2);
    }
}
