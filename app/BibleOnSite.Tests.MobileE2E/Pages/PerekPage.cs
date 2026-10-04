using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Pages;

public sealed class PerekPage(AppiumDriver driver, MobilePlatformAdapter platform)
{
    public AppiumElement WaitFor(string automationId, Func<AppiumElement, bool>? condition = null) =>
        WaitFor(MobileBy.AccessibilityId(automationId), condition);

    public AppiumElement WaitFor(By locator, Func<AppiumElement, bool>? condition = null)
    {
        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var element = driver.FindElements(locator)
                    .FirstOrDefault(element => element.Displayed && HasVisibleCenter(element)
                        && (condition?.Invoke(element) ?? true));
                if (element != null) return element;
            }
            catch (StaleElementReferenceException)
            {
                // The carousel can replace its native views between lookup and inspection.
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"No visible element matching {locator} met the condition within 45 seconds.");
    }

    public string Source => WaitFor("PerekSource", element => !string.IsNullOrWhiteSpace(element.Text)).Text;
    public string FirstPasuk => WaitFor("PasukText", element => !string.IsNullOrWhiteSpace(element.Text)).Text;

    public void OpenCircularMenu()
    {
        WaitFor("CircularMenuButton").Click();
        WaitFor("TodayButton", element => element.Enabled);
    }

    public void AssertBottomNavigationLayout()
    {
        var menu = WaitFor("CircularMenuButton");
        var text = WaitFor("TextButton");
        var fullScreen = WaitFor("FullScreenButton");
        var window = driver.Manage().Window.Size;
        foreach (var button in new[] { menu, text, fullScreen })
        {
            Assert.True(button.Enabled);
            Assert.True(button.Size.Width >= platform.Layout.MinimumButtonExtent);
            Assert.True(button.Size.Height >= platform.Layout.MinimumButtonExtent);
            Assert.True(HasVisibleCenter(button), "The control's tap target must be inside the viewport.");
            Assert.InRange(button.Location.X, 0, window.Width - button.Size.Width);
            Assert.InRange(button.Location.Y, 0, window.Height - button.Size.Height);
        }
        var menuCenter = (menu.Location.X + menu.Size.Width / 2.0) / window.Width;
        Assert.InRange(menuCenter, 0.5 - platform.Layout.MenuCenterTolerance, 0.5 + platform.Layout.MenuCenterTolerance);
    }

    private bool HasVisibleCenter(AppiumElement element)
    {
        var window = driver.Manage().Window.Size;
        var x = element.Location.X + element.Size.Width / 2.0;
        var y = element.Location.Y + element.Size.Height / 2.0;
        // Native trees can contain preloaded, offscreen carousel pages marked
        // displayed. Require the element's center to be in the actual viewport.
        return element.Size.Width > 0 && element.Size.Height > 0
            && x >= 0 && x < window.Width && y >= 0 && y < window.Height;
    }
}
