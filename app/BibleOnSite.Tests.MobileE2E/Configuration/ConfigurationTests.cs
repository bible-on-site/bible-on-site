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
        if (platform == MobilePlatform.IOS)
        {
            Assert.Equal(true, options["appium:enforceAppInstall"]);
            Assert.Equal(true, options["appium:usePreinstalledWDA"]);
            Assert.Equal("/test/WebDriverAgentRunner-Runner.app", options["appium:prebuiltWDAPath"]);
            Assert.Equal(1, options["appium:wdaStartupRetries"]);
        }
        else
        {
            Assert.False(options.ContainsKey("appium:prebuiltWDAPath"));
        }
        Assert.False(options.ContainsKey($"appium:{otherPlatformKey}"));
    }
}
