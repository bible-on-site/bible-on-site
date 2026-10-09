using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// Sequential device scenarios share one Appium session held by the collection
// fixture — per-test isolation comes from restarting the app process rather
// than recreating the driver. The device transport occasionally kills a
// healthy session mid-run (adb "device offline", instrumentation exiting 255
// with the logcat stream, a crashed WebDriverAgent); the session rebuilds it
// once after confirmed cleanup. Uncertain cleanup blocks reuse.
// Assertion failures are not WebDriverExceptions
// and never match the classifier, so a retry cannot mask a real regression — a
// second failure propagates normally.
public abstract class MobileDeviceTest : IAsyncLifetime
{
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

    public virtual Task InitializeAsync()
    {
        try
        {
            Connect();
            return Task.CompletedTask;
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // The session's own recovery already ran inside Acquire, so this
            // retry only fires when it exhausted its one rebuild. Any other
            // startup failure — and a second death — fails below.
            Output.WriteLine($"{Configuration.Platform}: the session died during startup " +
                $"({exception.Message}); acquiring it once more.");
        }
        catch
        {
            SaveDiagnostics($"SessionStartup-{Guid.NewGuid():N}", "failed");
            throw;
        }
        try
        {
            Connect();
        }
        catch
        {
            SaveDiagnostics($"SessionStartup-{Guid.NewGuid():N}", "failed");
            throw;
        }
        return Task.CompletedTask;
    }

    // The collection fixture owns the driver's lifetime, so a finished test
    // has nothing to release. The next scenario's acquire restarts the app.
    public virtual Task DisposeAsync() => Task.CompletedTask;

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
        }
        Connect();
        Run(run, name);
    }

    private void Run(Action body, string name)
    {
        try
        {
            body();
            SaveDiagnostics(name, "passed");
        }
        catch
        {
            SaveDiagnostics(name, "failed");
            throw;
        }
    }

    protected virtual void Connect()
    {
        AcquireSession();
        Page = new(Driver!, Platform);
        Page.WaitForStartup();
    }

    // Unit coverage substitutes IMobileDeviceSession to observe this path
    // without a device.
    protected void AcquireSession() => _session.Acquire(LaunchEnvironment);

    protected void SaveDiagnostics(string name, string outcome)
    {
        var prefix = Path.Join(Configuration.ArtifactDirectory, $"{name}-{outcome}");
        Directory.CreateDirectory(Configuration.ArtifactDirectory);
        if (Driver == null)
        {
            // A session-creation failure leaves no device state to capture.
            File.WriteAllText(prefix + "-diagnostics-error.txt", "The session was never created.");
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
public sealed class MobileDeviceCollection : ICollectionFixture<MobileDeviceSession>;
