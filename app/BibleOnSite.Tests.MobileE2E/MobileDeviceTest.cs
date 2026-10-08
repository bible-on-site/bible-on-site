using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// Sequential device scenarios each run on a fresh Appium session. The device
// transport occasionally kills a healthy session mid-run (adb "device offline",
// instrumentation exiting 255 with the logcat stream, a crashed WebDriverAgent)
// and every later test recreates the identical session anyway, so a scenario
// may rebuild it once and retry. Assertion failures are not WebDriverExceptions
// and never match the classifier, so a retry cannot mask a real regression — a
// second failure propagates normally.
public abstract class MobileDeviceTest : IAsyncLifetime
{
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

    public virtual Task InitializeAsync()
    {
        Platform = MobilePlatformAdapter.For(Configuration.Platform);
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

    public virtual Task DisposeAsync()
    {
        try
        {
            Driver?.Quit();
            Driver?.Dispose();
        }
        catch (WebDriverException exception)
        {
            // Quitting a session the transport already killed is expected.
            Output.WriteLine($"{Configuration.Platform}: session cleanup after transport loss: {exception.Message}");
        }
        return Task.CompletedTask;
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
        try
        {
            Driver?.Quit();
        }
        catch (WebDriverException exception)
        {
            Output.WriteLine($"{Configuration.Platform}: the previous session was already gone: {exception.Message}");
        }
        Driver = _sessions.Create(() =>
            Platform.CreateDriver(Configuration.Server, Platform.CreateOptions(Configuration)));
        Page = new(Driver, Platform);
        Page.WaitForStartup();
    }

    private void SaveDiagnostics(string name, string outcome)
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
public sealed class MobileDeviceCollection : ICollectionFixture<MobileDeviceSessionFactory>;
