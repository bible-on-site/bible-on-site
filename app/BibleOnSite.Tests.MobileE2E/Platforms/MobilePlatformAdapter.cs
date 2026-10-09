using BibleOnSite.Tests.MobileE2E.Configuration;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;
using OpenQA.Selenium.Appium.iOS;
using OpenQA.Selenium.Interactions;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

// Shared scenarios depend on this contract. Native navigation, locators and
// intentional layout differences belong in adapters, rather than test branches.
public abstract class MobilePlatformAdapter
{
    public virtual LayoutExpectations Layout => new();
    public abstract By AutomationId(string id);
    public abstract By FlyoutButton { get; }
    public virtual bool CanTap(AppiumElement element) => element.Enabled;
    public abstract bool IsChecked(AppiumElement element);
    public virtual void Tap(AppiumDriver driver, AppiumElement element) => element.Click();
    public abstract void GoBack(AppiumDriver driver);
    public virtual void GoBackFromFocusedVerse(AppiumDriver driver) => GoBack(driver);
    public virtual void DismissSearchSheet(AppiumDriver driver) => GoBack(driver);

    public void RevealTrailingSearchChips(AppiumDriver driver)
    {
        var chips = driver.FindElement(AutomationId("SearchFilterChips"));
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        var y = chips.Location.Y + chips.Size.Height / 2;
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, chips.Location.X + chips.Size.Width / 4, y, TimeSpan.Zero));
        sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, chips.Location.X + chips.Size.Width * 4 / 5, y, TimeSpan.FromMilliseconds(400)));
        sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
        driver.PerformActions([sequence]);
    }
    public abstract AppiumDriver CreateDriver(Uri server, AppiumOptions options);

    /// <summary>
    /// RTL navigation drawer gesture: a swipe starting at the right screen edge
    /// and travelling left. The perek carousel competes for the same touches on
    /// iOS, so the sequence must begin inside the native edge band (#1306).
    /// </summary>
    public virtual void OpenFlyoutViaRightEdgeSwipe(AppiumDriver driver) =>
        driver.PerformActions([CreateEdgeSwipeSequence(driver.Manage().Window.Size)]);

    /// <summary>
    /// Tap the dimmed area beside the open drawer. The RTL drawer slides in from
    /// the right with a fixed width, so the scrim occupies only the left sliver —
    /// tap near the left edge to stay off the drawer on narrow phones.
    /// </summary>
    public virtual void DismissFlyoutViaScrim(AppiumDriver driver)
    {
        var window = driver.Manage().Window.Size;
        TapAtPoint(driver, Math.Max(8, window.Width / 10), window.Height / 2);
    }

    public virtual void TapAtPoint(AppiumDriver driver, int x, int y) =>
        driver.PerformActions([CreateTapAtSequence(x, y)]);

    internal static ActionSequence CreateTapAtSequence(int x, int y)
    {
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, y, TimeSpan.Zero));
        sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
        sequence.AddAction(finger.CreatePause(TimeSpan.FromMilliseconds(100)));
        sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
        return sequence;
    }

    internal static ActionSequence CreateEdgeSwipeSequence(System.Drawing.Size window)
    {
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        var startX = window.Width - 2;
        var endX = window.Width / 3;
        var y = window.Height / 2;
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, startX, y, TimeSpan.Zero));
        sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
        // Several short drags keep continuous inward motion for the native edge
        // recognizer instead of a single jump that reads as a flick to nowhere.
        const int steps = 6;
        for (var i = 1; i <= steps; i++)
        {
            var x = startX - (startX - endX) * i / steps;
            sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, y,
                TimeSpan.FromMilliseconds(50)));
        }
        sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
        return sequence;
    }

    /// <summary>
    /// Bundle/package id the suite drives.
    /// </summary>
    public abstract string AppId { get; }

    /// <summary>
    /// Restore a known app state between scenarios on the shared session:
    /// restart the process with the scenario's launch environment and put the
    /// device back in portrait. Data such as the built search index survives,
    /// which is what lets the suite share one session at all.
    /// </summary>
    public abstract void RestartApp(AppiumDriver driver, IReadOnlyDictionary<string, string>? environment);

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
        options.AddAdditionalAppiumOption("noReset", configuration.KeepAppForReview);
        // Android fully uninstalls the app. iOS resets and reinstalls it through
        // noReset=false and enforceAppInstall=true while the device stays booted.
        options.AddAdditionalAppiumOption("fullReset", android && !configuration.KeepAppForReview);
        options.AddAdditionalAppiumOption("newCommandTimeout", 120);
        if (android)
        {
            options.AddAdditionalAppiumOption("appPackage", "com.tanah.daily929");
            options.AddAdditionalAppiumOption("autoGrantPermissions", true);
            options.AddAdditionalAppiumOption("uiautomator2ServerInstallTimeout", 120000);
            options.AddAdditionalAppiumOption("androidInstallTimeout", 180000);
            // Package-manager inspection after a full reinstall can wait for
            // the bundled commentary database's disk work on a cold emulator.
            options.AddAdditionalAppiumOption("adbExecTimeout", 60000);
            options.AddAdditionalAppiumOption("disableWindowAnimation", true);
        }
        else
        {
            options.AddAdditionalAppiumOption("bundleId", "com.tanah.daily929");
            options.AddAdditionalAppiumOption("autoAcceptAlerts", true);
            options.AddAdditionalAppiumOption("enforceAppInstall", true);
            options.AddAdditionalAppiumOption("isHeadless", true);
            // run.mjs exports device/lifecycle/crash logs independently. Appium's
            // duplicate live stream can stall cold simulator session startup.
            options.AddAdditionalAppiumOption("skipLogCapture", true);
            options.AddAdditionalAppiumOption("showXcodeLog", true);
            options.AddAdditionalAppiumOption("usePreinstalledWDA", true);
            options.AddAdditionalAppiumOption("prebuiltWDAPath", configuration.PrebuiltWdaPath
                ?? throw new ArgumentException("npm test must prepare MOBILE_WDA_PATH for iOS."));
            options.AddAdditionalAppiumOption("wdaStartupRetries", 1);
            options.AddAdditionalAppiumOption("wdaLaunchTimeout", 180000);
            // appium-webdriveragent applies this to every proxied WDA request,
            // including POST /session. A cold app launch can exceed 90s; keep the
            // server default (240s) inside the five-minute IOSDriver budget.
            options.AddAdditionalAppiumOption("wdaConnectionTimeout", 240000);
            // XCTest gates each proxied command on the app main thread going
            // idle for this threshold. The shared-CPU simulator rarely stays
            // quiet for even one second during reader scroll churn (perushim
            // HtmlView relayouts) or navigation animations, so queries stalled
            // for tens of seconds and the scroll storm's POST /actions once hit
            // the 240s proxy timeout. Zero disables the idle wait; page objects
            // already poll explicit element state instead of relying on WDA's
            // implicit synchronization.
            options.AddAdditionalAppiumOption("waitForIdleTimeout", 0);
            // The suite marker reaches the app through processArguments on the
            // session's own launch; per-scenario restarts pass it through
            // launchApp because XCUITest does not merge the two.
            options.AddAdditionalAppiumOption("processArguments",
                new Dictionary<string, object>
                {
                    ["env"] = new Dictionary<string, string>(IosE2eEnvironment)
                });
        }
        return options;
    }

    // Marks every suite launch so the app can run CI-only startup work such as
    // warming the search index while other scenarios execute.
    internal static readonly IReadOnlyDictionary<string, string> IosE2eEnvironment =
        new Dictionary<string, string> { ["BIBLE_E2E"] = "1" };

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
    public override string AppId => "com.tanah.daily929";

    public override void RestartApp(AppiumDriver driver,
        IReadOnlyDictionary<string, string>? environment)
    {
        driver.TerminateApp(AppId);
        driver.ActivateApp(AppId);
        driver.Orientation = ScreenOrientation.Portrait;
    }

    public override bool IsChecked(AppiumElement element) => element.GetAttribute("checked") == "true";
    // MAUI maps AutomationId to Android resource-id, preserving screen-reader text.
    public override By AutomationId(string id) => By.Id($"com.tanah.daily929:id/{id}");
    public override By FlyoutButton => AutomationId("ReaderNavigationButton");
    public override void GoBack(AppiumDriver driver) => driver.Navigate().Back();
    public override AppiumDriver CreateDriver(Uri server, AppiumOptions options) =>
        new AndroidDriver(server, options, TimeSpan.FromMinutes(4));
}

