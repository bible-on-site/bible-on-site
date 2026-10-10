using OpenQA.Selenium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class DeviceTransportLossTests
{
    [Theory]
    // adb reports a dropped emulator transport while a session is being built.
    [InlineData("Error executing adbExec. Original error: 'Command 'adb -P 5037 -s emulator-5554 " +
        "shell dumpsys package io.appium.uiautomator2.server' exited with code 1'; Command output: adb: device offline")]
    [InlineData("adb: error: no devices/emulators found")]
    public void MatchesDroppedTransports(string message) =>
        Assert.True(DeviceTransportLoss.Matches(new UnknownErrorException(message)));

    [Fact]
    public void RejectsNonDriverFailuresEvenWithTransportWording() =>
        Assert.False(DeviceTransportLoss.Matches(new InvalidOperationException("adb: device offline")));

    [Fact]
    public void RejectsDriverFailuresUnrelatedToTheTransport() =>
        Assert.False(DeviceTransportLoss.Matches(
            new WebDriverTimeoutException("No visible element matching the locator met the condition.")));
}

[Trait("Category", "Unit")]
public sealed class DeviceTransportRecoveryTests
{
    [Fact]
    public void RejectsNonDriverFailures() =>
        Assert.False(DeviceTransportRecovery.TryReconnect(new InvalidOperationException("device offline")));

    [Fact]
    public void RejectsDriverFailuresWithoutTheTransportSignature() =>
        // Recovery exists for a dropped adb transport, not every driver error.
        Assert.False(DeviceTransportRecovery.TryReconnect(
            new WebDriverException("element click intercepted")));

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
