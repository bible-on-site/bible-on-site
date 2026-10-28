using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Sequential device scenarios share one Appium session held by the collection
// fixture — per-test isolation comes from restarting the app process rather
// than recreating the driver. The device transport occasionally kills a
// healthy session mid-run (adb "device offline", instrumentation exiting 255
// with the logcat stream, a crashed WebDriverAgent); the session rebuilds it
// once after confirmed cleanup, or after a lost adb transport that
// DeviceTransportRecovery re-proves healthy and ready. Recovery never gates
// the confirmed-death retry; it only heals adb when the death rode a dropped
// transport. Uncertain cleanup stays latched in the session's factory.
// Assertion failures are not WebDriverExceptions
// and never match the classifier, so a retry cannot mask a real regression — a
// second failure propagates normally.
public abstract class MobileDeviceTest : IAsyncLifetime
{
    // Unit tests substitute a fake so recovery paths run without a real adb.
    // Production always probes the device through DeviceTransportRecovery.
    internal static Func<Exception, bool> TransportRecovery { get; set; } = DeviceTransportRecovery.TryReconnect;

    private readonly IMobileDeviceSession _session;

    protected MobileDeviceTest(ITestOutputHelper output, MobileDeviceSession session)
        : this(output, (IMobileDeviceSession)session)
    {
    }

    private protected MobileDeviceTest(ITestOutputHelper output, IMobileDeviceSession session)
    {
        Output = output;
        _session = session;
    }

    protected ITestOutputHelper Output { get; }
    protected MobileTestConfiguration Configuration => _session.Configuration;
    protected AppiumDriver? Driver => _session.Driver;
    protected MobilePlatformAdapter Platform => _session.Adapter;
    protected PerekPage Page { get; private set; } = null!;

    // Scenarios that need extra launch environment (e.g. BIBLE_E2E_PERUSHIM
    // synthetic commentary data) return it here; the shared session applies it
    // on the scenario's app restart instead of holding per-test session caps.
    protected virtual IReadOnlyDictionary<string, string>? LaunchEnvironment => null;

    public virtual ValueTask InitializeAsync()
    {
        Assert.SkipWhen(E2eSelection.IsExcluded(TestContext.Current),
            "not selected by the e2e-impact manifest");
        try
        {
            Connect();
            return ValueTask.CompletedTask;
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // The session's own recovery already ran inside Acquire, so this
            // retry only fires when it exhausted its one rebuild. Any other
            // startup failure — and a second death — fails below.
            Output.WriteLine($"{Configuration.Platform}: the session died during startup " +
                $"({exception.Message}); acquiring it once more.");
            if (TransportRecovery(exception))
            {
                Output.WriteLine($"{Configuration.Platform}: adb transport recovered before the retry.");
            }
        }
        catch (WebDriverException exception) when (DeviceTransportLoss.Matches(exception))
        {
            // A lost adb transport is ambiguous — the failed creation may still
            // be settling server-side — so the retry runs only after adb
            // confirms a booted device with a responsive package manager, and
            // the session still re-attempts teardown before creating anything.
            if (!TransportRecovery(exception))
            {
                SaveDiagnostics($"SessionStartup-{Guid.NewGuid():N}", "failed", exception);
                throw;
            }
            Output.WriteLine($"{Configuration.Platform}: adb transport recovered; acquiring the session once more.");
        }
        catch (Exception exception)
        {
            SaveDiagnostics($"SessionStartup-{Guid.NewGuid():N}", "failed", exception);
            throw;
        }
        try
        {
            Connect();
        }
        catch (Exception exception)
        {
            SaveDiagnostics($"SessionStartup-{Guid.NewGuid():N}", "failed", exception);
            throw;
        }
        return default;
    }

    // The collection fixture owns the driver's lifetime, so a finished test
    // has nothing to release. The next scenario's acquire restarts the app.
    public virtual ValueTask DisposeAsync() => default;

    protected void Scenario(Action run, [System.Runtime.CompilerServices.CallerMemberName] string name = "")
    {
        try
        {
            Run(run, name);
            return;
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            Output.WriteLine($"{Configuration.Platform}: the device dropped the session mid-scenario " +
                $"({exception.Message}); rebuilding it once.");
            if (TransportRecovery(exception))
            {
                Output.WriteLine($"{Configuration.Platform}: adb transport recovered before the rebuild.");
            }
        }
        catch (WebDriverException exception) when (DeviceTransportLoss.Matches(exception))
        {
            // The scenario died with the transport; rebuilding blind on a still-
            // lost device is not honest, so the rebuild waits for recovery —
            // and the session re-attempts the teardown before creating anyway.
            if (!TransportRecovery(exception))
            {
                throw;
            }
            Output.WriteLine($"{Configuration.Platform}: adb transport recovered; rebuilding the session once.");
        }
        Connect();
        Run(run, name);
    }

