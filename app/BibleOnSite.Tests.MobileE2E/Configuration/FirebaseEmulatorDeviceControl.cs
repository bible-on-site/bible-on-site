using System.Diagnostics;
using System.Globalization;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium.Appium;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

/// <summary>
/// Per-scenario endpoint override for the emulator-gated app (#3185). The
/// offline-sync scenario points the app's Firebase client at a dead address
/// for one relaunch, then restores it — proving local saves survive and the
/// next launch converges with the Emulator Suite.
///
/// iOS receives the override as launch environment on the relaunch itself;
/// Android app processes cannot receive environment, so the same
/// <c>debug.bos.firebase.emulator.*</c> system properties the app reads are
/// set through adb — the channel the app-side config documents.
/// </summary>
internal static class FirebaseEmulatorDeviceControl
{
    /// <summary>Loopback port nothing listens on — connections fail fast.</summary>
    private const int DeadPort = 9;

    private const string HostProperty = "debug.bos.firebase.emulator.host";
    private const string AuthPortProperty = "debug.bos.firebase.emulator.auth.port";
    private const string FirestorePortProperty = "debug.bos.firebase.emulator.firestore.port";

    /// <summary>iOS relaunch environment pointing Auth+Firestore at the dead endpoint.</summary>
    public static IReadOnlyDictionary<string, string> OfflineLaunchEnvironment =>
        new Dictionary<string, string>
        {
            ["FIREBASE_EMULATOR_HOST"] = "127.0.0.1", //NOSONAR — loopback literal for the dead-endpoint override.
            ["FIREBASE_EMULATOR_AUTH_PORT"] = DeadPort.ToString(CultureInfo.InvariantCulture),
            ["FIREBASE_EMULATOR_FIRESTORE_PORT"] = DeadPort.ToString(CultureInfo.InvariantCulture),
        };

    /// <summary>
    /// Drops the app's persisted state — above all the Firebase Auth session —
    /// so the relaunch mints a fresh anonymous identity matching the wiped
    /// suite. Android clears the package data; iOS removes the app container
    /// (the Appium session reinstalls it moments later). A missing install is
    /// already clean, so "not installed" is tolerated on both platforms.
    /// </summary>
    public static void ClearAppData(MobileTestConfiguration configuration)
    {
        if (configuration.Platform == MobilePlatform.IOS)
        {
            // simctl uninstall removes the data container. A non-zero exit is
            // tolerable only when the app is genuinely absent — a failed
            // uninstall that leaves the app (and its Firebase session)
            // installed would silently corrupt the suite reset, so verify the
            // container is actually gone before continuing.
            var uninstall = Run("xcrun", "simctl", "uninstall", configuration.DeviceId, "com.tanah.daily929");
            if (uninstall.ExitCode == 0)
            {
                return;
            }
            var probe = Run("xcrun", "simctl", "get_app_container",
                configuration.DeviceId, "com.tanah.daily929", "app");
            if (probe.ExitCode == 0)
            {
                throw new InvalidOperationException(
                    $"simctl uninstall exited {uninstall.ExitCode} and the app remains installed: {uninstall.StandardError.Trim()}");
            }
            Console.WriteLine($"simctl uninstall: app already absent ({uninstall.StandardError.Trim()})");
            return;
        }
        var pmPathArguments = new[] { "shell", "pm", "path", "com.tanah.daily929" };
        var installed = RunAdbAllowFailure(configuration.DeviceId, pmPathArguments);
        // A transport/adb failure is not "not installed" — only an empty
        // successful answer means the package is absent (already clean).
        installed.EnsureZeroExitCode(pmPathArguments);
        if (installed.StandardOutput.Trim().Length == 0)
        {
            return;
        }
        RunAdb(configuration.DeviceId, "shell", "pm", "clear", "com.tanah.daily929");
    }

    /// <summary>Restarts the app under the platform's offline-endpoint mechanism.</summary>
    public static void RestartOffline(
        AppiumDriver driver, MobilePlatformAdapter platform, MobileTestConfiguration configuration)
    {
        if (configuration.Platform == MobilePlatform.IOS)
        {
            platform.RestartApp(driver, OfflineLaunchEnvironment);
            return;
        }
        SetAndroidEndpoint(configuration.DeviceId, "127.0.0.1", DeadPort, DeadPort); //NOSONAR — loopback literal for the dead-endpoint override.
        platform.RestartApp(driver, null);
    }

    /// <summary>Restores the reachable endpoint, then relaunches the app.</summary>
    public static void RestartRecovered(
        AppiumDriver driver, MobilePlatformAdapter platform, MobileTestConfiguration configuration)
    {
        if (configuration.Platform == MobilePlatform.IOS)
        {
            // No extra environment: the adapter relaunches with its default
            // suite variables, which resolve to the loopback emulator.
            platform.RestartApp(driver, null);
            return;
        }
        try
        {
            // 10.0.2.2 is the Android-emulator host alias; the standard
            // emulator ports complete the default endpoint.
            SetAndroidEndpoint(configuration.DeviceId, "10.0.2.2", 9099, 8080); //NOSONAR — platform loopback alias, not a routable endpoint.
        }
        finally
        {
            platform.RestartApp(driver, null);
        }
    }

    private static void SetAndroidEndpoint(string deviceId, string host, int authPort, int firestorePort)
    {
        RunAdb(deviceId, "shell", "setprop", HostProperty, host);
        RunAdb(deviceId, "shell", "setprop", AuthPortProperty, authPort.ToString(CultureInfo.InvariantCulture));
        RunAdb(deviceId, "shell", "setprop", FirestorePortProperty, firestorePort.ToString(CultureInfo.InvariantCulture));
    }

    private static void RunAdb(string deviceId, params string[] arguments) =>
        RunAdbAllowFailure(deviceId, arguments).EnsureZeroExitCode(arguments);

    private static ProcessRun RunAdbAllowFailure(string deviceId, params string[] arguments)
    {
        var adbArguments = new List<string> { "-s", deviceId };
        adbArguments.AddRange(arguments);
        return Run("adb", adbArguments.ToArray());
    }

    private static ProcessRun Run(string fileName, params string[] arguments)
    {
        var start = new ProcessStartInfo(fileName)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var argument in arguments)
        {
            start.ArgumentList.Add(argument);
        }
        // ArgumentList bypasses the shell argument string entirely — argv is
        // handed to exec as-is; the only inputs are the closed setprop/uninstall
        // verbs and literal package/property names this class controls.
        using var process = new Process { StartInfo = start }; // nosemgrep — closed argv, literal filename, no shell
        process.Start();
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(15000))
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"{fileName} {string.Join(' ', arguments)} timed out.");
        }
        return new ProcessRun(process.ExitCode, stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
    }

    private sealed record ProcessRun(int ExitCode, string StandardOutput, string StandardError)
    {
        public void EnsureZeroExitCode(string[] arguments)
        {
            if (ExitCode != 0)
            {
                throw new InvalidOperationException(
                    $"adb {string.Join(' ', arguments)} exited {ExitCode}: {StandardError.Trim()}");
            }
        }
    }
}
