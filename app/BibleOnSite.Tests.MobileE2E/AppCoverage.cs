using System.Diagnostics;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Configuration;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Executable app-process coverage for instrumented E2E builds (#1232).
// The test build carries an AltCover-instrumented BibleOnSite.dll whose
// recorder serves the live hit snapshot on a loopback HTTP endpoint. This
// collector pulls that snapshot at the end of every scenario — while the app
// is still running, because the driver may kill the app process at session
// teardown — and drops one JSON dump per attempt under
// <artifacts>/app-coverage/. Android tunnels the device's loopback through
// `adb forward`; the iOS simulator shares the host's loopback directly.
//
// This is deliberately separate from CoverageEvidence: that records which
// automation ids a scenario touched (test-impact evidence); this records the
// real IL sequence/branch points the app executed. Both land beside each
// other so diagnostics and selection keep working independently.
internal static class AppCoverage
{
    private const int DefaultPort = 4787;
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static readonly object ForwardLock = new();
    private static bool _forwardReady;

    internal static bool Enabled =>
        Environment.GetEnvironmentVariable("MOBILE_E2E_COVERAGE") is { } flag &&
        (flag.Equals("1", StringComparison.OrdinalIgnoreCase) ||
         flag.Equals("true", StringComparison.OrdinalIgnoreCase));

    internal static int Port =>
        int.TryParse(Environment.GetEnvironmentVariable("MOBILE_E2E_COVERAGE_PORT"), out var port) && port > 0
            ? port
            : DefaultPort;

    /// <summary>
    /// Clears the app-side hit table once a session is up so each scenario's
    /// dump holds only its own visits. Sessions normally launch a fresh app
    /// process (fresh counters anyway); the reset keeps per-test attribution
    /// honest when MOBILE_KEEP_APP reuses a running instance.
    /// </summary>
    internal static void Reset(MobileTestConfiguration configuration, ITestOutputHelper output)
    {
        if (!Enabled)
        {
            return;
        }
        var error = TrySend(configuration, "coverage/reset", output);
        if (error != null)
        {
            output.WriteLine($"{configuration.Platform}: coverage reset failed: {error}");
        }
    }

    /// <summary>
    /// Pulls the live hit snapshot from the app process and writes one dump
    /// per attempt, next to the coverage-evidence records. Failures preserve
    /// a <file>.coverage-error.txt diagnostic instead of failing the test.
    /// </summary>
    internal static void Collect(MobileTestConfiguration configuration, string fileBase, string outcome,
        ITestOutputHelper output)
    {
        if (!Enabled)
        {
            return;
        }
        var directory = Path.Join(configuration.ArtifactDirectory, "app-coverage");
        Directory.CreateDirectory(directory);
        var path = Path.Join(directory, $"{fileBase}-{outcome}.json");
        try
        {
            var snapshot = Send(configuration, "coverage");
            using var parsed = JsonDocument.Parse(snapshot);
            var record = new
            {
                kind = "app-e2e-coverage-dump/1",
                test = fileBase,
                platform = configuration.Platform.ToString().ToLowerInvariant(),
                outcome,
                collectedUtc = DateTime.UtcNow.ToString("o"),
                snapshot = parsed.RootElement.Clone()
            };
            File.WriteAllText(path, JsonSerializer.Serialize(record, new JsonSerializerOptions { WriteIndented = true }));
            output.WriteLine($"{configuration.Platform}: coverage dump collected to {path}");
        }
        catch (Exception exception)
        {
            File.WriteAllText(path + ".coverage-error.txt", exception.ToString());
            output.WriteLine($"{configuration.Platform}: coverage dump failed: {exception.Message}");
        }
    }

    private static string Send(MobileTestConfiguration configuration, string route)
    {
        EnsureReachable(configuration);
        return Client.GetStringAsync(new Uri($"http://127.0.0.1:{Port}/{route}"))
            .GetAwaiter().GetResult();
    }

    private static string? TrySend(MobileTestConfiguration configuration, string route, ITestOutputHelper output)
    {
        try
        {
            Send(configuration, route);
            return null;
        }
        catch (Exception exception)
        {
            return exception.Message;
        }
    }

    // The app listens on the device's own loopback; adb forward bridges it to
    // the runner host once per device. iOS simulators already share the host.
    private static void EnsureReachable(MobileTestConfiguration configuration)
    {
        if (configuration.Platform != MobilePlatform.Android || _forwardReady)
        {
            return;
        }
        lock (ForwardLock)
        {
            if (_forwardReady)
            {
                return;
            }
            var start = new ProcessStartInfo("adb");
            start.ArgumentList.Add("-s");
            start.ArgumentList.Add(configuration.DeviceId);
            start.ArgumentList.Add("forward");
            start.ArgumentList.Add($"tcp:{Port}");
            start.ArgumentList.Add($"tcp:{Port}");
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            start.UseShellExecute = false;
            using var process = new Process { StartInfo = start }; // nosemgrep — closed literal argv, no shell
            process.Start();
            var error = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(15_000))
            {
                process.Kill(entireProcessTree: true);
                throw new InvalidOperationException("adb forward timed out while bridging the coverage endpoint.");
            }
            if (process.ExitCode != 0)
            {
                throw new InvalidOperationException(
                    $"adb forward failed ({process.ExitCode}): {error.Result.Trim()}");
            }
            _forwardReady = true;
        }
    }
}
