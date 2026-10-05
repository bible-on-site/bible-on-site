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
    public void WaitForStartup() => WaitFor(platform.AutomationId("PerekSource"),
        element => !string.IsNullOrWhiteSpace(element.Text), TimeSpan.FromMinutes(2));

    public AppiumElement WaitFor(string automationId) => WaitFor(automationId, _ => true);

    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool> condition) =>
        WaitFor(platform.AutomationId(automationId), condition);

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
                var element = driver.FindElements(locator)
                    .FirstOrDefault(element => element.Displayed && HasVisibleCenter(element)
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
    }

    public string Source => WaitFor("PerekSource", element => !string.IsNullOrWhiteSpace(element.Text)).Text;
    public string FirstPasuk => WaitFor("PasukText", element => !string.IsNullOrWhiteSpace(element.Text)).Text;

    public void Tap(string automationId) => Tap(platform.AutomationId(automationId));

    public void Tap(By locator) => platform.Tap(driver, WaitFor(locator, platform.CanTap));

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

    private bool HasVisibleCenter(AppiumElement element)
    {
        var window = driver.Manage().Window.Size;
        return HasVisibleCenter(element.Location, element.Size, window);
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
