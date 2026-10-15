using System.Reflection;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

// Only the process-level validation script explicitly selects this probe.
// It never joins either the unit selection or the sixteen native scenarios.
[Trait("Category", "ReportingLifecycleProbe")]
public sealed class ReportingLifecycleProbe(ITestOutputHelper output)
{
    [Fact(Explicit = true)]
    public void ObserveReportingAndShutdown()
    {
        var directory = Environment.GetEnvironmentVariable("MOBILE_E2E_REPORTING_PROBE")
            ?? throw new InvalidOperationException("Launch this probe with verify-reporting.mjs.");
        // Inspect the pinned xUnit runner's actual output-helper bus. A framework
        // upgrade that changes these fields must update this integration probe.
        var state = ReadField(output, "state");
        var bus = ReadField(state, "messageBus");
        var reporter = bus.GetType().GetField("reporterThread", BindingFlags.Instance | BindingFlags.NonPublic)
            ?.GetValue(bus) as Thread;
        File.WriteAllText(Path.Join(directory, "reporter.json"), JsonSerializer.Serialize(new
        {
            bus = bus.GetType().FullName,
            foregroundReporter = reporter is { IsBackground: false },
            reporterIsAlive = reporter?.IsAlive,
        }));
        if (Environment.GetEnvironmentVariable("MOBILE_E2E_TELEMETRY_DISABLED_PROBE") == "1")
        {
            File.WriteAllText(Path.Join(directory, "telemetry.json"), JsonSerializer.Serialize(new
            {
                optedOut = Environment.GetEnvironmentVariable("TESTINGPLATFORM_TELEMETRY_OPTOUT") == "1",
                sdkLoaded = AppDomain.CurrentDomain.GetAssemblies().Any(assembly => assembly.GetName().Name == "Microsoft.ApplicationInsights"),
            }));
        }
        if (Environment.GetEnvironmentVariable("MOBILE_E2E_SDK_EXIT_PROBE") == "1")
        {
            var sdk = Assembly.Load("Microsoft.ApplicationInsights");
            var initializer = sdk.GetType("Microsoft.ApplicationInsights.Extensibility.Implementation.Tracing.SelfDiagnostics.SelfDiagnosticsInitializer", true)!;
            initializer.GetMethod("EnsureInitialized")!.Invoke(null, null);
            var instance = initializer.GetField("Instance", BindingFlags.NonPublic | BindingFlags.Static)!.GetValue(null)!;
            var refresher = ReadField(instance, "configRefresher");
            // Model a stalled SDK operation without creating any foreground thread.
            var release = new TcpListener(IPAddress.Loopback, 0);
            release.Start();
            var pending = AwaitReleaseAsync(release);
            refresher.GetType().GetField("worker", BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(refresher, pending);
            File.WriteAllText(Path.Join(directory, "sdk-exit.json"), JsonSerializer.Serialize(new
            {
                sdk = sdk.GetName().Name,
                callback = initializer.FullName,
                pendingTask = pending.Status.ToString(),
                applicationForegroundThreadsCreated = 0,
                releasePort = ((IPEndPoint)release.LocalEndpoint).Port,
            }));
        }
        if (Environment.GetEnvironmentVariable("MOBILE_E2E_REPORTING_LEAK") == "1")
        {
            new Thread(() =>
            {
                using var gate = new ManualResetEventSlim();
                File.WriteAllText(Path.Join(directory, "leak-thread.json"), JsonSerializer.Serialize(new
                {
                    isBackground = Thread.CurrentThread.IsBackground,
                    name = Thread.CurrentThread.Name,
                    stack = Environment.StackTrace,
                }));
                gate.Wait();
            }) { Name = "Intentional foreground leak regression" }.Start();
        }
    }

    private static async Task AwaitReleaseAsync(TcpListener listener)
    {
        using (listener)
        {
            using var connection = await listener.AcceptTcpClientAsync();
        }
    }

    private static object ReadField(object instance, string name) =>
        instance.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)?.GetValue(instance)
        ?? throw new InvalidOperationException($"The pinned xUnit reporting state changed: {instance.GetType().FullName}.{name}");
}
