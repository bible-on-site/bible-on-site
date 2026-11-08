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
    /// <summary>
    /// Locates an element by its app-declared automation id. Every lookup is
    /// attributed to the active scenario's coverage evidence (#2085), so tests
    /// and page objects must resolve ids through this method rather than
    /// building platform locators by hand.
    /// </summary>
    public By AutomationId(string id)
    {
        CoverageEvidence.RecordAutomationId(id);
        return LocateAutomationId(id);
    }
    protected abstract By LocateAutomationId(string id);

    /// <summary>
    /// Like <see cref="AutomationId"/>, narrowed on the device to elements whose
    /// text equals <paramref name="text"/>. Callers still check the text.
    /// </summary>
    public By AutomationIdWithText(string id, string text)
    {
        CoverageEvidence.RecordAutomationId(id);
        return LocateAutomationIdWithText(id, text);
    }
    protected virtual By LocateAutomationIdWithText(string id, string text) => LocateAutomationId(id);

    /// <summary>
    /// Like <see cref="AutomationId"/>, narrowed on the device to displayed
    /// elements. Callers still check the viewport.
    /// </summary>
    public By DisplayedAutomationId(string id)
    {
        CoverageEvidence.RecordAutomationId(id);
        return LocateDisplayedAutomationId(id);
    }
    protected virtual By LocateDisplayedAutomationId(string id) => LocateAutomationId(id);
    /// <summary>
    /// One locator matching any of several automation ids, so a "none of these
    /// is visible" check costs a single device query instead of one per id.
    /// </summary>
    public By AnyOfAutomationIds(params string[] ids)
    {
        foreach (var id in ids)
        {
            // Ids are interpolated into quoted locator strings unescaped.
            if (id.Length == 0 || !id.All(char.IsAsciiLetterOrDigit))
            {
                throw new ArgumentException($"Automation id '{id}' is not a plain identifier.", nameof(ids));
            }
            CoverageEvidence.RecordAutomationId(id);
        }
        return LocateAnyOfAutomationIds(ids);
    }
    protected abstract By LocateAnyOfAutomationIds(string[] ids);
    public abstract By FlyoutButton { get; }
    public virtual bool CanTap(AppiumElement element) => element.Enabled;
    public abstract bool IsChecked(AppiumElement element);
    // SemanticProperties.Description surfaces as content-desc on Android and
    // label on iOS; drivers reject an unknown attribute instead of returning
    // null, so each platform asks for only its own name.
    public abstract string? SemanticDescription(AppiumElement element);
    public virtual void Tap(AppiumDriver driver, AppiumElement element) => element.Click();

    public static (System.Drawing.Point Location, System.Drawing.Size Size) ReadFrame(AppiumElement element)
    {
        if (element is NativeLiveElement native)
        {
            var frame = native.ReadFrame();
            return (frame.Location, frame.Size);
        }
        return (element.Location, element.Size);
    }
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
        driver.PerformActions([CreateEdgeSwipeSequence(DriverTelemetry.WindowSize(driver))]);

    /// <summary>
    /// Tap the dimmed area beside the open drawer. The RTL drawer slides in from
    /// the right with a fixed width, so the scrim occupies only the left sliver —
    /// tap near the left edge to stay off the drawer on narrow phones.
    /// </summary>
    public virtual void DismissFlyoutViaScrim(AppiumDriver driver)
    {
        var window = DriverTelemetry.WindowSize(driver);
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

    /// <summary>
    /// A replacement Appium session starts fresh device-side state; anything the
    /// adapter remembered about the previous session's launches is invalid.
    /// </summary>
    public virtual void OnSessionRecreated()
    {
    }

    internal static void EnsurePortrait(AppiumDriver driver)
    {
        // The tracked orientation only needs a live read once per driver —
        // rotation writes update it through the telemetry funnel.
        if (DriverTelemetry.Orientation(driver) != ScreenOrientation.Portrait)
        {
            driver.Orientation = ScreenOrientation.Portrait;
        }
    }

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
        // The harness installs the Android package itself (see run.mjs)
        // with --no-incremental before the session starts, so UiAutomator2
        // must reuse it under noReset — a driver-initiated reinstall has
        // no incremental opt-out and would reintroduce the libmonodroid
        // open_from_bundles SIGSEGV (#2773).
        var reuseInstalledApp = configuration.KeepAppForReview || (android && configuration.AppPreinstalled);
        options.AddAdditionalAppiumOption("noReset", reuseInstalledApp);
        // Android fully uninstalls the app. iOS resets and reinstalls it through
        // noReset=false and enforceAppInstall=true while the device stays booted.
        options.AddAdditionalAppiumOption("fullReset", android && !reuseInstalledApp);
        // noReset keeps a leftover app process alive across sessions, and
        // UiAutomator2's session-start short-circuits the launch when the
        // package already runs — a prior class's mid-navigation screen would
        // then leak into the next session. forceAppLaunch keeps every session
        // start on the deterministic fresh launch the suite relies on.
        options.AddAdditionalAppiumOption("forceAppLaunch", android && reuseInstalledApp);
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
            // Intents cannot carry process environment like iOS launchApp can,
            // so the suite marker rides as an extra on the session's launch
            // intent; MainActivity persists it for the install's later
            // restarts whose adb activateApp calls drop extras.
            options.AddAdditionalAppiumOption("optionalIntentArguments",
                $"--ez BIBLE_E2E true --es BIBLE_E2E_COVERAGE_TOKEN {AppCoverage.Token}");
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
            // All scenario assertions can finish while XCTest's application
            // termination blocks DELETE /session. Let WDA release its session
            // without that app query; run.mjs owns bounded simulator termination
            // after the harness exits, preserving the existing delete deadline.
            options.AddAdditionalAppiumOption("shouldTerminateApp", false);
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
            // Scroll-storm drain keeps the app main thread busy well past 45s
            // (inertia scroll + cell recycle + HtmlView relayout), so snapshot
            // lookups were cut mid-drain and the session died on a healthy app.
            // 120s matches the execute budget; a genuinely wedged command still
            // fails inside the shard's hangdump bound, just ~75s later.
            options.AddAdditionalAppiumOption("commandTimeouts",
                "{\"default\":120000,\"createSession\":240000,\"execute\":120000,\"deleteSession\":15000}");
            if (configuration.WdaLocalPort is { } wdaLocalPort)
            {
                // A simulator's WDA binds the host loopback, so two devices on
                // one runner need distinct listen ports (#2083 shard peers).
                options.AddAdditionalAppiumOption("wdaLocalPort", wdaLocalPort);
            }
            // XCTest gates each proxied command on the app main thread going
            // idle for this threshold. The shared-CPU simulator rarely stays
            // quiet for even one second during reader scroll churn (perushim
            // HtmlView relayouts) or navigation animations, so queries stalled
            // for tens of seconds and the scroll storm's POST /actions once hit
            // the 240s proxy timeout. Zero disables the idle wait; page objects
            // already poll explicit element state instead of relying on WDA's
            // implicit synchronization.
            options.AddAdditionalAppiumOption("waitForIdleTimeout", 0);
            // Source XML is diagnostic/content evidence. Computing derived
            // visibility for every offscreen descendant cost 203s in nine
            // dumps. Live Displayed, viewport and hittable checks still run
            // through their native APIs; labels, IDs and geometry remain in XML.
            options.AddAdditionalAppiumOption("settings", new Dictionary<string, object>
            {
                ["pageSourceExcludedAttributes"] = "visible,accessible",
                // Return each candidate's real visibility and frame in its lookup.
                ["shouldUseCompactResponses"] = false,
                // Read-only geometry/text queries must not trigger XCTest's
                // hit testing during a UI transition. CanTap still requests
                // hittable explicitly when an interaction needs that check.
                ["elementResponseAttributes"] = "rect,displayed,text,enabled"
            });
            // The instrumented e2e build never goes quiescent at launch: the
            // coverage recorder and the search-index warmup keep worker threads
            // churning well past XCTest's launch window ("Timed out attempting
            // to launch app"). The suite's explicit WaitFor polling does the
            // real synchronization, so skipping the idle gate is safe.
            options.AddAdditionalAppiumOption("waitForQuiescence", false);
            // WDA holds every interaction until the app idles for this long
            // (default 2s). Scroll storms leave the app coasting between flicks,
            // so each gesture burst absorbed most of that wait — appium logs
            // showed /actions averaging 2.25s against it. Half a second still
            // covers routine transitions (~300ms menu/page animations) while
            // polls and settle loops do the real state verification.
            options.AddAdditionalAppiumOption("animationCoolOffTimeout", 0.5);
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
    internal static IReadOnlyDictionary<string, string> IosE2eEnvironment =>
        new Dictionary<string, string>
        {
            ["BIBLE_E2E"] = "1",
            ["BIBLE_E2E_COVERAGE_PORT"] = AppCoverage.Port.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["BIBLE_E2E_COVERAGE_TOKEN"] = AppCoverage.Token
        };

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
        EnsurePortrait(driver);
    }

    public override bool IsChecked(AppiumElement element) => element.GetAttribute("checked") == "true";
    public override string? SemanticDescription(AppiumElement element) => element.GetAttribute("content-desc");
    // MAUI maps AutomationId to Android resource-id, preserving screen-reader text.
    protected override By LocateAutomationId(string id) => By.Id($"com.tanah.daily929:id/{id}");
    protected override By LocateAnyOfAutomationIds(string[] ids) =>
        By.XPath($"//*[{string.Join(" or ", ids.Select(id => $"@resource-id='com.tanah.daily929:id/{id}'"))}]");
    public override By FlyoutButton => AutomationId("ReaderNavigationButton");
    public override void GoBack(AppiumDriver driver) => driver.Navigate().Back();
    public override AppiumDriver CreateDriver(Uri server, AppiumOptions options) =>
        new AndroidTimedDriver(server, options);
}

