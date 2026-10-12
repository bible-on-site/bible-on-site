using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Sequential device scenarios each run on a fresh Appium session. The device
// transport occasionally kills a healthy session mid-run (adb "device offline",
// instrumentation exiting 255 with the logcat stream, a crashed WebDriverAgent)
// and every later test recreates the identical session anyway, so a scenario
// may rebuild it once — after confirmed session death, or after a lost adb
// transport that DeviceTransportRecovery re-proves healthy and ready. Recovery
// never gates the confirmed-death retry; it only heals adb when the death rode
// a dropped transport. Uncertain cleanup stays latched in the factory.
// Assertion failures are not WebDriverExceptions
// and never match the classifier, so a retry cannot mask a real regression — a
// second failure propagates normally.
public abstract class MobileDeviceTest : IAsyncLifetime
{
    // Unit tests substitute a fake so recovery paths run without a real adb.
    // Production always probes the device through DeviceTransportRecovery.
    internal static Func<Exception, bool> TransportRecovery { get; set; } = DeviceTransportRecovery.TryReconnect;

    private readonly MobileDeviceSessionFactory _sessions;

    protected MobileDeviceTest(ITestOutputHelper output, MobileDeviceSessionFactory sessions)
        : this(output, sessions, MobileTestConfiguration.FromEnvironment())
    {
    }

    private protected MobileDeviceTest(ITestOutputHelper output, MobileDeviceSessionFactory sessions,
        MobileTestConfiguration configuration)
    {
        Output = output;
        _sessions = sessions;
        Configuration = configuration;
    }

    protected ITestOutputHelper Output { get; }
    protected MobileTestConfiguration Configuration { get; }
    protected AppiumDriver? Driver { get; private set; }
    protected MobilePlatformAdapter Platform { get; private set; } = null!;
    protected PerekPage Page { get; private set; } = null!;

    public virtual ValueTask InitializeAsync()
    {
        Assert.SkipWhen(E2eSelection.IsExcluded(TestContext.Current),
            "not selected by the e2e-impact manifest");
        Platform = MobilePlatformAdapter.For(Configuration.Platform);
        try
        {
            Connect();
            return ValueTask.CompletedTask;
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // The device already dropped this session, so there is nothing
            // left for a replacement to race; create it once more. Any
            // other startup failure — and a second death — fails below.
            Output.WriteLine($"{Configuration.Platform}: the session died during startup " +
                $"({exception.Message}); creating it once more.");
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
            // Connect() still re-attempts teardown before creating anything.
            if (!TransportRecovery(exception))
            {
                SaveDiagnostics($"SessionStartup-{Guid.NewGuid():N}", "failed", exception);
                throw;
            }
            Output.WriteLine($"{Configuration.Platform}: adb transport recovered; creating the session once more.");
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

    public virtual ValueTask DisposeAsync()
    {
        try
        {
            _sessions.Cleanup(CloseDriver);
        }
        catch (WebDriverException exception)
        {
            Output.WriteLine(DeviceSessionDeath.Matches(exception)
                ? $"{Configuration.Platform}: session cleanup failed; the device had already dropped it: {exception.Message}"
                // Uncertain cleanup stays latched in the factory: Appium may
                // still run the failed session's shutdown against the device.
                : $"{Configuration.Platform}: session cleanup failed; device reuse blocked: {exception.Message}");
        }
        return default;
    }

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
            // and Connect() re-attempts the teardown before creating anyway.
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
        // coverage tree uses as test identity (#2085).
        CoverageEvidence.Begin($"{GetType().FullName}.{name}", Configuration.Platform,
            Configuration.ArtifactDirectory, name);
        try
        {
            body();
            CoverageEvidence.RecordSession(Driver?.SessionId);
            CoverageEvidence.Finish("passed");
            SaveDiagnostics(name, "passed");
        }
        catch
        {
            CoverageEvidence.RecordSession(Driver?.SessionId);
            CoverageEvidence.Finish("failed");
            SaveDiagnostics(name, "failed");
            throw;
        }
    }

    // Quit can race a dropped adb transport: "device offline" then means the
    // server-side teardown is unconfirmed, not done. On a healed transport the
    // Quit is re-attempted so a released session is proven before reuse; if the
    // retry also fails the factory latches the device rather than risk a
    // zombie teardown colliding with the next session.
    private void CloseDriver()
    {
        try
        {
            try
            {
                Driver?.Quit();
            }
            catch (WebDriverException exception) when (DeviceTransportLoss.Matches(exception)
                && TransportRecovery(exception))
            {
                Driver?.Quit();
            }
        }
        finally
        {
            Driver?.Dispose();
        }
    }

    protected virtual void Connect()
    {
        try
        {
            _sessions.Cleanup(CloseDriver);
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // The dropped session has nothing left for Appium to clean.
            Output.WriteLine($"{Configuration.Platform}: dead session rejected cleanup ({exception.Message}); continuing.");
        }
        Driver = _sessions.Create(() => Platform.CreateDriver(Configuration.Server, CreateOptions()));
        Page = new(Driver, Platform);
        Page.WaitForStartup();
    }

    // Scenarios that need extra launch environment (e.g. BIBLE_E2E_PERUSHIM
    // synthetic commentary data) override this instead of reimplementing
    // session management.
    protected virtual AppiumOptions CreateOptions() => Platform.CreateOptions(Configuration);

    protected void SaveDiagnostics(string name, string outcome) =>
        SaveDiagnostics(name, outcome, null);

    private void SaveDiagnostics(string name, string outcome, Exception? error)
    {
        var prefix = Path.Join(Configuration.ArtifactDirectory, $"{name}-{outcome}");
        Directory.CreateDirectory(Configuration.ArtifactDirectory);
        if (Driver == null)
        {
            // A session-creation failure leaves no device state to capture; keep
            // the startup exception and the adb device listing for forensics.
            var details = error is null
                ? "The session was never created."
                : $"The session was never created.\n{error}{DeviceTransportRecovery.DeviceListing()}";
            File.WriteAllText(prefix + "-diagnostics-error.txt", details);
        }
        else
        {
            try
            {
                Driver.GetScreenshot().SaveAsFile(prefix + ".png");
                File.WriteAllText(prefix + ".xml", Driver.PageSource);
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
public sealed class MobileDeviceCollection : ICollectionFixture<MobileDeviceSessionFactory>;
