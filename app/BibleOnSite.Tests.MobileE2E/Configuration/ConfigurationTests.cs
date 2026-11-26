using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class ConfigurationTests
{
    [Theory]
    [InlineData("Android", MobilePlatform.Android)]
    [InlineData("iOS", MobilePlatform.IOS)]
    public void ChoosesTheExplicitPlatform(string value, MobilePlatform expected) =>
        Assert.Equal(expected, MobileTestConfiguration.ParsePlatform(value));

    [Theory]
    [InlineData(null)]
    [InlineData("Windows")]
    [InlineData("")]
    public void RejectsMissingOrUnsupportedPlatforms(string? value) =>
        Assert.Throws<ArgumentException>(() => MobileTestConfiguration.ParsePlatform(value));

    [Theory]
    [InlineData(MobilePlatform.Android, "UiAutomator2", "appPackage", "bundleId", "36")]
    [InlineData(MobilePlatform.IOS, "XCUITest", "bundleId", "appPackage", "26.5")]
    public void CreatesIsolatedCapabilitiesForEachDevice(
        MobilePlatform platform, string automation, string appIdKey, string otherPlatformKey, string version)
    {
        var configuration = new MobileTestConfiguration(platform, "/test/app", "specific-device", "/test/artifacts", new("http://localhost:4723"))
        {
            PlatformVersion = version,
            PrebuiltWdaPath = "/test/WebDriverAgentRunner-Runner.app"
        };
        var options = MobilePlatformAdapter.For(platform).CreateOptions(configuration).ToDictionary();
        Assert.Equal(automation, options["appium:automationName"]);
        Assert.Equal("specific-device", options["appium:udid"]);
        Assert.Equal(version, options["appium:platformVersion"]);
        Assert.Equal("com.tanah.daily929", options[$"appium:{appIdKey}"]);
        Assert.Equal(false, options["appium:noReset"]);
        Assert.Equal(platform == MobilePlatform.Android, options["appium:fullReset"]);
        Assert.Equal(false, options["appium:forceAppLaunch"]);
        if (platform == MobilePlatform.IOS)
        {
            Assert.Equal(true, options["appium:enforceAppInstall"]);
            Assert.Equal(true, options["appium:usePreinstalledWDA"]);
            Assert.Equal("/test/WebDriverAgentRunner-Runner.app", options["appium:prebuiltWDAPath"]);
            Assert.Equal(1, options["appium:wdaStartupRetries"]);
            Assert.Equal(240000, options["appium:wdaConnectionTimeout"]);
            using var deadlines = System.Text.Json.JsonDocument.Parse((string)options["appium:commandTimeouts"]);
            Assert.Equal(120000, deadlines.RootElement.GetProperty("default").GetInt32());
            Assert.Equal(240000, deadlines.RootElement.GetProperty("createSession").GetInt32());
            Assert.Equal(120000, deadlines.RootElement.GetProperty("execute").GetInt32());
            Assert.Equal(15000, deadlines.RootElement.GetProperty("deleteSession").GetInt32());
            // Idle checks are disabled (0): a churning reader never reaches
            // XCTest's idle threshold, so every proxied WDA command stalled.
            Assert.Equal(0, options["appium:waitForIdleTimeout"]);
            Assert.False(options.ContainsKey("appium:animationCoolOffTimeout"));
            Assert.Equal(true, options["appium:skipLogCapture"]);
            Assert.Equal(false, options["appium:shouldTerminateApp"]);
            var settings = Assert.IsType<Dictionary<string, object>>(options["appium:settings"]);
            Assert.Equal("visible,accessible", settings["pageSourceExcludedAttributes"]);
            Assert.Equal(false, settings["shouldUseCompactResponses"]);
            Assert.Equal("rect,displayed,text,enabled", settings["elementResponseAttributes"]);
            Assert.Equal(0.5, settings["animationCoolOffTimeout"]);
        }
        else
        {
            Assert.False(options.ContainsKey("appium:prebuiltWDAPath"));
            Assert.False(options.ContainsKey("appium:waitForIdleTimeout"));
            Assert.False(options.ContainsKey("appium:skipLogCapture"));
            Assert.False(options.ContainsKey("appium:shouldTerminateApp"));
            Assert.False(options.ContainsKey("appium:commandTimeouts"));
            // UiAutomator2 pays a ~500ms accessibility quiet window before
            // every lookup by default; the suite's explicit polling replaces
            // that implicit synchronization, so the idle wait is disabled.
            var settings = Assert.IsType<Dictionary<string, object>>(options["appium:settings"]);
            Assert.Equal(0, settings["waitForIdleTimeout"]);
        }
        Assert.False(options.ContainsKey($"appium:{otherPlatformKey}"));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void AndroidPreinstalledSessionReusesTheHarnessInstall(bool keepForReview)
    {
        var configuration = new MobileTestConfiguration(MobilePlatform.Android, "/test/app", "emulator-5554",
            "/test/artifacts", new("http://localhost:4723"))
        {
            AppPreinstalled = true,
            KeepAppForReview = keepForReview
        };
        var options = MobilePlatformAdapter.For(MobilePlatform.Android).CreateOptions(configuration).ToDictionary();
        Assert.Equal(true, options["appium:noReset"]);
        Assert.Equal(false, options["appium:fullReset"]);
        Assert.Equal(true, options["appium:forceAppLaunch"]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void IosCoverageSessionsDisableBackgroundAlertMonitoringBeforeTheFirstLaunch(bool coverageEnabled)
    {
        var configuration = new MobileTestConfiguration(MobilePlatform.IOS, "/test/app", "sim-device",
            "/test/artifacts", new("http://localhost:4723"))
        {
            PrebuiltWdaPath = "/test/WebDriverAgentRunner-Runner.app"
        };
        var options = new IosPlatformAdapter().CreateOptions(configuration, coverageEnabled).ToDictionary();
        Assert.Equal(!coverageEnabled, options["appium:autoAcceptAlerts"]);
    }

    [Fact]
    public void IosFirstLaunchMergesScenarioVariablesIntoAnIndependentEnvironment()
    {
        var configuration = new MobileTestConfiguration(MobilePlatform.IOS, "/test/app", "sim-device",
            "/test/artifacts", new("http://localhost:4723"))
        {
            PrebuiltWdaPath = "/test/WebDriverAgentRunner-Runner.app"
        };
        var supplied = new Dictionary<string, string>
        {
            ["BIBLE_E2E_PERUSHIM"] = "1",
            [ReaderStartupReadiness.LaunchIdEnvironmentVariable] = ReaderStartupReadiness.CreateLaunchId(),
            ["BIBLE_E2E_COVERAGE_PORT"] = "5000"
        };
        var adapter = new IosPlatformAdapter();
        var first = adapter.CreateOptions(configuration, supplied).ToDictionary();
        var arguments = Assert.IsType<Dictionary<string, object>>(first["appium:processArguments"]);
        var environment = Assert.IsType<Dictionary<string, string>>(arguments["env"]);
        Assert.Equal("1", environment["BIBLE_E2E"]);
        Assert.Equal(AppCoverage.Token, environment["BIBLE_E2E_COVERAGE_TOKEN"]);
        Assert.Equal("5000", environment["BIBLE_E2E_COVERAGE_PORT"]);
        Assert.Equal(supplied[ReaderStartupReadiness.LaunchIdEnvironmentVariable],
            environment[ReaderStartupReadiness.LaunchIdEnvironmentVariable]);
        Assert.Equal("1", environment["BIBLE_E2E_PERUSHIM"]);
        supplied["BIBLE_E2E_PERUSHIM"] = "changed after capability creation";
        Assert.Equal("1", environment["BIBLE_E2E_PERUSHIM"]);

        var next = adapter.CreateOptions(configuration).ToDictionary();
        var nextArguments = Assert.IsType<Dictionary<string, object>>(next["appium:processArguments"]);
        var nextEnvironment = Assert.IsType<Dictionary<string, string>>(nextArguments["env"]);
        Assert.False(nextEnvironment.ContainsKey("BIBLE_E2E_PERUSHIM"));
        Assert.False(nextEnvironment.ContainsKey(ReaderStartupReadiness.LaunchIdEnvironmentVariable));
        Assert.Equal(MobilePlatformAdapter.IosE2eEnvironment["BIBLE_E2E_COVERAGE_PORT"],
            nextEnvironment["BIBLE_E2E_COVERAGE_PORT"]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void IosScenarioEnvironmentForcesOneLaunchEvenWhenTheExistingInstallIsReused(bool keepForReview)
    {
        var configuration = new MobileTestConfiguration(MobilePlatform.IOS, "/test/app", "sim-device",
            "/test/artifacts", new("http://localhost:4723"))
        {
            PrebuiltWdaPath = "/test/WebDriverAgentRunner-Runner.app",
            KeepAppForReview = keepForReview
        };
        var supplied = new Dictionary<string, string>
        {
            [ReaderStartupReadiness.LaunchIdEnvironmentVariable] = ReaderStartupReadiness.CreateLaunchId()
        };
        var adapter = new IosPlatformAdapter();
        var options = adapter.CreateOptions(configuration, supplied).ToDictionary();
        Assert.Equal(true, options["appium:forceAppLaunch"]);
        Assert.Equal(keepForReview, options["appium:noReset"]);
        Assert.Equal(false, adapter.CreateOptions(configuration).ToDictionary()["appium:forceAppLaunch"]);
    }
}
