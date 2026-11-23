using BibleOnSite.Tests.MobileE2E.Platforms;
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

        // Only sections near the viewport are exposed (AccessibleTextSectionsTests
        // proves the split keeps every paragraph); the 2,200-line document must
        // not put its ~147 sections into every WDA snapshot. A section is one
        // accessible element for its whole laid-out height, so the first block's
        // center can sit a few points below the viewport — invisible to every
        // center-in-viewport wait while its top edge is already on screen, and
        // taller-than-viewport elements can never satisfy that wait at all.
        // The assertions below only need the sections present in the tree
        // (#3735).
        Page.WaitForPresent("CommentaryTextSection");
        var sections = System.Xml.Linq.XDocument.Parse(Driver!.PageSource).Descendants()
            .Where(element => (string?)element.Attribute("name") == "CommentaryTextSection")
            .Select(element => (string?)element.Attribute("label") ?? string.Empty).ToArray();
        Assert.InRange(sections.Length, 1, 20);
        Assert.All(sections, text => Assert.InRange(text.Length, 1, 1024));
        Assert.Contains("פירוש ארוך", string.Concat(sections));
        var sourceBeforeStorm = Page.Source;
        var verseBeforeStorm = Page.FirstPasuk;
        SaveDiagnostics("LongPerushimBeforeScroll", "passed");

        var (location, size) = Page.WaitForStableFrame("PasukimCollection");
        var centerX = location.X + size.Width / 2;
        var topY = location.Y + size.Height / 5;
        var bottomY = location.Y + size.Height * 4 / 5;

        // 40 flicks still force heavy cell prefetch/recycle churn while every
        // pasuk cell renders HtmlView commentary blocks, and the whole test has
        // to finish well inside the 10-minute blame-hang budget.
        Storm(bottomY, topY);
        Storm(topY, bottomY);

        // queryAppState is a cheap lifecycle probe — run it before the settle
        // wait so a crashed or stalled app surfaces now instead of after the
        // stable-frame deadline.
        var appState = Driver!.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        Output.WriteLine($"App state after perushim scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));

        // The last flick's inertia keeps the collection decelerating and
        // recycling cells on the main thread — that is the starvation that
        // stretched every later WDA command past the 45s return budget. A
        // short gutter drag takes scroll tracking and stops the momentum. The
        // frame re-resolves — the storm may have recycled the earlier handle.
        var (brakeLocation, brakeSize) = Page.WaitForStableFrame("PasukimCollection");
        Driver!.PerformActions([ReaderScrollActions.Brake(
            new System.Drawing.Rectangle(brakeLocation, brakeSize),
            DriverTelemetry.WindowSize(Driver))]);

        // WDA resolves every pointerMove against the app element's AX snapshot
        // during synthesis, so keep each request short. queryAppState asks the
        // driver for the app lifecycle state without walking the view tree —
        // cheap even while the main thread is busy — and fails fast instead of
        // stalling for minutes if the app did crash.
        void Storm(int fromY, int toY)
        {
            var burst = 0;
            foreach (var sequence in PerekScrollStabilityTests.CreateFlickBursts(
                centerX, fromY, centerX, toY, 20))
            {
                // Every health probe is a queued XCTest command; on a churning
                // app it costs more than the burst it precedes. Every fourth
                // burst still bounds a crash's stall to a handful of seconds
                // while the final state assert below catches anything later.
                if (burst % 4 == 0)
                {
                    var midState = Convert.ToInt64(Driver!.ExecuteScript("mobile: queryAppState",
                        new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" }));
                    Assert.Equal(4L, midState);
                }
                burst++;
                Driver!.PerformActions([sequence]);
            }
        }

        Assert.Equal(sourceBeforeStorm, Page.Source);
        // Opposite flicks need not cancel their inertia. The reader can remain
        // inside the huge note, with every verse outside the visible viewport.
        Page.ScrollBackTo("PasukText", verseBeforeStorm);
        Assert.Equal(verseBeforeStorm, Page.FirstPasuk);
        SaveDiagnostics("LongPerushimAfterScroll", "passed");
    });

    // Add up to five visible sources sequentially, including the large first commentary.
    private int CheckAllPerushim()
    {
        Page.Tap("PerushimChevronButton");

        Page.WaitFor("PerushCheckBox", element => element.Displayed);

        // Each tap resolves a fresh live target: the panel can recycle its
        // rows between the lookup and the gesture, so a held handle can
        // stale (#3421). Frames identify distinct rows so a re-render after
        // a tap never re-taps a row that was already checked.
        var tapped = new List<(System.Drawing.Point Location, System.Drawing.Size Size)>();
        // The open sheet leaves its rows' accessibility frames reaching into
        // the floating bottom chrome. WDA still reports such a row hittable,
        // but the synthesized viewport-coordinate touch lands on whatever is
        // topmost there — the chevron — and toggles the sheet instead of the
        // row (#3735). The chevron's top edge bounds the ambiguous band.
        var chromeTop = Page.RenderedElements("PerushimChevronButton")
            .Select(element => element.Frame.Location.Y)
            .DefaultIfEmpty(int.MaxValue)
            .Min();
        for (var attempt = 0; tapped.Count < 5 && attempt < 15; attempt++)
        {
            try
            {
                // The "0" switch value skips a row recycled back checked, and
                // CanTap drops rows the snapshot itself marks unhittable.
                var next = Page.RenderedElements("PerushCheckBox")
                    .FirstOrDefault(checkbox => checkbox.Text == "0"
                        && !tapped.Contains(checkbox.Frame)
                        && checkbox.Frame.Location.Y + checkbox.Frame.Size.Height / 2 < chromeTop
                        && Platform.CanTap(checkbox.Element));
                if (next.Element == null)
                {
                    break;
                }
                Platform.Tap(Driver!, next.Element);
                tapped.Add(next.Frame);
            }
            catch (OpenQA.Selenium.StaleElementReferenceException)
            {
                // The row was recycled between lookup and tap — re-render and retry.
            }
        }
        Output.WriteLine($"Checked {tapped.Count} synthetic perushim.");

        Page.DismissPerushimSheet();
        return tapped.Count;
    }
}
