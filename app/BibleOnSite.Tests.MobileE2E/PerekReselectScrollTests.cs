using System.Diagnostics;
using System.Drawing;
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
        var listFrame = Page.WaitForStableFrame("PasukimCollection");
        var listTop = listFrame.Location.Y;

        Assert.StartsWith("א ", Page.FirstPasuk, StringComparison.Ordinal);
        ScrollReaderDown(listFrame);
        WaitForFirstPasukOffTop();

        Page.Tap("TextButton");

        // The accepted poll's snapshot supplies the first pasuk's settled
        // frame — a live ReadFrame after the wait raced cell recycling (#3421).
        var firstTop = Page.WaitForStableFrame("PasukText",
            element => element.Text.StartsWith("א ", StringComparison.Ordinal)).Location.Y;
        var nearTop = firstTop - listTop;
        Assert.True(nearTop >= -8 && nearTop <= listFrame.Size.Height / 5,
            $"the first pasuk must land at the top of the list, beneath the perek header (offset {nearTop})");
        Assert.Equal(source, Page.Source);
    });

    [Fact]
    public void ReselectingTextTabAfterChapterChangeScrollsOnlyTheCurrentPerek() => Scenario(() =>
    {
        NavigateToPerek("תורה", "בראשית", "א");
        ScrollReaderDown(Page.WaitForStableFrame("PasukimCollection"));

        // Move to the neighbour — the previously scrolled list goes off screen
        // and the swipe realizes the new perek's own list.
        Page.OpenCircularMenu();
        Page.Tap("NextPerekButton");
        Page.WaitFor("PerekSource", element => element.Text == "בראשית ב");
        Page.Tap("CircularMenuButton");

        ScrollReaderDown(Page.WaitForStableFrame("PasukimCollection"));
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
        var topFrame = TikkunFrame();

        ScrollTikkunDown(topFrame);

        Page.Tap("TextButton");

        // The Debug build mirrors the live תיקון offset into the view's
        // accessibility description ("tsy:{dips}") — an exact position signal
        // instead of pixel equality, which a fading scrollbar can defeat.
        WaitForTikkun(() => TikkunReturnedToStart(topFrame),
            "reselecting א ב ג must return the תיקון קוראים flow to its start");
        Assert.Equal("בראשית א", Page.Source);
    });

    // #3265: toggling niqqud/taamim repaints the flow on the unchanged marked
    // geometry — the scroll offset (and every base letter under it) cannot
    // move. A reflow on the stripped text would shrink the content and clamp
    // the offset, which the "tsy:{dips}" probe exposes exactly.
    [Fact]
    public void TogglingMarksKeepsTheTikkunScrollOffset() => Scenario(() =>
    {
        NavigateToPerek("תורה", "בראשית", "א");
        Page.Tap("ReaderMenuButton");
        Page.Tap("TikkunKorimCheckBox");
        var topFrame = TikkunFrame();

        ScrollTikkunDown(topFrame);
        var offset = SettledTikkunOffset();
        Assert.True(offset is null or > 200,
            $"the flow must be scrolled before the toggle (tsy={offset})");

        var shownFrame = TikkunFrame();
        TapTikkun();

        WaitForTikkun(() => !TikkunFrame().SequenceEqual(shownFrame),
            "hiding marks must repaint the flow");
        if (offset is { } scrolled)
        {
            Assert.Equal(scrolled, SettledTikkunOffset());
        }

        // Capture the hidden frame BEFORE the restore tap: the hide-wait above
        // already proved the frame differs from shownFrame, so this capture is
        // the hidden state. Taking it after the tap races the repaint — on a
        // fast restore the capture already equals the restored frame and the
        // wait can never observe a difference.
        var hiddenFrame = TikkunFrame();
        TapTikkun();
        WaitForTikkun(() => !TikkunFrame().SequenceEqual(hiddenFrame),
            "restoring marks must repaint the flow");
        if (offset is { } restored)
        {
            Assert.Equal(restored, SettledTikkunOffset());
        }
        else
        {
            // Without the probe the restored pixels are the only position
            // signal: marks repaint over the unchanged marked geometry, so
            // the frame must come back identical to the pre-hide capture.
            WaitForTikkun(() => TikkunFrame().SequenceEqual(shownFrame),
                "restoring marks must repaint the identical flow");
        }
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

    private void TapItem(string automationId, string text) =>
        Page.Tap(automationId, element => element.Text == text);

    /// <summary>
    /// Three deliberate drags move the content several screens in one command
    /// set — enough to push the first pasuk out of the viewport — without the
    /// lift-free flick inertia that keeps an iOS collection churning.
    /// </summary>
    private void ScrollReaderDown((Point Location, Size Size) frame)
    {
        var x = frame.Location.X + frame.Size.Width / 2;
        var topY = frame.Location.Y + frame.Size.Height / 5;
        var bottomY = frame.Location.Y + frame.Size.Height * 4 / 5;
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
    /// from pixels on builds without it. Every gesture and probe re-resolves
    /// the scroll view inside the attempt: a view recycled mid-loop stales a
    /// held handle for every later read (#3421).
    /// </summary>
    private void ScrollTikkunDown(byte[] topFrame)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        var attempt = 0;
        while (DateTime.UtcNow < deadline)
        {
            try
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
                        ["elementId"] = Page.WaitFor("TikkunScrollView").Id,
                        ["direction"] = "down",
                        ["percent"] = 0.9,
                    });
                    if (scrolled is not bool ok || !ok)
                    {
                        ScrollReaderDown(Page.WaitForStableFrame("TikkunScrollView"));
                    }
                }
                else
                {
                    ScrollReaderDown(Page.WaitForStableFrame("TikkunScrollView"));
                }
            }
            catch (StaleElementReferenceException)
            {
                // The flow view was recycled between resolve and gesture; the
                // next attempt resolves it again.
            }
            var settled = DateTime.UtcNow.AddSeconds(4);
            while (DateTime.UtcNow < settled)
            {
                try
                {
                    if (TikkunMovedFromStart(topFrame))
                    {
                        return;
                    }
                }
                catch (StaleElementReferenceException)
                {
                    // The probe re-resolves on the next poll.
                }
                catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
                {
                    // An observation timeout retries inside the same budget.
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
    private bool TikkunMovedFromStart(byte[] topFrame) =>
        TikkunOffsetY() is { } offset
            ? offset > 200
            : !TikkunFrame().SequenceEqual(topFrame);

    private bool TikkunReturnedToStart(byte[] topFrame) =>
        TikkunOffsetY() is { } offset
            ? offset <= 2
            : TikkunFrame().SequenceEqual(topFrame);

    /// <summary>
    /// Reads the תיקון offset once two consecutive samples agree — the probe
    /// value must be read after the scroll animation fully settles or a
    /// still-moving view looks like a geometry change (#3265).
    /// </summary>
    private int? SettledTikkunOffset()
    {
        var deadline = DateTime.UtcNow.AddSeconds(8);
        var previous = TikkunOffsetY();
        while (DateTime.UtcNow < deadline)
        {
            Thread.Sleep(300);
            var current = TikkunOffsetY();
            if (current == previous)
            {
                return current;
            }
            previous = current;
        }
        return previous;
    }

    /// <summary>
    /// Reads the תיקון scroll offset that Debug builds mirror into the view's
    /// accessibility description as "tsy:{dips}" (#2624); null when the probe
    /// has not reported yet or the build predates it. The scroll view is
    /// resolved fresh for each read — a recycled handle reports null rather
    /// than wedging the probe loop.
    /// </summary>
    private int? TikkunOffsetY()
    {
        var names = Configuration.Platform == MobilePlatform.Android
            ? new[] { "contentDescription", "content-desc" }
            : new[] { "label", "value", "name" };
        string? raw;
        try
        {
            // The probe reads inside the wait's own poll so a view recycled
            // between lookup and attribute read retries there instead of
            // staling the held handle (#3421). The iOS poll's snapshot text
            // already carries the label, so that check costs no round-trip.
            raw = Page.WaitForObservation("TikkunScrollView", element =>
            {
                var text = element.Text;
                if (text.Contains("tsy:", StringComparison.Ordinal))
                {
                    return text;
                }
                foreach (var name in names)
                {
                    string? value;
                    try
                    {
                        value = element.GetAttribute(name);
                    }
                    catch (WebDriverException exception) when (exception is not StaleElementReferenceException)
                    {
                        // The attribute does not exist on this view — try the
                        // next; staleness escapes so the poll retries a fresh
                        // element instead of caching a dead read.
                        continue;
                    }
                    // Only the probe value matters — a different nonempty
                    // attribute must not shadow a later tsy: carrier.
                    if (!string.IsNullOrEmpty(value) && value.Contains("tsy:", StringComparison.Ordinal))
                    {
                        return value;
                    }
                }
                return null;
            }, TimeSpan.FromSeconds(5));
        }
        catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
        {
            return null;
        }
        var match = Regex.Match(raw ?? string.Empty, @"tsy:(\d+)");
        return match.Success ? int.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture) : null;
    }

    /// <summary>The scroll view's current visible pixels.</summary>
    private byte[] TikkunFrame()
    {
        // The screenshot needs the live element, so it resolves right before
        // the command; a view recycled in between resolves again inside the
        // same 45-second budget instead of staling the held handle (#3421).
        var deadline = DateTime.UtcNow.AddSeconds(45);
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var remaining = deadline - DateTime.UtcNow;
            try
            {
                return ((ITakesScreenshot)Page.WaitFor("TikkunScrollView", _ => true,
                    remaining > TimeSpan.Zero ? remaining : TimeSpan.Zero)).GetScreenshot().AsByteArray;
            }
            catch (StaleElementReferenceException) when (attempt < 2 && remaining > TimeSpan.Zero)
            {
                // The flow is mid-recycle; the next lookup sees a fresh tree.
            }
        }
        throw new UnreachableException();
    }

    private void TapTikkun() =>
        // Page.Tap resolves the target right before the gesture and retries a
        // recycled view inside its own deadline instead of staling a handle.
        Page.Tap("TikkunScrollView");

    private static void WaitForTikkun(Func<bool> reached, string timeoutMessage)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                if (reached())
                {
                    return;
                }
            }
            catch (StaleElementReferenceException)
            {
                // A view recycled mid-probe re-resolves on the next poll.
            }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception))
            {
                // An observation timeout retries inside the same budget.
            }
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException(timeoutMessage);
    }
}
