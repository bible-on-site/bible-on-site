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
    [InlineData(MobilePlatform.Android, "UiAutomator2", "appPackage", "bundleId")]
    [InlineData(MobilePlatform.IOS, "XCUITest", "bundleId", "appPackage")]
    public void CreatesIsolatedCapabilitiesForEachDevice(
        MobilePlatform platform, string automation, string appIdKey, string otherPlatformKey)
    {
        var configuration = new MobileTestConfiguration(platform, "/test/app", "specific-device", "/test/artifacts", new("http://localhost:4723"));
        var options = MobilePlatformAdapter.For(platform).CreateOptions(configuration).ToDictionary();
        Assert.Equal(automation, options["appium:automationName"]);
        Assert.Equal("specific-device", options["appium:udid"]);
        Assert.Equal("com.tanah.daily929", options[$"appium:{appIdKey}"]);
        Assert.Equal(true, options["appium:fullReset"]);
        Assert.False(options.ContainsKey($"appium:{otherPlatformKey}"));
    }
}