public sealed class IosPlatformAdapter : MobilePlatformAdapter
{
    public override string AppId => "com.tanah.daily929";

    public override void RestartApp(AppiumDriver driver,
        IReadOnlyDictionary<string, string>? environment)
    {
        driver.TerminateApp(AppId);
        if (environment is { Count: > 0 })
        {
            // mobile: launchApp replaces processArguments on the session's
            // launch, so the suite marker and the scenario's variables ride
            // together. It is heavier than activate and only pays when a
            // scenario actually needs launch environment.
            var env = new Dictionary<string, string>(IosE2eEnvironment);
            foreach (var (key, value) in environment)
            {
                env[key] = value;
            }
            driver.ExecuteScript("mobile: launchApp", new Dictionary<string, object>
            {
                ["bundleId"] = AppId,
                ["environment"] = env
            });
        }
        else
        {
            // /wda/apps/activate starts the terminated app again without the
            // launch payload's processArguments/env handling.
            driver.ExecuteScript("mobile: activateApp", new Dictionary<string, object>
            {
                ["bundleId"] = AppId
            });
        }
        driver.Orientation = ScreenOrientation.Portrait;
    }

    public override void DismissSearchSheet(AppiumDriver driver) => Tap(driver, driver.FindElement(AutomationId("SearchSheetDismissButton")));
    public override bool IsChecked(AppiumElement element) => element.GetAttribute("value") == "1";
    public override void GoBackFromFocusedVerse(AppiumDriver driver) => Tap(driver, driver.FindElement(AutomationId("SelectionBackButton")));
    public override By AutomationId(string id) => MobileBy.AccessibilityId(id);
    public override By FlyoutButton => AutomationId("ReaderNavigationButton");
    public override bool CanTap(AppiumElement element) => element.Enabled
        && string.Equals(element.GetAttribute("hittable"), "true", StringComparison.OrdinalIgnoreCase);
    public override void Tap(AppiumDriver driver, AppiumElement element)
    {
        // Use viewport coordinates rather than XCTest's element-relative tap.
        // One down/up pair with a short dwell produces a native touch, not a
        // long press or a second attempt when the expected UI does not appear.
        driver.PerformActions([CreateTapSequence(element.Location, element.Size)]);
    }
    internal static ActionSequence CreateTapSequence(System.Drawing.Point location, System.Drawing.Size size) =>
        CreateTapAtSequence(location.X + size.Width / 2, location.Y + size.Height / 2);
    public override void GoBack(AppiumDriver driver)
    {
        var button = driver.FindElements(By.XPath("//XCUIElementTypeNavigationBar/XCUIElementTypeButton[1]"))
            .FirstOrDefault(element => element.Displayed && CanTap(element));
        if (button != null)
        {
            Tap(driver, button);
            return;
        }
        // Reader jumps keep the hamburger. Use iOS's standard RTL edge-back gesture.
        driver.PerformActions([CreateEdgeSwipeSequence(driver.Manage().Window.Size)]);
    }
    public override AppiumDriver CreateDriver(Uri server, AppiumOptions options) =>
        // The five-minute client budget fits inside the ten-minute per-test hang
        // guard, together with the scenario.
        new IOSDriver(server, options, TimeSpan.FromMinutes(5));
}
