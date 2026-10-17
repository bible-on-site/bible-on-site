using System.Diagnostics;
using System.Drawing;
using System.Runtime.CompilerServices;
using System.Text;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

// Every Appium command funnels through the driver's Execute override, which
// forwards here. Besides timing each command for the per-test profile dump,
// it observes the only command that mutates device geometry — setOrientation —
// so window-size and orientation reads can stay local until then. App restarts
// and session relaunches cannot resize the simulator window; a new driver
// instance gets a fresh tracked state automatically.
internal static class DriverTelemetry
{
    private sealed class Slot
    {
        public int Count;
        public long TotalMs;
        public long MaxMs;
    }

    private sealed class State
    {
        public Size? WindowSize;
        public ScreenOrientation? Orientation;
    }

    private static readonly Dictionary<string, Slot> s_totals = new(StringComparer.Ordinal);
    private static readonly ConditionalWeakTable<AppiumDriver, State> s_states = new();
    private static readonly object s_gate = new();

    internal static Response? Execute(AppiumDriver driver, string command,
        Dictionary<string, object>? parameters, Func<Response?> invoke)
    {
        var watch = Stopwatch.StartNew();
        try
        {
            var response = invoke();
            // Only a successful rotation may clear the tracked geometry; a
            // failed command must leave the last-known state intact.
            if (command is "setOrientation")
            {
                var state = s_states.GetOrCreateValue(driver);
                state.WindowSize = null;
                state.Orientation = parameters?.TryGetValue("orientation", out var raw) == true
                    && Enum.TryParse(raw as string, true, out ScreenOrientation parsed)
                        ? parsed
                        : null;
            }
            return response;
        }
        finally
        {
            lock (s_gate)
            {
                if (!s_totals.TryGetValue(command, out var slot))
                {
                    slot = new Slot();
                    s_totals[command] = slot;
                }
                slot.Count++;
                slot.TotalMs += watch.ElapsedMilliseconds;
                slot.MaxMs = Math.Max(slot.MaxMs, watch.ElapsedMilliseconds);
            }
        }
    }

    internal static Size WindowSize(AppiumDriver driver)
        => s_states.GetOrCreateValue(driver).WindowSize ??= driver.Manage().Window.Size;

    internal static ScreenOrientation Orientation(AppiumDriver driver)
        => s_states.GetOrCreateValue(driver).Orientation ??= driver.Orientation;

    internal static void Reset()
    {
        lock (s_gate)
        {
            s_totals.Clear();
        }
    }

    // Formats and clears the accumulated profile. Called once per scenario so
    // the dump lands in that test's captured output (trx stdout → artifacts).
    internal static string Dump()
    {
        lock (s_gate)
        {
            if (s_totals.Count == 0)
            {
                return string.Empty;
            }
            var builder = new StringBuilder();
            var total = s_totals.Values.Sum(slot => slot.TotalMs);
            var calls = s_totals.Values.Sum(slot => slot.Count);
            builder.AppendLine($"Driver commands: {calls} calls, {total / 1000.0:F1}s in driver");
            foreach (var (command, slot) in s_totals.OrderByDescending(pair => pair.Value.TotalMs))
            {
                builder.AppendLine($"  {command,-36} {slot.Count,4}x {slot.TotalMs / 1000.0,7:F1}s avg {slot.TotalMs / slot.Count / 1000.0,5:F2}s max {slot.MaxMs / 1000.0,5:F1}s");
            }
            s_totals.Clear();
            return builder.ToString();
        }
    }
}
