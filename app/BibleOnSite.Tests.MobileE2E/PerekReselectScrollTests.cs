using System.Globalization;
using System.Text.RegularExpressions;
using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Interactions;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// #2624: while scripture is already active, tapping the bottom bar's א ב ג
// text tab animates the currently visible reading unit's vertical content
// back to its start — same perek, same reader, no horizontal jump. The
// resolved surface must be the realized one of the unit on screen, both in
// the regular pasuk list and in תיקון קוראים.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class PerekReselectScrollTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    [Fact]
    public void ReselectingTextTabReturnsTheActivePerekToItsFirstPasuk() => Scenario(() =>
    {
        // בראשית א is a long, deterministic perek — several screens of pesukim.
        NavigateToPerek("תורה", "בראשית", "א");
        var source = Page.Source;
        var list = Page.WaitFor("PasukimCollection");
        var listTop = MobilePlatformAdapter.ReadFrame(list).Location.Y;

        Assert.StartsWith("א ", Page.FirstPasuk, StringComparison.Ordinal);
        ScrollReaderDown(list);
        WaitForFirstPasukOffTop();

        Page.Tap("TextButton");

        var first = Page.WaitFor("PasukText", element => element.Text.StartsWith("א ", StringComparison.Ordinal));
        var firstTop = MobilePlatformAdapter.ReadFrame(first).Location.Y;
        var nearTop = firstTop - listTop;
        Assert.True(nearTop >= -8 && nearTop <= MobilePlatformAdapter.ReadFrame(list).Size.Height / 5,
            $"the first pasuk must land at the top of the list, beneath the perek header (offset {nearTop})");
        Assert.Equal(source, Page.Source);
    });

    [Fact]
    public void ReselectingTextTabAfterChapterChangeScrollsOnlyTheCurrentPerek() => Scenario(() =>
    {
        NavigateToPerek("תורה", "בראשית", "א");
        ScrollReaderDown(Page.WaitFor("PasukimCollection"));

        // Move to the neighbour — the previously scrolled list goes off screen
        // and the swipe realizes the new perek's own list.
        Page.OpenCircularMenu();
        Page.Tap("NextPerekButton");
        Page.WaitFor("PerekSource", element => element.Text == "בראשית ב");
        Page.Tap("CircularMenuButton");

        ScrollReaderDown(Page.WaitFor("PasukimCollection"));
        WaitForFirstPasukOffTop();

        Page.Tap("TextButton");

        Page.WaitFor("PasukText", element => element.Text.StartsWith("א ", StringComparison.Ordinal));
        Assert.Equal("בראשית ב", Page.Source);
    });

    [Fact]
    public void ReselectingTextTabInTikkunViewReturnsToTheStart() => Scenario(() =>
    {
        NavigateToPerek("תורה", "בראשית", "א");
        // The checkbox itself is input-transparent; its tap lands on the row's
        // gesture recognizer, which flips the flag and closes the dropdown.
        Page.Tap("ReaderMenuButton");
        Page.Tap("TikkunKorimCheckBox");
        var scrollView = Page.WaitFor("TikkunScrollView");
        var topFrame = TikkunFrame(scrollView);

        ScrollTikkunDown(scrollView, topFrame);

        Page.Tap("TextButton");

        // The Debug build mirrors the live תיקון offset into the view's
        // accessibility description ("tsy:{dips}") — an exact position signal
        // instead of pixel equality, which a fading scrollbar can defeat.
        WaitForTikkun(() => TikkunReturnedToStart(scrollView, topFrame),
            "reselecting א ב ג must return the תיקון קוראים flow to its start");
        Assert.Equal("בראשית א", Page.Source);
    });

    /// <summary>
    /// Opens בחירת פרק from the radial menu and confirms the requested unit —
    /// deterministic long-perek setup regardless of which perek the day opens on.
    /// </summary>
    private void NavigateToPerek(string group, string sefer, string perek)
    {
        Page.OpenCircularMenu();
        Page.Tap("PerekPickerButton");
        Page.WaitFor("PerekPickerPopup");
        TapItem("PickerGroupItem", group);
        TapItem("PickerSeferItem", sefer);
        TapItem("PickerPerekItem", perek);
        Page.Tap("PerekPickerConfirm");
        Page.WaitForHidden("PerekPickerPopup");
        Page.WaitFor("PerekSource", element => element.Text == $"{sefer} {perek}");
        Assert.NotEmpty(Page.FirstPasuk);
    }

    private void TapItem(string automationId, string text)
    {
        var item = Page.WaitFor(automationId, element => element.Text == text);
        Platform.Tap(Driver!, item);
    }

    /// <summary>
    /// Three deliberate drags move the content several screens in one command
    /// set — enough to push the first pasuk out of the viewport — without the
    /// lift-free flick inertia that keeps an iOS collection churning.
    /// </summary>
    private void ScrollReaderDown(AppiumElement list)
    {
        var (location, size) = MobilePlatformAdapter.ReadFrame(list);
        var x = location.X + size.Width / 2;
        var topY = location.Y + size.Height / 5;
        var bottomY = location.Y + size.Height * 4 / 5;
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        for (var i = 0; i < 3; i++)
        {
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, bottomY, TimeSpan.Zero));
            sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, topY, TimeSpan.FromMilliseconds(350)));
            sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
            if (i + 1 < 3)
            {
                sequence.AddAction(finger.CreatePause(TimeSpan.FromMilliseconds(100)));
            }
        }
        Driver!.PerformActions([sequence]);
    }

    /// <summary>
    /// Polls until the topmost rendered pasuk is no longer the first one —
    /// the scroll gestures actually moved the list before the tab reselect.
    /// </summary>
    private void WaitForFirstPasukOffTop()
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            var first = Page.FirstPasuk;
            if (!first.StartsWith("א ", StringComparison.Ordinal))
            {
                return;
            }
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException("The reader stayed on pasuk א after the scroll gestures.");
    }

    /// <summary>
    /// Scrolls the תיקון flow away from its start, verifying every attempt
    /// against the reported offset before trusting it: an injected drag can
    /// land while the flow is still laying out or while a child gesture
    /// recognizer settles, so the other injection path tries next whenever one
    /// did not move the view. UiAutomator2 reports a scrollable's children
    /// with viewport-clipped bounds — the flow view's top edge never leaves
    /// the viewport — so position evidence comes from the offset probe, or
    /// from pixels on builds without it.
    /// </summary>
    private void ScrollTikkunDown(AppiumElement scrollView, byte[] topFrame)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        var attempt = 0;
        while (DateTime.UtcNow < deadline)
        {
            if (Configuration.Platform == MobilePlatform.Android && attempt % 2 == 0)
            {
                // The driver-level scroll gesture drives the scrollable surface
                // itself, independent of where its clipped child bounds sit.
                // It returns false when the accessibility scroll action cannot
                // move this surface — MauiScrollView does not answer it — in
                // which case the injected drag takes over immediately.
                var scrolled = Driver!.ExecuteScript("mobile: scrollGesture", new Dictionary<string, object>
                {
                    ["elementId"] = scrollView.Id,
                    ["direction"] = "down",
                    ["percent"] = 0.9,
                });
                if (scrolled is not bool ok || !ok)
                {
                    ScrollReaderDown(scrollView);
                }
            }
            else
            {
                ScrollReaderDown(scrollView);
            }
            var settled = DateTime.UtcNow.AddSeconds(4);
            while (DateTime.UtcNow < settled)
            {
                if (TikkunMovedFromStart(scrollView, topFrame))
                {
                    return;
                }
                Thread.Sleep(250);
            }
            attempt++;
        }
        throw new WebDriverTimeoutException(
            "the תיקון קוראים content stayed at the top after the scroll gestures");
    }

    /// <summary>True once the תיקון flow reports a real offset — or, without
    /// the probe, once its pixels differ from the start capture.</summary>
    private bool TikkunMovedFromStart(AppiumElement scrollView, byte[] topFrame) =>
        TikkunOffsetY(scrollView) is { } offset
            ? offset > 200
            : !TikkunFrame(scrollView).SequenceEqual(topFrame);

    private bool TikkunReturnedToStart(AppiumElement scrollView, byte[] topFrame) =>
        TikkunOffsetY(scrollView) is { } offset
            ? offset <= 2
            : TikkunFrame(scrollView).SequenceEqual(topFrame);

    /// <summary>
    /// Reads the תיקון scroll offset that Debug builds mirror into the view's
    /// accessibility description as "tsy:{dips}" (#2624); null when the probe
    /// has not reported yet or the build predates it.
    /// </summary>
    private int? TikkunOffsetY(AppiumElement scrollView)
    {
        var names = Configuration.Platform == MobilePlatform.Android
            ? new[] { "contentDescription", "content-desc" }
            : new[] { "label", "value", "name" };
        foreach (var name in names)
        {
            string? raw;
            try
            {
                raw = scrollView.GetAttribute(name);
            }
            catch (WebDriverException)
            {
                continue;
            }
            var match = Regex.Match(raw ?? string.Empty, @"tsy:(\d+)");
            if (match.Success)
            {
                return int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
            }
        }
        return null;
    }

    /// <summary>The scroll view's current visible pixels.</summary>
    private static byte[] TikkunFrame(AppiumElement scrollView) =>
        ((ITakesScreenshot)scrollView).GetScreenshot().AsByteArray;

    private static void WaitForTikkun(Func<bool> reached, string timeoutMessage)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            if (reached())
            {
                return;
            }
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException(timeoutMessage);
    }
}
