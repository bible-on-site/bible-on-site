using OpenQA.Selenium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class DeviceSessionDeathTests
{
    [Theory]
    // UiAutomator2 instrumentation exits with the logcat stream when adb drops.
    [InlineData("Could not proxy command to the remote server. Original error: socket hang up")]
    [InlineData("'GET /screenshot' cannot be proxied to UiAutomator2 server because the " +
        "instrumentation process is not running (probably crashed).")]
    // WebDriverAgent crash leaves the session id allocated but unreachable.
    [InlineData("Unable to connect to WebDriverAgent at http://127.0.0.1:8100")]
    [InlineData("invalid session id")]
    [InlineData("A session is either terminated or not started")]
    [InlineData("Original error: connect ECONNREFUSED 127.0.0.1:8200")]
    public void MatchesDeadSessionTransportErrors(string message) =>
        Assert.True(DeviceSessionDeath.Matches(new UnknownErrorException(message)));

    [Fact]
    public void RejectsFailuresUnrelatedToTheTransport()
    {
        Assert.False(DeviceSessionDeath.Matches(
            new WebDriverTimeoutException("No visible element matching the locator met the condition.")));
        Assert.False(DeviceSessionDeath.Matches(
            new WebDriverException("element click intercepted: other element would receive the click")));
    }

    [Fact]
    public void RejectsNonDriverFailuresEvenWithTransportWording() =>
        Assert.False(DeviceSessionDeath.Matches(new InvalidOperationException("socket hang up")));
}
