using OpenQA.Selenium;

namespace BibleOnSite.Tests.MobileE2E;

// Appium reports a dead session through its HTTP proxy, not a typed status: a
// dropped adb transport ("device offline") kills the instrumentation and logcat
// streams together (exit 255), and a crashed WebDriverAgent stops answering
// while the session id stays allocated. Recognizing these signatures lets a
// scenario rebuild the session once instead of failing on infrastructure loss.
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
