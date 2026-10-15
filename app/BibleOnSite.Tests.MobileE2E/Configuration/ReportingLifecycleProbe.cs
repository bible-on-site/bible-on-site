using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

// Only the process-level validation script explicitly selects this probe.
// It never joins either the unit selection or the sixteen native scenarios.
[Trait("Category", "ReportingLifecycleProbe")]
public sealed class ReportingLifecycleProbe
{
    [Fact(Explicit = true)]
    public void ObserveReportingAndShutdown()
    {
        var directory = Environment.GetEnvironmentVariable("MOBILE_E2E_REPORTING_PROBE")
            ?? throw new InvalidOperationException("Launch this probe with verify-reporting.mjs.");
        if (Environment.GetEnvironmentVariable("MOBILE_E2E_REPORTING_LEAK") == "1")
        {
            var gate = new ManualResetEventSlim();
            new Thread(() => gate.Wait()) { Name = "Intentional foreground leak regression" }.Start();
            return;
        }
        using var released = new ManualResetEventSlim();
        using var watcher = new FileSystemWatcher(directory, "release");
        watcher.Created += (_, _) => released.Set();
        watcher.EnableRaisingEvents = true;
        File.WriteAllText(Path.Join(directory, "ready"), Environment.ProcessId.ToString());
        if (!released.Wait(TimeSpan.FromSeconds(10)))
        {
            throw new TimeoutException("The reporting stack probe did not release its test.");
        }
    }
}
