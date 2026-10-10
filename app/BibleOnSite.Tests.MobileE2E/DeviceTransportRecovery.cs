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
            || udid is null || !IsValidSerial(udid))
        {
            return false;
        }
        if (Probe(udid) == "device")
        {
            // The transport is healthy, so the failure came from the app or the
            // session payload — retrying cannot help it.
            return false;
        }
        Run(["reconnect"], ProbeTimeoutMs);
        Run(["-s", udid, "wait-for-device"], WaitForDeviceTimeoutMs);
        return Probe(udid) == "device";
    }

    // Captured into session-startup diagnostics so a transport loss is visible
    // in the artifacts instead of only in the Appium server log.
    internal static string DeviceListing()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("MOBILE_PLATFORM"), "Android", StringComparison.OrdinalIgnoreCase))
        {
            return string.Empty;
        }
        var output = Run(["devices", "-l"], ProbeTimeoutMs);
        return output is null ? string.Empty : $"\nadb devices -l:\n{output}";
    }

    // adb serials are dotted/dashed device ids only (emulator-5554, host:port).
    // Rejecting anything else keeps the env-derived value out of argv injection.
    private static bool IsValidSerial(string? serial) =>
        serial is { Length: > 0 and <= 64 } &&
        serial.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_' or ':');

    private static string? Probe(string udid) =>
        Run(["-s", udid, "get-state"], ProbeTimeoutMs)?.Trim();

    private static string? Run(string[] arguments, int timeoutMs)
    {
        var start = new ProcessStartInfo("adb")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }
        try
        {
            using var process = Process.Start(start);
            if (process == null)
            {
                return null;
            }
            var output = process.StandardOutput.ReadToEndAsync();
            // Drain stderr so a chatty process cannot stall on a full pipe.
            _ = process.StandardError.ReadToEndAsync();
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
