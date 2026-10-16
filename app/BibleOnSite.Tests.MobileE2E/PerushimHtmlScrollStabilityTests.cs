using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Regression test for TestFlight crash 351F87DB (5.0.132): NSAttributedString's
// NSHTML import marshals the parse back to the main thread through
// performSelectorOnMainThread, so the worker-thread offload in #1991 never
// removed the UICollectionView reentrancy — scroll churn during perushim cell
// rendering still aborted the app. The fix replaces WebKit's import with the
// managed HtmlRuns parser; this test exercises perushim HtmlView cells under
// scroll stress. iOS simulator builds carry no notes asset pack, so the app
// launches with BIBLE_E2E_PERUSHIM=1 which fabricates perushim notes.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "iOS")]
public sealed class PerushimHtmlScrollStabilityTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    // The shared session relaunches the app with this environment so the
    // synthetic commentary only applies to this scenario — sessions created
    // for other tests no longer carry the flag in their capabilities.
    protected override IReadOnlyDictionary<string, string> LaunchEnvironment =>
        new Dictionary<string, string>
        {
            ["BIBLE_E2E_PERUSHIM"] = "1",
            ["BIBLE_E2E_LONG_PERUSHIM"] = "1"
        };

    // A 267 KB-scale HTML block matches the largest delivered commentary group
    // and exercises the 2026-10-12 TextKit watchdog surface through lazy cells.
    [Fact]
    public void PerushimCellsSurviveScrollStorm() => Scenario(() =>
    {
        var checkedCount = CheckAllPerushim();
        Assert.True(checkedCount > 0,
            "Synthetic perushim must render checkboxes — otherwise HtmlView cells are never created");

        // Grouping must retain every paragraph, including text far outside the
        // visible viewport. This also exercises the formerly blocking AX lookup.
        Page.WaitFor("CommentaryTextSection");
        var sections = System.Xml.Linq.XDocument.Parse(Driver!.PageSource).Descendants()
            .Where(element => (string?)element.Attribute("name") == "CommentaryTextSection")
            .Select(element => (string?)element.Attribute("label") ?? string.Empty).ToArray();
        Assert.NotEmpty(sections);
        Assert.All(sections, text => Assert.InRange(text.Length, 1, 1024));
        var spokenText = string.Concat(sections);
        Assert.Equal(2200, System.Text.RegularExpressions.Regex.Matches(spokenText, "פירוש ארוך").Count);
        Assert.Contains("עם פירוש נוסף על הפסוק.", spokenText);
        var sourceBeforeStorm = Page.Source;
        var verseBeforeStorm = Page.FirstPasuk;
        SaveDiagnostics("LongPerushimBeforeScroll", "passed");

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
            foreach (var sequence in PerekScrollStabilityTests.CreateFlickBursts(
                centerX, fromY, centerX, toY, 20))
            {
                var midState = Convert.ToInt64(Driver!.ExecuteScript("mobile: queryAppState",
                    new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" }));
                Assert.Equal(4L, midState);
                Driver!.PerformActions([sequence]);
            }
        }

        var appState = Driver!.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        Output.WriteLine($"App state after perushim scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));
        Assert.Equal(sourceBeforeStorm, Page.Source);
        // Opposite flicks need not cancel their inertia. The reader can remain
        // inside the huge note, with every verse outside the visible viewport.
        Page.ScrollBackTo("PasukText", element => element.Text == verseBeforeStorm);
        Assert.Equal(verseBeforeStorm, Page.FirstPasuk);
        SaveDiagnostics("LongPerushimAfterScroll", "passed");
    });

    // Add up to five visible sources sequentially, including the large first commentary.
    private int CheckAllPerushim()
    {
        Page.Tap("PerushimChevronButton");

        Page.WaitFor("PerushCheckBox", element => element.Displayed);
        var checkboxes = Driver!
            .FindElements(Platform.AutomationId("PerushCheckBox"))
            .Where(element => element.Displayed)
            .ToList();

        foreach (var checkbox in checkboxes.Take(5))
        {
            Platform.Tap(Driver!, checkbox);
        }
        Output.WriteLine($"Checked {Math.Min(checkboxes.Count, 5)} synthetic perushim.");

        Page.Tap("PerushimChevronButton");
        return Math.Min(checkboxes.Count, 5);
    }
}
