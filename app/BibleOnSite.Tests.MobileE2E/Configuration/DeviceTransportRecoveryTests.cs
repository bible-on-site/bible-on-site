using OpenQA.Selenium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class DeviceTransportRecoveryTests
{
    [Fact]
    public void RejectsNonDriverFailures() =>
        Assert.False(DeviceTransportRecovery.TryReconnect(new InvalidOperationException("device offline")));

    [Fact]
    public void RejectsDriverFailuresOutsideAndroid()
    {
        var platform = Environment.GetEnvironmentVariable("MOBILE_PLATFORM");
        var udid = Environment.GetEnvironmentVariable("MOBILE_UDID");
        try
        {
            Environment.SetEnvironmentVariable("MOBILE_PLATFORM", "iOS");
            Environment.SetEnvironmentVariable("MOBILE_UDID", "sim-udid");
            Assert.False(DeviceTransportRecovery.TryReconnect(new UnknownErrorException("device offline")));
        }
        finally
        {
            Environment.SetEnvironmentVariable("MOBILE_PLATFORM", platform);
            Environment.SetEnvironmentVariable("MOBILE_UDID", udid);
        }
    }

    [Fact]
    public void RejectsAndroidFailuresWithoutAConfiguredDevice()
    {
        var platform = Environment.GetEnvironmentVariable("MOBILE_PLATFORM");
        var udid = Environment.GetEnvironmentVariable("MOBILE_UDID");
        try
        {
            Environment.SetEnvironmentVariable("MOBILE_PLATFORM", "Android");
            Environment.SetEnvironmentVariable("MOBILE_UDID", null);
            Assert.False(DeviceTransportRecovery.TryReconnect(new UnknownErrorException("device offline")));
        }
        finally
        {
            Environment.SetEnvironmentVariable("MOBILE_PLATFORM", platform);
            Environment.SetEnvironmentVariable("MOBILE_UDID", udid);
        }
    }
}