    private void Run(Action body, string name)
    {
        // The caller-member name is the [Fact]/[Theory] method; combining it
        // with the declaring type reproduces the xUnit FullyQualifiedName the
        // coverage tree uses as test identity (#2085). That identity also names
        // the per-test artifacts: method names are not unique across classes,
        // so two tests sharing one would overwrite each other's evidence inside
        // a run and collide again at the shard merge (#2263).
        var test = $"{GetType().FullName}.{name}";
        CoverageEvidence.Begin(test, Configuration.Platform,
            Configuration.ArtifactDirectory, test);
        try
        {
            try
            {
                body();
            }
            finally
            {
                // The per-command driver profile (counts/totals/max) rides the
                // test's captured output into the trx artifact.
                var profile = DriverTelemetry.Dump();
                if (profile.Length > 0)
                {
                    Output.WriteLine(profile);
                }
            }
            CoverageEvidence.RecordSession(Driver?.SessionId);
            CoverageEvidence.Finish("passed");
            CollectAppCoverage(test, "passed");
            SaveDiagnostics(test, "passed");
        }
        catch
        {
            FailureDiagnostics.BeforeFailure(test, Driver?.SessionId?.ToString(), Output.WriteLine);
            CoverageEvidence.RecordSession(Driver?.SessionId);
            CoverageEvidence.Finish("failed");
            CollectAppCoverage(test, "failed");
            SaveDiagnostics(test, "failed");
            throw;
        }
    }

    // No live session means no app process is answering the coverage endpoint; unit-test fakes never create a driver, so this also keeps collection out of host-side unit tests.
    private void CollectAppCoverage(string name, string outcome)
    {
        if (Driver == null)
        {
            return;
        }
        try
        {
            AppCoverage.Collect(Configuration, name, outcome, Output);
        }
        catch (Exception exception) //NOSONAR
        {
            // Coverage collection is diagnostic-only: a failure here must never
            // decide (or mask) the scenario's own outcome.
            Output.WriteLine($"{Configuration.Platform}: coverage collection failed: {exception.Message}");
        }
    }

    protected virtual void Connect()
    {
        // Attribute session creation, app restart, startup wait and coverage
        // collection to the scenario that follows them.
        DriverTelemetry.Reset();
        AcquireSession();
        Page = new(Driver!, Platform);
        Page.WaitForStartup();
        // Launch code (App.xaml.cs, MauiProgram, startup navigation) only ever
        // runs before the first reset; attribute it to a startup dump so the
        // merged report still counts it (#1232). Later connects overwrite it —
        // the content is identical app-init hits either way.
        AppCoverage.Collect(Configuration, "_startup", "passed", Output);
        AppCoverage.Reset(Configuration, Output);
    }

    // Unit coverage substitutes IMobileDeviceSession to observe this path
    // without a device.
    protected void AcquireSession() => _session.Acquire(LaunchEnvironment);

    protected void SaveDiagnostics(string name, string outcome) =>
        SaveDiagnostics(name, outcome, null);

    private string AppiumLogTail()
    {
        try
        {
            var tail = AppiumLog.Tail(Configuration.ArtifactDirectory);
            return tail.Length == 0 ? string.Empty : $"\n--- appium.log tail ---\n{tail}";
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return $"\n--- appium.log tail unavailable: {exception.Message} ---";
        }
    }

    private void SaveDiagnostics(string name, string outcome, Exception? error)
    {
        var prefix = Path.Join(Configuration.ArtifactDirectory, $"{name}-{outcome}");
        Directory.CreateDirectory(Configuration.ArtifactDirectory);
        if (Driver == null)
        {
            // A session-creation failure leaves no device state to capture; keep
            // the startup exception, the adb device listing, and the Appium
            // server log tail (the WDA/install handshake only exists there).
            var details = error is null
                ? "The session was never created."
                : $"The session was never created.\n{error}{DeviceTransportRecovery.DeviceListing()}{AppiumLogTail()}";
            File.WriteAllText(prefix + "-diagnostics-error.txt", details);
        }
        else
        {
            try
            {
                Driver.GetScreenshot().SaveAsFile(prefix + ".png");
                // Passing screenshots record the visual state. Native source
                // is captured on failure; scenarios that assert its content
                // still request the complete tree directly.
                if (outcome == "failed")
                {
                    File.WriteAllText(prefix + ".xml", Driver.PageSource);
                }
            }
            catch (WebDriverException exception)
            {
                // Preserve the scenario failure when a crashed app prevents diagnostics.
                File.WriteAllText(prefix + "-diagnostics-error.txt", exception.ToString());
                Output.WriteLine($"Could not capture device diagnostics: {exception}");
                if (outcome == "passed")
                {
                    throw;
                }
            }
        }
        Output.WriteLine($"{Configuration.Platform}: {name} {outcome}; artifacts: {prefix}");
    }
}

[CollectionDefinition("Mobile device", DisableParallelization = true)]
public sealed class MobileDeviceCollection : ICollectionFixture<MobileDeviceSession>;
