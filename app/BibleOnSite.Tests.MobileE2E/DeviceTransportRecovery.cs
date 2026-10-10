using System.ComponentModel;
using System.Diagnostics;
using OpenQA.Selenium;

namespace BibleOnSite.Tests.MobileE2E;

// The mirror image of DeviceSessionDeath: "device offline" and
// "no devices/emulators" mean the client lost the adb transport while the
// Appium session's server-side state is indeterminate — it may still be
// tearing down. Nothing here claims the session is dead, so cleanup failures
// carrying these signatures must stay latched (see MobileDeviceSessionFactory)
// until a retried teardown confirms Appium released the session.
internal static class DeviceTransportLoss
{
    private static readonly string[] Signatures =
    [
        "device offline",
        "no devices/emulators",
    ];

    public static bool Matches(Exception exception) =>
        exception is WebDriverException &&
        Signatures.Any(signature => exception.ToString().Contains(signature, StringComparison.OrdinalIgnoreCase));
}

// A session-startup failure can come from the device transport rather than the
// app under test: "adb: device offline" is a stale adb transport, not a dead
// emulator. Recovery only runs for those transport signatures, probes
// `adb -s <udid>` first, and reconnects when the transport is gone — then
// requires the same readiness signal waitForAndroidDevice gates on (booted
// system, responsive package manager) before the one session retry is spent.
// A genuinely dead emulator still fails readiness, so recovery can never
// mask an app regression.
internal static class DeviceTransportRecovery
{
    private const int ProbeTimeoutMs = 15_000;
    private const int WaitForDeviceTimeoutMs = 45_000;
    private const int ReadinessRounds = 2;

    internal static bool TryReconnect(Exception failure)
    {
        if (!DeviceTransportLoss.Matches(failure))
        {
            return false;
        }
        var udid = Environment.GetEnvironmentVariable("MOBILE_UDID");
        if (!string.Equals(Environment.GetEnvironmentVariable("MOBILE_PLATFORM"), "Android", StringComparison.OrdinalIgnoreCase)
            || udid is null || !IsValidSerial(udid))
        {
            return false;
        }
        if (IsResponsive(udid))
        {
            // The transport is healthy, so the failure came from the app or the
            // session payload — retrying cannot help it.
            return false;
        }
        Run(["reconnect"], ProbeTimeoutMs);
        // wait-for-device returns the moment the transport is back, but Android
        // can still be recovering; readiness is re-probed so a half-awake
        // device does not burn the single retry on an early session attempt.
        for (var round = 0; round < ReadinessRounds; round++)
        {
            Run(["-s", udid, "wait-for-device"], WaitForDeviceTimeoutMs);
            if (IsResponsive(udid))
            {
                return true;
            }
        }
        return false;
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

    // Mirrors waitForAndroidDevice's ready signal (android-readiness.mjs): the
    // transport answers, the system booted, and the package manager serves
    // queries. A bare "device" state can precede both after a reconnect and
    // burn the only retry while Android is still recovering.
    private static bool IsResponsive(string udid) =>
        Probe(udid) == "device"
        && Shell(udid, "getprop", "sys.boot_completed") == "1"
        && Shell(udid, "pm", "path", "android")?.StartsWith("package:", StringComparison.Ordinal) == true;

    private static string? Probe(string udid) =>
        Run(["-s", udid, "get-state"], ProbeTimeoutMs)?.Trim();

    private static string? Shell(string udid, params string[] command) =>
        Run(["-s", udid, "shell", ..command], ProbeTimeoutMs)?.Trim();

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
        catch (Exception exception) when (exception is Win32Exception
            or InvalidOperationException or ObjectDisposedException
            or IOException or NotSupportedException or AggregateException)
        {
            return null;
        }
    }
}
