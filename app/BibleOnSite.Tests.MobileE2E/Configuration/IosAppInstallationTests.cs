using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Platforms;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosAppInstallationTests
{
    private const string Nonce = "50a16675077e44749d1e4eb503c1ea67";
    private static MobileTestConfiguration Configuration => new(MobilePlatform.IOS, "/test/BibleOnSite.app",
        "4AD2086B-7B8F-4608-A742-AA422A0B8D74", "/test/artifacts", new("http://localhost:4723"))
    { PrebuiltWdaPath = "/test/WebDriverAgentRunner-Runner.app" };

    private static Dictionary<string, object> Receipt() => new()
    {
        ["kind"] = "ios-verified-install/1", ["udid"] = Configuration.DeviceId,
        ["appPath"] = Configuration.AppPath, ["nonce"] = Nonce,
        ["bundleId"] = "com.tanah.daily929", ["bundleSha256"] = new string('a', 64), ["keepData"] = false
    };

    [Fact]
    public void ExactCurrentReceiptEnablesBundleOnlyCapabilitiesWithoutRepeatingInstallOrScrub()
    {
        var proof = IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(Receipt()), Configuration, Nonce);
        var options = new IosPlatformAdapter().CreateOptions(Configuration with { VerifiedIosApp = proof }).ToDictionary();
        Assert.False(options.ContainsKey("appium:app"));
        Assert.False(options.ContainsKey("appium:enforceAppInstall"));
        Assert.Equal("com.tanah.daily929", options["appium:bundleId"]);
        Assert.Equal(true, options["appium:noReset"]);
        Assert.Equal(false, options["appium:fullReset"]);
        Assert.Equal(true, options["appium:forceAppLaunch"]);
        Assert.Equal(180000, options["appium:wdaLaunchTimeout"]);
    }

    [Theory]
    [InlineData("kind", "ios-verified-install/0")]
    [InlineData("nonce", "00000000000000000000000000000000")]
    [InlineData("udid", "different-device")]
    [InlineData("appPath", "/another/BibleOnSite.app")]
    [InlineData("bundleId", "com.other.app")]
    [InlineData("bundleSha256", "not-a-hash")]
    public void RefusesStaleOrMismatchedInstallationReceipts(string field, string value)
    {
        var receipt = Receipt();
        receipt[field] = value;
        Assert.Throws<InvalidOperationException>(() =>
            IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(receipt), Configuration, Nonce));
    }

    [Fact]
    public void ReceiptCannotSubstituteReviewRetentionForNormalFreshData()
    {
        var receipt = Receipt();
        receipt["keepData"] = true;
        Assert.Throws<InvalidOperationException>(() =>
            IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(receipt), Configuration, Nonce));
    }

    [Fact]
    public void ProofCannotBeReusedForAnotherDeviceWhenBuildingCapabilities()
    {
        var proof = IosAppInstallation.ParseReceipt(JsonSerializer.Serialize(Receipt()), Configuration, Nonce);
        Assert.Throws<InvalidOperationException>(() => new IosPlatformAdapter().CreateOptions(
            Configuration with { DeviceId = "another-device", VerifiedIosApp = proof }));
    }

    [Fact]
    public void AnInheritedPreinstalledFlagAloneCannotSkipIosInstallation()
    {
        var options = new IosPlatformAdapter().CreateOptions(Configuration with { AppPreinstalled = true }).ToDictionary();
        Assert.Equal(Configuration.AppPath, options["appium:app"]);
        Assert.Equal(false, options["appium:noReset"]);
        Assert.Equal(true, options["appium:enforceAppInstall"]);
    }
}
