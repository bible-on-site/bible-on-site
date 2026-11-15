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
// measure ink columns inside each captured PasukText element — a rendered
// property, not a declared one — across the shared reader states where cells
// rebuild: initial display, recycled scroll, perek navigation, rotation and
// the landscape→portrait→relaunch sequence the defect report exercised.
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

    // Analyzes every fully visible PasukText element: rows whose ink stops
    // short of the right edge mean a left-flushed line (the defect); a left
    // margin means the correct RTL anchor. A large empty tail flags a
    // measure/draw line-count mismatch between UILabel and TextKit. Only
    // elements that actually render a short final line qualify, and at least
    // `minimumQualifying` must — a screen full of edge-to-edge lines would
    // silently prove nothing.
    private void AssertShortFinalLinesFlushRight(string stage, int minimumQualifying = 2)
    {
        var window = DriverTelemetry.WindowSize(Driver!);
        var qualifying = 0;
        var failures = new List<string>();
        foreach (var (element, text, frame) in Page.RenderedElements("PasukText"))
        {
            if (frame.Size.Height <= 0 || frame.Location.Y < 0 ||
                frame.Location.Y + frame.Size.Height > window.Height)
            {
                // A viewport-clipped cell can drop its final line's ink.
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
                failures.Add($"'{preview}' flushed left (ink rows: {profile.InkRows}, right-gap rows: {profile.RightGapRows})");
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
