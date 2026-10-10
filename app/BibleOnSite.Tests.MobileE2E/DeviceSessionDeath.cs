using OpenQA.Selenium;

namespace BibleOnSite.Tests.MobileE2E;

// Appium reports a dead session through its HTTP proxy, not a typed status:
// the instrumentation and logcat streams die together (exit 255) when the
// device drops mid-scenario, and a crashed WebDriverAgent stops answering
// while the session id stays allocated. Every signature here means Appium
// already lost the session server-side, so a replacement has nothing to race.
// A dropped adb transport is deliberately NOT death — the server-side session
// may still be tearing down, so DeviceTransportLoss keeps it ambiguous.
// Assertion and timeout failures never match.
internal static class DeviceSessionDeath
{
    private static readonly string[] Signatures =
    [
        "socket hang up",
        "cannot be proxied",
        "could not proxy command",
        "instrumentation process is not running",
        "invalid session id",
        "session is either terminated",
        "econnrefused",
        "connection refused",
        "to webdriveragent",
    ];

    public static bool Matches(Exception exception) =>
        exception is WebDriverException &&
        Signatures.Any(signature => exception.ToString().Contains(signature, StringComparison.OrdinalIgnoreCase));
}
