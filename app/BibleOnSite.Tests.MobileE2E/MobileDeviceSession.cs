using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// The device-facing surface a scenario needs. Tests substitute a fake in unit
// coverage; the collection fixture below is the real implementation.
public interface IMobileDeviceSession
{
    MobilePlatformAdapter Adapter { get; }
    MobileTestConfiguration Configuration { get; }
    AppiumDriver? Driver { get; }
    void Acquire(IReadOnlyDictionary<string, string>? environment);
}

// One Appium session serves the whole collection on the device. Creating a
// session costs up to a minute on iOS (reset, install, WDA restart), so a
// fresh session per test multiplied that cost by the suite size. Per-test
// isolation instead comes from restarting the app process: terminate +
// launch with the scenario's environment resets in-memory state while
// keeping the install — including the built search index — intact.
public sealed class MobileDeviceSession : IMobileDeviceSession, IAsyncLifetime
{
    private readonly MobileDeviceSessionFactory _sessions = new();

    public MobilePlatformAdapter Adapter { get; }
    public MobileTestConfiguration Configuration { get; }
    public AppiumDriver? Driver { get; private set; }

    public MobileDeviceSession()
        : this(MobileTestConfiguration.FromEnvironment())
    {
    }

    internal MobileDeviceSession(MobileTestConfiguration configuration)
    {
        Configuration = configuration;
        Adapter = MobilePlatformAdapter.For(configuration.Platform);
    }

    public ValueTask InitializeAsync() => default;

    public ValueTask DisposeAsync()
    {
        try
        {
            _sessions.Cleanup(CloseDriver);
        }
        catch (WebDriverException exception)
        {
            Console.WriteLine(DeviceSessionDeath.Matches(exception)
                ? $"{Configuration.Platform}: session cleanup failed; the device had already dropped it: {exception.Message}"
                : $"{Configuration.Platform}: session cleanup failed; device reuse blocked: {exception.Message}");
        }
        return default;
    }

    // Ensures the app runs with the scenario's environment. The first call
    // creates the session; a later call on a dead session rebuilds it once —
    // the death classifier means Appium already dropped it server-side, so
    // the replacement has nothing to race.
    public void Acquire(IReadOnlyDictionary<string, string>? environment)
    {
        var created = Driver == null;
        if (created)
        {
            CreateWithOneRetry();
        }
        // A brand-new session already launched the app with the suite
        // environment, so a scenario with no extra variables has nothing to
        // restart — and the app is mid cold-start then, exactly the window a
        // terminate+launch cycle can wedge in.
        if (created && environment == null)
        {
            return;
        }
        try
        {
            Adapter.RestartApp(Driver!, environment);
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            Rebuild();
            Adapter.RestartApp(Driver!, environment);
        }
        catch (WebDriverException exception) when (DeviceTransportLoss.Matches(exception)
            && MobileDeviceTest.TransportRecovery(exception))
        {
            // The restart rode a dropped adb transport — healed by the filter —
            // so the live session is retried once rather than rebuilt.
            Adapter.RestartApp(Driver!, environment);
        }
        catch (WebDriverTimeoutException)
        {
            // A restart command that gets no response at all means the agent
            // wedged — the launch lands or hangs inside WDA/UiAutomator2 while
            // the session id stays allocated (iOS shard: 'mobileLaunchApp' did
            // not receive any response within 120000 ms). Rebuild once rather
            // than issue the launch again into the same dead agent.
            Rebuild();
            Adapter.RestartApp(Driver!, environment);
        }
    }

    private void Rebuild()
    {
        try
        {
            _sessions.Cleanup(CloseDriver);
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // The dropped session has nothing left for Appium to clean.
        }
        Create();
    }

    private void CreateWithOneRetry()
    {
        try
        {
            Create();
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // Confirmed deaths need no gate; recovery only heals adb when the
            // death rode a dropped transport.
            MobileDeviceTest.TransportRecovery(exception);
            Create();
        }
        catch (WebDriverException exception) when (DeviceTransportLoss.Matches(exception)
            && MobileDeviceTest.TransportRecovery(exception))
        {
            Create();
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
                && MobileDeviceTest.TransportRecovery(exception))
            {
                Driver?.Quit();
            }
        }
        finally
        {
            Driver?.Dispose();
            Driver = null;
        }
    }

    private void Create()
    {
        Driver = _sessions.Create(() =>
            Adapter.CreateDriver(Configuration.Server, Adapter.CreateOptions(Configuration)));
        Adapter.OnSessionRecreated();
    }
}
