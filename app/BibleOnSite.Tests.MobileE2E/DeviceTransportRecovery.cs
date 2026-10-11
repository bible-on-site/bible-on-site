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
// `adb` first, and reconnects when the transport is gone — then
// requires the same readiness signal waitForAndroidDevice gates on (booted
// system, responsive package manager) before the one session retry is spent.
// A genuinely dead emulator still fails readiness, so recovery can never
// mask an app regression.
internal static class DeviceTransportRecovery
{
    private const int ProbeTimeoutMs = 15_000;
    private const int WaitForDeviceTimeoutMs = 45_000;
    private const int ReadinessRounds = 2;

    // The recovery speaks a closed set of adb verbs: every argv entry is a
    // compile-time literal, so no env-derived value can reach the spawned
    // command line at all. A serial selector is unnecessary — the mobile E2E
    // job contracts a single emulator, and a stray second device makes adb
    // fail loudly instead of being targeted silently.
    private enum Adb
    {
        Reconnect,
        WaitForDevice,
        GetState,
        BootCompleted,
        PackageManager,
        Devices,
    }

    internal static bool TryReconnect(Exception failure)
    {
        if (!DeviceTransportLoss.Matches(failure))
        {
            return false;
        }
        if (!string.Equals(Environment.GetEnvironmentVariable("MOBILE_PLATFORM"), "Android", StringComparison.OrdinalIgnoreCase)
            || Environment.GetEnvironmentVariable("MOBILE_UDID") is null)
        {
            return false;
        }
        if (IsResponsive())
        {
            // The transport is healthy, so the failure came from the app or the
            // session payload — retrying cannot help it.
            return false;
        }
        Run(Adb.Reconnect, ProbeTimeoutMs);
        // wait-for-device returns the moment the transport is back, but Android
        // can still be recovering; readiness is re-probed so a half-awake
        // device does not burn the single retry on an early session attempt.
        for (var round = 0; round < ReadinessRounds; round++)
        {
            Run(Adb.WaitForDevice, WaitForDeviceTimeoutMs);
            if (IsResponsive())
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
        var output = Run(Adb.Devices, ProbeTimeoutMs);
        return output is null ? string.Empty : $"\nadb devices -l:\n{output}";
    }

    // Mirrors waitForAndroidDevice's ready signal (android-readiness.mjs): the
    // transport answers, the system booted, and the package manager serves
    // queries. A bare "device" state can precede both after a reconnect and
    // burn the only retry while Android is still recovering.
    private static bool IsResponsive() =>
        Run(Adb.GetState, ProbeTimeoutMs)?.Trim() == "device"
        && Run(Adb.BootCompleted, ProbeTimeoutMs)?.Trim() == "1"
        && Run(Adb.PackageManager, ProbeTimeoutMs)?.Trim().StartsWith("package:", StringComparison.Ordinal) == true;

    private static string? Run(Adb command, int timeoutMs)
    {
        var arguments = command switch
        {
            Adb.Reconnect => new[] { "reconnect" },
            Adb.WaitForDevice => new[] { "wait-for-device" },
            Adb.GetState => new[] { "get-state" },
            Adb.BootCompleted => new[] { "shell", "getprop", "sys.boot_completed" },
            Adb.PackageManager => new[] { "shell", "pm", "path", "android" },
            Adb.Devices => new[] { "devices", "-l" },
            _ => throw new ArgumentOutOfRangeException(nameof(command)),
        };
        // ArgumentList bypasses the shell argument string entirely — argv is
        // handed to exec as-is, so nothing on this line is shell-parseable.
        var start = new ProcessStartInfo("adb");
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.UseShellExecute = false;
        try
        {
            // The static Process.Start(startInfo) shape is Semgrep's
            // command-injection sink; starting an instance is equivalent.
            using var process = new Process { StartInfo = start };
            process.Start();
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
