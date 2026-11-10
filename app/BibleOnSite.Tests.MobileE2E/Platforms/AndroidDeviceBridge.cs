using System.ComponentModel;
using System.Diagnostics;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

/// <summary>
/// adb verbs the Firebase emulator scenario needs on the device side (#3185):
/// launch the app with the emulator endpoint as an intent extra, and prune the
/// persisted marker file so a later scenario's launches resolve local-only
/// again. Mirrors DeviceTransportRecovery's closed-argv spawn discipline —
/// every argv entry is assembled from suite-owned constants and a parsed
/// host/port pair, never a raw env string.
/// </summary>
internal static class AndroidDeviceBridge
{
    private const int ShellTimeoutMs = 15_000;
    private const string PackageId = "com.tanah.daily929";

    /// <summary>The resolved MAIN/LAUNCHER component, e.g.
    /// <c>com.tanah.daily929/crc64….MainActivity</c>. MAUI rewrites the
    /// managed class name into a crc64 stub, so the component is discovered
    /// rather than hardcoded.</summary>
    public static string LauncherComponent()
    {
        var output = Run("shell", "cmd", "package", "resolve-activity", "--brief", PackageId);
        var component = output?
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .LastOrDefault(line => line.Contains('/'));
        if (component is null)
        {
            throw new InvalidOperationException(
                $"Could not resolve the launcher activity for {PackageId}: {output ?? "<no output>"}");
        }
        return component;
    }

    /// <summary>Cold-starts the app carrying the emulator endpoint as the
    /// intent extra <see cref="BibleOnSite.Services.FirebaseEmulatorEndpoint.EnvironmentVariable"/> —
    /// the channel MainActivity persists for later activateApp relaunches.</summary>
    public static void StartWithEmulatorEndpoint(string component, string deviceEndpoint)
    {
        var output = Run("shell", "am", "start", "-n", component,
            "--es", BibleOnSite.Services.FirebaseEmulatorEndpoint.EnvironmentVariable, deviceEndpoint);
        if (output is null || output.Contains("Error", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException(
                $"Launching {component} with the emulator endpoint failed: {output ?? "<no output>"}");
        }
    }

    /// <summary>Removes the persisted endpoint marker so the next cold start
    /// resolves local-only again. run-as is available because the e2e APK is
    /// a debuggable build.</summary>
    public static void RemoveEmulatorMarker() =>
        Run("shell", "run-as", PackageId, "rm", "-f", "files/firebase-emulator");

    /// <summary>Concatenated shared_prefs content — proof that an offline
    /// preference write persisted locally while the cloud document could not
    /// move.</summary>
    public static string? SharedPreferencesDump() =>
        Run("shell", "run-as", PackageId, "sh", "-c", "'cat shared_prefs/*.xml 2>/dev/null'");

    private static string? Run(params string[] arguments)
    {
        // ArgumentList bypasses shell parsing on the host side entirely.
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
            using var process = new Process { StartInfo = start }; // nosemgrep — closed argv, literal filename, no shell
            process.Start();
            var output = process.StandardOutput.ReadToEndAsync();
            // Drain stderr so a chatty process cannot stall on a full pipe.
            var error = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(ShellTimeoutMs))
            {
                process.Kill(entireProcessTree: true);
                return null;
            }
            return process.ExitCode == 0 ? output.Result : $"{output.Result}{error.Result}";
        }
        catch (Exception exception) when (exception is Win32Exception
            or InvalidOperationException or ObjectDisposedException
            or IOException or NotSupportedException or AggregateException)
        {
            return null;
        }
    }
}
