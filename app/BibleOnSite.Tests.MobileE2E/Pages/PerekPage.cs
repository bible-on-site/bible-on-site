using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Interactions;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Pages;

public sealed class PerekPage(AppiumDriver driver, MobilePlatformAdapter platform)
{
    // The first native snapshot on a cold simulator can finish after the
    // loading page has been replaced, while returning that earlier empty tree.
    // Allow another snapshot before applying the normal interaction deadlines.
    public void WaitForStartup() => WaitFor(platform.AutomationId("PerekSource"),
        element => !string.IsNullOrWhiteSpace(element.Text), TimeSpan.FromMinutes(2));

    public AppiumElement WaitFor(string automationId) => WaitFor(automationId, _ => true);

    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool> condition) =>
        WaitFor(platform.AutomationId(automationId), condition);

    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool> condition, TimeSpan timeout) =>
        WaitFor(platform.AutomationId(automationId), condition, timeout);

    public AppiumElement WaitFor(By locator) => WaitFor(locator, _ => true);

    public AppiumElement WaitFor(By locator, Func<AppiumElement, bool> condition) =>
        WaitFor(locator, condition, TimeSpan.FromSeconds(45));

    private AppiumElement WaitFor(By locator, Func<AppiumElement, bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        // Window.Size is a device round-trip; on iOS it costs ~0.4s. One lazy
        // fetch per poll iteration keeps the per-element filter cheap while
        // still picking up rotations between polls.
        Size? window = null;
        while (DateTime.UtcNow < deadline)
        {
            window = null;
            try
            {
                var element = driver.FindElements(locator)
                    .FirstOrDefault(element => element.Displayed
                        && HasVisibleCenter(element, WindowSize())
                        && condition(element));
                if (element != null)
                {
                    return element;
                }
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"No visible element matching {locator} met the condition within {timeout.TotalSeconds} seconds.");

        Size WindowSize()
        {
            if (!window.HasValue)
            {
                window = driver.Manage().Window.Size;
            }
            return window.Value;
        }
    }

    public string Source => WaitFor("PerekSource", element => !string.IsNullOrWhiteSpace(element.Text)).Text;
    public string FirstPasuk => WaitFor("PasukText", element => !string.IsNullOrWhiteSpace(element.Text)).Text;

    /// <summary>
    /// Waits until no element matching the automation id is displayed with its
    /// center inside the viewport. Dismissed flyout content leaves the
    /// accessibility tree entirely on iOS, but a closing animation or a stale
    /// snapshot can keep a copy around briefly.
    /// </summary>
    public void WaitForHidden(string automationId)
    {
        var locator = platform.AutomationId(automationId);
        var timeout = TimeSpan.FromSeconds(30);
        var deadline = DateTime.UtcNow.Add(timeout);
        Size? window = null;
        while (DateTime.UtcNow < deadline)
        {
            window = null;
            try
            {
                var visible = driver.FindElements(locator)
                    .Any(element => element.Displayed
                        && HasVisibleCenter(element, WindowSize()));
                if (!visible)
                {
                    return;
                }
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"Element matching {locator} stayed visible for {timeout.TotalSeconds} seconds.");

        Size WindowSize()
        {
            if (!window.HasValue)
            {
                window = driver.Manage().Window.Size;
            }
            return window.Value;
        }
    }

    /// <summary>
    /// Returns the element's frame once two consecutive snapshots agree. A
    /// rotation or a carousel re-snap moves the frame over several layout
    /// passes; measuring during the transition races the assertion.
    /// </summary>
    public (Point Location, Size Size) WaitForStableFrame(string automationId)
    {
        var locator = platform.AutomationId(automationId);
        var timeout = TimeSpan.FromSeconds(45);
        var deadline = DateTime.UtcNow.Add(timeout);
        var frame = Rectangle.Empty;
        while (DateTime.UtcNow < deadline)
        {
            var element = WaitFor(locator);
            var current = new Rectangle(element.Location, element.Size);
            if (current == frame)
            {
                return (current.Location, current.Size);
            }
            frame = current;
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException($"The frame of {locator} did not stabilize within {timeout.TotalSeconds} seconds.");
    }

    /// <summary>
    /// The iOS edge-back gesture races the reader's own recognizers and a
    /// delivered gesture is sometimes dropped without any page change (#1306):
    /// re-issue it while the destination element stays absent. Presence — not
    /// the condition — ends retries, so a slow state restore (search text,
    /// reader label) waits normally instead of navigating back a second time.
    /// </summary>
    public AppiumElement GoBackTo(string automationId, Func<AppiumElement, bool> condition)
    {
        var locator = platform.AutomationId(automationId);
        for (var attempt = 0; attempt < MaxBackAttempts; attempt++)
        {
            if (attempt > 0)
            {
                DismissCapturedFlyout();
            }
            platform.GoBack(driver);
            try
            {
                WaitFor(locator, _ => true, BackResponseWindow);
                break;
            }
            catch (WebDriverTimeoutException)
            {
                // The destination stayed absent through a full settle window:
                // the gesture was dropped rather than a late transition.
            }
        }
        return WaitFor(locator, condition, TimeSpan.FromSeconds(45));
    }

    /// <summary>
    /// A right-edge gesture the app captured as a drawer-open leaves the flyout
    /// up instead of navigating back; close it so the retry reaches the page.
    /// </summary>
    private void DismissCapturedFlyout()
    {
        var flyout = driver.FindElements(platform.AutomationId("FlyoutPreferences"))
            .FirstOrDefault(element => element.Displayed);
        if (flyout == null)
        {
            return;
        }
        platform.DismissFlyoutViaScrim(driver);
        WaitForHidden("FlyoutPreferences");
    }

    private static readonly TimeSpan BackResponseWindow = TimeSpan.FromSeconds(15);
    private const int MaxBackAttempts = 3;

    public void Tap(string automationId) => Tap(platform.AutomationId(automationId));

    public void Tap(By locator) => platform.Tap(driver, WaitFor(locator, platform.CanTap));

    /// <summary>
    /// A long commentary hit can land several screens below its heading. Scroll
    /// back to verify the selected commentary before testing reader history.
    /// </summary>
    public AppiumElement ScrollBackTo(string automationId, Func<AppiumElement, bool> condition)
    {
        var locator = platform.AutomationId(automationId);
        for (var attempt = 0; attempt < 20; attempt++)
        {
            try
            {
                return WaitFor(locator, condition, TimeSpan.FromSeconds(attempt == 0 ? 8 : 2));
            }
            catch (WebDriverTimeoutException)
            {
                var window = driver.Manage().Window.Size;
                var reader = WaitFor("PasukimCollection", element => element.Size.Width >= window.Width / 2);
                var location = reader.Location;
                var size = reader.Size;
                var top = Math.Max(0, location.Y);
                var bottom = Math.Min(window.Height, location.Y + size.Height);
                var x = Math.Clamp(location.X + size.Width / 2, 1, window.Width - 1);
                var finger = new PointerInputDevice(PointerKind.Touch, "reader-scroll");
                var gesture = new ActionSequence(finger, 0);
                gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x,
                    top + (bottom - top) / 4, TimeSpan.Zero));
                gesture.AddAction(finger.CreatePointerDown(MouseButton.Left));
                gesture.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x,
                    top + (bottom - top) / 2, TimeSpan.FromMilliseconds(350)));
                gesture.AddAction(finger.CreatePointerUp(MouseButton.Left));
                driver.PerformActions([gesture]);
            }
        }
        throw new WebDriverTimeoutException($"The selected heading {automationId} was not found after scrolling back through the reader.");
    }

    public void OpenCircularMenu()
    {
        Tap("CircularMenuButton");
        WaitFor("TodayButton", element => element.Enabled);
    }

    public void AssertBottomNavigationLayout()
    {
        var menu = WaitFor("CircularMenuButton");
        var text = WaitFor("TextButton");
        var fullScreen = WaitFor("FullScreenButton");
        var window = driver.Manage().Window.Size;
        // Every property access queries the device. Read each dimension once
        // so layout assertions do not repeatedly snapshot the UI.
        var buttons = new[] { menu, text, fullScreen }
            .Select(button => (Element: button, Location: button.Location, Size: button.Size))
            .ToArray();
        foreach (var (button, location, size) in buttons)
        {
            Assert.True(button.Enabled);
            Assert.True(size.Width >= platform.Layout.MinimumButtonExtent);
            Assert.True(size.Height >= platform.Layout.MinimumButtonExtent);
            Assert.True(HasVisibleCenter(location, size, window), "The control's tap target must be inside the viewport.");
            Assert.InRange(location.X, 0, window.Width - size.Width);
            Assert.InRange(location.Y, 0, window.Height - size.Height);
        }
        var menuCenter = (buttons[0].Location.X + buttons[0].Size.Width / 2.0) / window.Width;
        Assert.InRange(menuCenter, 0.5 - platform.Layout.MenuCenterTolerance, 0.5 + platform.Layout.MenuCenterTolerance);
    }

    private bool HasVisibleCenter(AppiumElement element, Size window) =>
        HasVisibleCenter(element.Location, element.Size, window);

    private static bool HasVisibleCenter(Point location, Size size, Size window)
    {
        var x = location.X + size.Width / 2.0;
        var y = location.Y + size.Height / 2.0;
        // Native trees can contain preloaded, offscreen carousel pages marked
        // displayed. Require the element's center to be in the actual viewport.
        return size.Width > 0 && size.Height > 0
            && x >= 0 && x < window.Width && y >= 0 && y < window.Height;
    }
}