public sealed class IosPlatformAdapter : MobilePlatformAdapter
{
    public override string AppId => "com.tanah.daily929";

    public override void RestartApp(AppiumDriver driver,
        IReadOnlyDictionary<string, string>? environment)
    {
        driver.TerminateApp(AppId);
        // Activation brings a running app forward. After termination, XCTest's
        // activate path can block without launching a new process. Always use
        // the explicit launch path and replace its complete environment, so
        // synthetic commentary variables cannot leak into the next scenario.
        var env = new Dictionary<string, string>(IosE2eEnvironment);
        if (environment != null)
        {
            foreach (var (key, value) in environment)
            {
                env[key] = value;
            }
        }
        Relaunch(driver, "mobile: launchApp", new Dictionary<string, object>
        {
            ["bundleId"] = AppId,
            ["environment"] = env
        });
        EnsurePortrait(driver);
    }

    // XCTDaemon budgets each launch (~30s observed); on a loaded simulator
    // SpringBoard can still be releasing the terminated instance when the
    // request lands. The error only surfaces after that wait, so one immediate
    // retry usually lands cleanly — and a persistent launch failure still
    // propagates on the second attempt rather than being hidden.
    private static void Relaunch(AppiumDriver driver, string script, Dictionary<string, object> args)
    {
        try
        {
            driver.ExecuteScript(script, args);
        }
        catch (WebDriverException exception) when (IsTransientLaunchError(exception))
        {
            driver.ExecuteScript(script, args);
        }
    }

