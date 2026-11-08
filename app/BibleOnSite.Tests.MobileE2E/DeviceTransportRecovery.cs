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
// emulator. The same drop also kills UiAutomator2's instrumentation, so a
// confirmed session death can ride a dead adb transport without ever naming
// it — "socket hang up" is how Appium reports that proxy loss. Recovery
// therefore probes `adb` for every transport-plausible failure and heals only
// when the probe proves the transport is gone: first the daemon's own
// reconnect (plus the kick aimed at entries wedged in "offline"), then a
// daemon restart when the daemon↔adbd link itself is stuck — the emulator
// stays up throughout. Readiness is the same signal waitForAndroidDevice
// gates on (booted system, responsive package manager) before the one session
// retry is spent. A genuinely dead emulator still fails readiness, so
// recovery can never mask an app regression.
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
        ReconnectOffline,
        KillServer,
        StartServer,
        WaitForDevice,
        GetState,
        BootCompleted,
        PackageManager,
        Devices,
    }

    // Only failures that can plausibly come from the adb transport earn a
    // probe: an explicit transport loss, or a session death whose cause may
    // have been adb dropping underneath it.
    internal static bool IsTransportPlausible(Exception exception) =>
        DeviceTransportLoss.Matches(exception) || DeviceSessionDeath.Matches(exception);

    internal static bool TryReconnect(Exception failure)
    {
        if (!IsTransportPlausible(failure))
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
        // `reconnect` asks the daemon to renegotiate the transport and
        // `reconnect offline` kicks an entry wedged in the "offline" state —
        // both stay below the session layer the suite rebuilds on top of.
        Run(Adb.Reconnect, ProbeTimeoutMs);
        Run(Adb.ReconnectOffline, ProbeTimeoutMs);
        if (AwaitResponsiveness())
        {
            return true;
        }
        // The transport stayed dead through the daemon's own kicks — the
        // daemon↔adbd link itself is wedged, the failure mode that left every
        // later session hitting "device offline" on a live emulator. A daemon
        // restart forces a fresh handshake and is the last lever below the
        // session layer before the device is honestly declared lost.
        Run(Adb.KillServer, ProbeTimeoutMs);
        Run(Adb.StartServer, ProbeTimeoutMs);
        return AwaitResponsiveness();
    }

    // wait-for-device returns the moment the transport is back, but Android
    // can still be recovering; readiness is re-probed so a half-awake device
    // does not burn the single retry on an early session attempt.
    private static bool AwaitResponsiveness()
    {
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
            Adb.ReconnectOffline => new[] { "reconnect", "offline" },
            Adb.KillServer => new[] { "kill-server" },
            Adb.StartServer => new[] { "start-server" },
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
            using var process = new Process { StartInfo = start }; // nosemgrep — closed enum argv, literal filename, no shell
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
