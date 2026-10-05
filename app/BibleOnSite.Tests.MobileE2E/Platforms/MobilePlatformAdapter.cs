using BibleOnSite.Tests.MobileE2E.Configuration;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;
using OpenQA.Selenium.Appium.iOS;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

// Shared scenarios depend on this contract. Native navigation, locators and
// intentional layout differences belong in adapters, rather than test branches.
public abstract class MobilePlatformAdapter
{
    public virtual LayoutExpectations Layout => new();
    public abstract By AutomationId(string id);
    public abstract By FlyoutButton { get; }
    public virtual bool CanTap(AppiumElement element) => element.Enabled;
    public virtual void Tap(AppiumDriver driver, AppiumElement element) => element.Click();
    public abstract void GoBack(AppiumDriver driver);
    public abstract AppiumDriver CreateDriver(Uri server, AppiumOptions options);

    public AppiumOptions CreateOptions(MobileTestConfiguration configuration)
    {
        var android = configuration.Platform == MobilePlatform.Android;
        var options = new AppiumOptions
        {
            PlatformName = android ? "Android" : "iOS",
            AutomationName = android ? "UiAutomator2" : "XCUITest",
            DeviceName = configuration.DeviceId,
            App = configuration.AppPath
        };
        options.AddAdditionalAppiumOption("udid", configuration.DeviceId);
        if (!string.IsNullOrWhiteSpace(configuration.PlatformVersion))
        {
            options.PlatformVersion = configuration.PlatformVersion;
        }
        options.AddAdditionalAppiumOption("noReset", false);
        // Android fully uninstalls the app. iOS resets and reinstalls it through
        // noReset=false and enforceAppInstall=true while the device stays booted.
        options.AddAdditionalAppiumOption("fullReset", android);
        options.AddAdditionalAppiumOption("newCommandTimeout", 120);
        if (android)
        {
            options.AddAdditionalAppiumOption("appPackage", "com.tanah.daily929");
            options.AddAdditionalAppiumOption("autoGrantPermissions", true);
            options.AddAdditionalAppiumOption("uiautomator2ServerInstallTimeout", 120000);
            options.AddAdditionalAppiumOption("androidInstallTimeout", 180000);
            options.AddAdditionalAppiumOption("disableWindowAnimation", true);
        }
        else
        {
            options.AddAdditionalAppiumOption("bundleId", "com.tanah.daily929");
            options.AddAdditionalAppiumOption("autoAcceptAlerts", true);
            options.AddAdditionalAppiumOption("enforceAppInstall", true);
            options.AddAdditionalAppiumOption("isHeadless", true);
            options.AddAdditionalAppiumOption("showXcodeLog", true);
            options.AddAdditionalAppiumOption("usePreinstalledWDA", true);
            options.AddAdditionalAppiumOption("prebuiltWDAPath", configuration.PrebuiltWdaPath
                ?? throw new ArgumentException("npm test must prepare MOBILE_WDA_PATH for iOS."));
            options.AddAdditionalAppiumOption("wdaStartupRetries", 1);
            options.AddAdditionalAppiumOption("wdaLaunchTimeout", 180000);
            options.AddAdditionalAppiumOption("wdaConnectionTimeout", 90000);
            // XCTest's repeated default idle waits can consume the entire shared
            // readiness deadline during the loading-page/reader transition.
            // Keep idle checks enabled; page objects poll the actual UI state.
            options.AddAdditionalAppiumOption("waitForIdleTimeout", 1.0);
        }
        return options;
    }

    public static MobilePlatformAdapter For(MobilePlatform platform) => platform switch
    {
        MobilePlatform.Android => new AndroidPlatformAdapter(),
        MobilePlatform.IOS => new IosPlatformAdapter(),
        _ => throw new ArgumentOutOfRangeException(nameof(platform))
    };
}

public sealed record LayoutExpectations(double MinimumButtonExtent = 44, double MenuCenterTolerance = 0.08);

public sealed class AndroidPlatformAdapter : MobilePlatformAdapter
{
    // MAUI maps AutomationId to Android resource-id, preserving screen-reader text.
    public override By AutomationId(string id) => By.Id($"com.tanah.daily929:id/{id}");
    public override By FlyoutButton => By.XPath("//android.widget.ImageButton[@content-desc='Open navigation drawer']");
    public override void GoBack(AppiumDriver driver) => driver.Navigate().Back();
    public override AppiumDriver CreateDriver(Uri server, AppiumOptions options) =>
        new AndroidDriver(server, options, TimeSpan.FromMinutes(4));
}

public sealed class IosPlatformAdapter : MobilePlatformAdapter
{
    public override By AutomationId(string id) => MobileBy.AccessibilityId(id);
    public override By FlyoutButton => By.XPath("//XCUIElementTypeNavigationBar/XCUIElementTypeButton[1]");
    public override bool CanTap(AppiumElement element) => element.Enabled
        && string.Equals(element.GetAttribute("hittable"), "true", StringComparison.OrdinalIgnoreCase);
    public override void Tap(AppiumDriver driver, AppiumElement element)
    {
        // Use an explicit touch at the current center of the native control.
        // Coordinates are relative to the element when elementId is supplied.
        var size = element.Size;
        driver.ExecuteScript("mobile: tap", new Dictionary<string, object>
        {
            ["elementId"] = element.Id,
            ["x"] = size.Width / 2.0,
            ["y"] = size.Height / 2.0
        });
    }
    public override void GoBack(AppiumDriver driver) => Tap(driver, driver.FindElement(FlyoutButton));
    public override AppiumDriver CreateDriver(Uri server, AppiumOptions options) =>
        // Cover simulator/app preparation plus one bounded WDA startup attempt.
        new IOSDriver(server, options, TimeSpan.FromMinutes(4));
}
