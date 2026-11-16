using BibleOnSite.Tests.MobileE2E.Platforms;
using BibleOnSite.Tests.MobileE2E.Rendering;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// #3380: a justified RTL pasuk must anchor its short final line to the right
// edge like the inline commentary does. UILabel resolves that last line by the
// app's preferred language, so on English-locale devices it flushed left even
// though the paragraph style pinned BaseWritingDirection (#3057). These checks
// measure the last ink band's bounds inside each captured PasukText element —
// a rendered property, not a declared one — across the shared reader states
// where cells rebuild: initial display, recycled scroll, perek navigation,
// rotation and the landscape→portrait→relaunch sequence the defect report
// exercised. Elements overlapped by the floating bottom chrome are skipped:
// their screenshots contain the overlay's ink, not the text's.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class PasukLastLineDirectionTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    [Fact]
    public void ShortFinalLinesFlushRightOnInitialDisplay() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        AssertShortFinalLinesFlushRight("initial display");
    });

    [Fact]
    public void ShortFinalLinesStayRightAfterScrollAndPerekSwitch() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        var source = Page.Source;
        Platform.ScrollPageDown(Driver!);
        Platform.ScrollPageDown(Driver!);
        AssertShortFinalLinesFlushRight("after scrolling", 1);

        Page.OpenCircularMenu();
        Page.Tap(Page.WaitFor("NextPerekButton").Enabled ? "NextPerekButton" : "PrevPerekButton");
        Page.WaitFor("PerekSource", element => element.Text != source);
        // The menu scrim marks reader elements covered on iOS; close it first.
        Page.Tap("CircularMenuButton");
        Page.WaitFor("PasukText", element => !string.IsNullOrWhiteSpace(element.Text));
        AssertShortFinalLinesFlushRight("after switching perek");
    });

    [Fact]
    public void ShortFinalLinesStayRightThroughLandscapePortraitAndRelaunch() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        Driver!.Orientation = ScreenOrientation.Landscape;
        Page.WaitForStableFrame("PasukText");
        AssertShortFinalLinesFlushRight("landscape", 1);

        Driver.Orientation = ScreenOrientation.Portrait;
        Page.WaitForStableFrame("PasukText");
        AssertShortFinalLinesFlushRight("back to portrait");

        // The reported run reproduced after this exact relaunch path.
        Connect();
        AssertShortFinalLinesFlushRight("after relaunch");
    });

    // Floating bottom chrome that can cover a PasukText element's tail. The
    // element screenshot captures the overlay's ink — the circular menu FAB
    // and nav icons are indistinguishable from text by luminance — so an
    // element dipping into the strip cannot be measured honestly.
    private static readonly string[] BottomChromeIds =
    [
        "CircularMenuButton", "TextButton", "FullScreenButton",
        "ArticlesButton", "PerushimChevronButton",
    ];

    // Analyzes every fully visible PasukText element: the last line band's
    // bounds decide the verdict — stopping short of the right edge while
    // anchored left is the defect; a left margin with ink at the right edge is
    // the correct RTL anchor. A large empty tail flags a measure/draw
    // line-count mismatch between UILabel and TextKit. Only elements that
    // actually render a short final line qualify, and at least
    // `minimumQualifying` must — a screen full of edge-to-edge lines would
    // silently prove nothing.
    private void AssertShortFinalLinesFlushRight(string stage, int minimumQualifying = 2)
    {
        var window = DriverTelemetry.WindowSize(Driver!);
        var chromeTop = window.Height;
        foreach (var chromeId in BottomChromeIds)
        {
            foreach (var (_, _, chromeFrame) in Page.RenderedElements(chromeId))
            {
                chromeTop = Math.Min(chromeTop, chromeFrame.Location.Y);
            }
        }
        var qualifying = 0;
        var failures = new List<string>();
        foreach (var (element, text, frame) in Page.RenderedElements("PasukText"))
        {
            if (frame.Size.Height <= 0 || frame.Location.Y < 0 ||
                frame.Location.Y + frame.Size.Height > Math.Min(window.Height, chromeTop))
            {
                // A viewport- or chrome-clipped cell can drop its final line's
                // ink — or capture the floating overlay's ink in its place.
                continue;
            }
            byte[] png;
            try
            {
                png = element.GetScreenshot().AsByteArray;
            }
            catch (StaleElementReferenceException)
            {
                // The collection recycled the cell between snapshot and capture.
                continue;
            }
            var profile = PasukInkAnalysis.Measure(png);
            var preview = text.Length > 24 ? text[..24] + "…" : text;
            if (profile.HasShortFinalLine)
            {
                qualifying++;
            }
            if (profile.HasLeftFlushedLine)
            {
                failures.Add($"'{preview}' flushed left (last line band: {profile.LastLine}, trailing left run: {profile.TrailingLeftRun}, bands: {profile.BandKinds})");
            }
            if (profile.HasMissingLines)
            {
                failures.Add($"'{preview}' left an empty tail (empty tail rows: {profile.EmptyTailRows} of {profile.Height})");
            }
        }
        Assert.True(failures.Count == 0,
            $"{stage}: {failures.Count} short final pasuk line(s) rendered wrong: {string.Join("; ", failures)}");
        Assert.True(qualifying >= minimumQualifying,
            $"{stage}: only {qualifying} PasukText element(s) rendered a short final line; the check needs at least {minimumQualifying}.");
    }
}
