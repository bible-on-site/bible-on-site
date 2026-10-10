using System.Diagnostics;
using OpenQA.Selenium;

namespace BibleOnSite.Tests.MobileE2E;

// A session-startup failure can come from the device transport rather than the
// app under test: "adb: device offline" is a stale adb transport, not a dead
// emulator. Probing `adb -s <udid> get-state` distinguishes the two cases —
// only a transport that fails to report "device" is reconnected and retried.
// A genuinely dead emulator still fails after reconnect, so recovery can never
// mask an app regression.
internal static class DeviceTransportRecovery
{
    private const int ProbeTimeoutMs = 15_000;
    private const int WaitForDeviceTimeoutMs = 45_000;

    internal static bool TryReconnect(Exception startupFailure)
    {
        if (startupFailure is not WebDriverException)
        {
            return false;
        }
        var udid = Environment.GetEnvironmentVariable("MOBILE_UDID");
        if (!string.Equals(Environment.GetEnvironmentVariable("MOBILE_PLATFORM"), "Android", StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrEmpty(udid))
        {
            return false;
        }
        var adb = ResolveAdb();
        if (adb == null)
        {
            return false;
        }
        if (Probe(adb, udid) == "device")
        {
            // The transport is healthy, so the failure came from the app or the
            // session payload — retrying cannot help it.
            return false;
        }
        Run(adb, "reconnect", ProbeTimeoutMs);
        Run(adb, $"-s {udid} wait-for-device", WaitForDeviceTimeoutMs);
        return Probe(adb, udid) == "device";
    }

    // Captured into session-startup diagnostics so a transport loss is visible
    // in the artifacts instead of only in the Appium server log.
    internal static string DeviceListing()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("MOBILE_PLATFORM"), "Android", StringComparison.OrdinalIgnoreCase))
        {
            return string.Empty;
        }
        var adb = ResolveAdb();
        if (adb == null)
        {
            return string.Empty;
        }
        var output = Run(adb, "devices -l", ProbeTimeoutMs);
        return output is null ? string.Empty : $"\nadb devices -l:\n{output}";
    }

    private static string? Probe(string adb, string udid) =>
        Run(adb, $"-s {udid} get-state", ProbeTimeoutMs)?.Trim();

    private static string? ResolveAdb()
    {
        foreach (var root in new[]
        {
            Environment.GetEnvironmentVariable("ANDROID_SDK_ROOT"),
            Environment.GetEnvironmentVariable("ANDROID_HOME"),
        })
        {
            if (string.IsNullOrEmpty(root))
            {
                continue;
            }
            var candidate = Path.Join(root, "platform-tools", "adb");
            if (File.Exists(candidate) || File.Exists(candidate + ".exe"))
            {
                return candidate;
            }
        }
        return "adb";
    }

    private static string? Run(string command, string arguments, int timeoutMs)
    {
        var start = new ProcessStartInfo(command, arguments)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        try
        {
            using var process = Process.Start(start);
            if (process == null)
            {
                return null;
            }
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(timeoutMs))
            {
                process.Kill(entireProcessTree: true);
                return null;
            }
            return process.ExitCode == 0 ? output.Result : null;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