    internal static bool IsTransientLaunchError(WebDriverException exception)
        => exception.Message.Contains("Timed out attempting to launch");

    public override void DismissSearchSheet(AppiumDriver driver) => Tap(driver, driver.FindElement(AutomationId("SearchSheetDismissButton")));
    public override bool IsChecked(AppiumElement element) => element.GetAttribute("value") == "1";
    public override string? SemanticDescription(AppiumElement element) => element.GetAttribute("label");
    public override void GoBackFromFocusedVerse(AppiumDriver driver) => Tap(driver, driver.FindElement(AutomationId("SelectionBackButton")));
    protected override By LocateAutomationId(string id) => MobileBy.AccessibilityId(id);
    // WDA re-snapshots every match to build a findElements response, so a
    // lookup costs matches x tree size; filter natively to return only targets.
    protected override By LocateAutomationIdWithText(string id, string text) => new ByIosNSPredicate(
        $"name == {PredicateLiteral(id)} AND (value == {PredicateLiteral(text)} OR label == {PredicateLiteral(text)})");
    protected override By LocateDisplayedAutomationId(string id) =>
        new ByIosNSPredicate($"name == {PredicateLiteral(id)} AND visible == 1");
    internal static string PredicateLiteral(string value) =>
        $"'{value.Replace(@"\", @"\\").Replace("'", @"\'")}'";
    // An NSPredicate on name (the accessibility identifier) runs natively in
    // XCTest; XPath would make WDA serialize the whole hierarchy first.
    // Appium.WebDriver 9 has no MobileBy factory for it, only the By type.
    protected override By LocateAnyOfAutomationIds(string[] ids) =>
        new ByIosNSPredicate($"name IN {{{string.Join(",", ids.Select(id => $"'{id}'"))}}}");
    public override By FlyoutButton => AutomationId("ReaderNavigationButton");
    public override bool CanTap(AppiumElement element) => element.Enabled
        && string.Equals(element.GetAttribute("hittable"), "true", StringComparison.OrdinalIgnoreCase);
    public override void Tap(AppiumDriver driver, AppiumElement element)
    {
        // Use viewport coordinates rather than XCTest's element-relative tap.
        // One down/up pair with a short dwell produces a native touch, not a
        // long press or a second attempt when the expected UI does not appear.
        var frame = ReadFrame(element);
        driver.PerformActions([CreateTapSequence(frame.Location, frame.Size)]);
    }
    internal static ActionSequence CreateTapSequence(System.Drawing.Point location, System.Drawing.Size size) =>
        CreateTapAtSequence(location.X + size.Width / 2, location.Y + size.Height / 2);
    public override void GoBack(AppiumDriver driver)
    {
        // WDA can report success while the touch never became a navigation —
        // a tap landing mid-layout or an edge swipe the recognizer dropped.
        // Confirm the tree changed and reissue the gesture once, the same
        // one-retry idiom Relaunch uses for transient launch errors.
        var before = driver.PageSource;
        for (var attempt = 0; attempt < 2; attempt++)
        {
            // The shared capsule back is the app's visible back control on the
            // custom top-bar pages (preferences, readers) — all outside UIKit's
            // navigation bar (#2467).
            var button = driver.FindElements(AutomationId("TopBarBackButton"))
                .FirstOrDefault(element => element.Displayed && CanTap(element))
                ?? driver.FindElements(By.XPath("//XCUIElementTypeNavigationBar/XCUIElementTypeButton[1]"))
                    .FirstOrDefault(element => element.Displayed && CanTap(element));
            if (button != null)
            {
                Tap(driver, button);
            }
            else
            {
                // Reader jumps keep the hamburger. Use iOS's standard RTL edge-back gesture.
                driver.PerformActions([CreateEdgeSwipeSequence(DriverTelemetry.WindowSize(driver))]);
            }
            if (PageChanged(driver, before))
            {
                return;
            }
        }
    }
    private static bool PageChanged(AppiumDriver driver, string before) =>
        !string.Equals(driver.PageSource, before, StringComparison.Ordinal);
    public override AppiumDriver CreateDriver(Uri server, AppiumOptions options) =>
        // The five-minute client budget fits inside the ten-minute per-test hang
        // guard, together with the scenario.
        new IosSnapshotDriver(server, options);
}
