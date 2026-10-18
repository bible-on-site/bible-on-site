using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Pages;

public sealed class PerekPage(AppiumDriver driver, MobilePlatformAdapter platform)
{
    // The first native snapshot on a cold simulator can finish after the
    // loading page has been replaced, while returning that earlier empty tree.
    // Allow another snapshot before applying the normal interaction deadlines.
    public void WaitForStartup() => WaitFor("PerekSource",
        element => !string.IsNullOrWhiteSpace(element.Text));

    public AppiumElement WaitFor(string automationId) => WaitFor(automationId, _ => true);

    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool> condition) =>
        WaitFor(platform.DisplayedAutomationId(automationId), condition);

    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool> condition, TimeSpan timeout) =>
        WaitFor(platform.DisplayedAutomationId(automationId), condition, timeout);

    public AppiumElement WaitFor(By locator) => WaitFor(locator, _ => true);

    public AppiumElement WaitFor(By locator, Func<AppiumElement, bool> condition) =>
        WaitFor(locator, condition, TimeSpan.FromSeconds(45));

    private AppiumElement WaitFor(By locator, Func<AppiumElement, bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var element = FindVisible(locator, condition).FirstOrDefault();
                if (element != null)
                {
                    return element.Element;
                }
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"No visible element matching {locator} met the condition within {timeout.TotalSeconds} seconds.");
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
        var locator = platform.DisplayedAutomationId(automationId);
        var timeout = TimeSpan.FromSeconds(30);
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var visible = FindVisible(locator).Any();
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
    }

    /// <summary>
    /// Returns the element's frame once two consecutive snapshots agree. A
    /// rotation or a carousel re-snap moves the frame over several layout
    /// passes; measuring during the transition races the assertion.
    /// </summary>
    public (Point Location, Size Size) WaitForStableFrame(string automationId)
    {
        var locator = platform.DisplayedAutomationId(automationId);
        var timeout = TimeSpan.FromSeconds(45);
        var deadline = DateTime.UtcNow.Add(timeout);
        var frame = Rectangle.Empty;
        while (DateTime.UtcNow < deadline)
        {
            var element = WaitFor(locator);
            var actual = MobilePlatformAdapter.ReadFrame(element);
            var current = new Rectangle(actual.Location, actual.Size);
            if (current == frame)
            {
                return (current.Location, current.Size);
            }
            frame = current;
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException($"The frame of {locator} did not stabilize within {timeout.TotalSeconds} seconds.");
    }

    public void Tap(string automationId) => Tap(platform.DisplayedAutomationId(automationId));

    public void Tap(By locator) => platform.Tap(driver, WaitFor(locator, platform.CanTap));

    /// <summary>
    /// A long commentary hit can land several screens below its heading. Scroll
    /// back to verify the selected commentary before testing reader history.
    /// </summary>
    public AppiumElement ScrollBackTo(string automationId, string text)
    {
        var locator = platform.AutomationIdWithText(automationId, text);
        Func<AppiumElement, bool> condition = element => element.Text == text;
        var deadline = DateTime.UtcNow.AddSeconds(45);
        AppiumElement? reader = null;
        Rectangle? lastHeading = null;
        for (var attempt = 0; attempt < 20 && DateTime.UtcNow < deadline; attempt++)
        {
            try
            {
                var window = DriverTelemetry.WindowSize(driver);
                var remaining = deadline - DateTime.UtcNow;
                if (remaining <= TimeSpan.Zero) { break; }
                reader ??= WaitFor("PasukimCollection", element => element.Size.Width >= window.Width / 2, remaining);
                NativeElementMatch? target = null;
                if (driver is IosSnapshotDriver snapshots)
                {
                    target = snapshots.FindSnapshots(locator).FirstOrDefault(match =>
                        match.Snapshot.Width > 0 && match.Snapshot.Height > 0
                        && match.Snapshot.X + match.Snapshot.Width / 2 >= 0
                        && match.Snapshot.X + match.Snapshot.Width / 2 < window.Width
                        && condition(match.ConditionElement));
                    lastHeading = target is null ? null : new Rectangle(
                        Convert.ToInt32(target.Snapshot.X), Convert.ToInt32(target.Snapshot.Y),
                        Convert.ToInt32(target.Snapshot.Width), Convert.ToInt32(target.Snapshot.Height));
                }
                else
                {
                    var visible = FindVisible(locator, condition).FirstOrDefault();
                    if (visible != null) { return visible.Element; }
                }
                // Keep the container handle, but read its live frame for every
                // gesture. The heading snapshot only plans direction/distance.
                var frame = MobilePlatformAdapter.ReadFrame(reader);
                var bounds = new Rectangle(frame.Location, frame.Size);
                var viewport = Rectangle.Intersect(bounds, new Rectangle(Point.Empty, window));
                if (target != null && target.Snapshot.IsVisibleIn(window) && lastHeading is { } heading
                    && viewport.Contains(heading.X + heading.Width / 2, heading.Y + heading.Height / 2))
                {
                    return target.Element;
                }
                driver.PerformActions([ReaderScrollActions.ReturnToHeading(bounds, window, lastHeading)]);
            }
            catch (StaleElementReferenceException)
            {
                reader = null;
            }
        }
        throw new WebDriverTimeoutException($"The selected heading {automationId} was not found within the reader's 45-second return budget; last frame: {lastHeading}.");
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
        var window = DriverTelemetry.WindowSize(driver);
        // Every property access queries the device. Read each dimension once
        // so layout assertions do not repeatedly snapshot the UI.
        var buttons = new[] { menu, text, fullScreen }
            .Select(button =>
            {
                var frame = MobilePlatformAdapter.ReadFrame(button);
                return (Element: button, frame.Location, frame.Size);
            })
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

    private sealed record VisibleMatch(AppiumElement Element, AppiumElement ConditionElement);

    private IEnumerable<VisibleMatch> FindVisible(By locator, Func<AppiumElement, bool>? condition = null)
    {
        if (driver is IosSnapshotDriver snapshots)
        {
            var matches = snapshots.FindSnapshots(locator);
            if (matches.Count == 0)
            {
                return [];
            }
            // Reject wrong text/disabled state before another device request.
            // The viewport is fresh for this poll, read only when a candidate
            // can satisfy the condition, and shared by candidates in the poll.
            Size? window = null;
            return matches.Where(match => match.Snapshot.Displayed
                    && match.Snapshot.Width > 0 && match.Snapshot.Height > 0
                    && (condition == null || condition(match.ConditionElement)))
                .Where(match => match.Snapshot.IsVisibleIn(Window()))
                .Select(match => new VisibleMatch(match.Element, match.ConditionElement));

            Size Window()
            {
                window ??= DriverTelemetry.WindowSize(driver);
                return window.Value;
            }
        }
        // Android also reads the viewport once per lookup, lazily, so an empty
        // result does not request it and every new poll observes rotations.
        Size? viewport = null;
        return driver.FindElements(locator)
            .Where(element => element.Displayed && HasVisibleCenter(
                element.Location, element.Size, Viewport()))
            .Where(element => condition == null || condition(element))
            .Select(element => new VisibleMatch(element, element));

        Size Viewport()
        {
            viewport ??= DriverTelemetry.WindowSize(driver);
            return viewport.Value;
        }
    }

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
