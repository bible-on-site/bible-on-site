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

    public Task InitializeAsync() => Task.CompletedTask;

    public Task DisposeAsync()
    {
        try
        {
            _sessions.Cleanup(() =>
            {
                try
                {
                    Driver?.Quit();
                }
                finally
                {
                    Driver?.Dispose();
                }
            });
        }
        catch (WebDriverException exception)
        {
            Console.WriteLine(DeviceSessionDeath.Matches(exception)
                ? $"{Configuration.Platform}: session cleanup failed; the device had already dropped it: {exception.Message}"
                : $"{Configuration.Platform}: session cleanup failed; device reuse blocked: {exception.Message}");
        }
        return Task.CompletedTask;
    }

    // Ensures the app runs with the scenario's environment. The first call
    // creates the session; a later call on a dead session rebuilds it once —
    // the death classifier means Appium already dropped it server-side, so
    // the replacement has nothing to race.
    public void Acquire(IReadOnlyDictionary<string, string>? environment)
    {
        if (Driver == null)
        {
            CreateWithOneRetry();
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
    }

    private void Rebuild()
    {
        try
        {
            _sessions.Cleanup(() =>
            {
                try
                {
                    Driver?.Quit();
                }
                finally
                {
                    Driver?.Dispose();
                    Driver = null;
                }
            });
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
            Create();
        }
    }

    private void Create() => Driver = _sessions.Create(() =>
        Adapter.CreateDriver(Configuration.Server, Adapter.CreateOptions(Configuration)));
}
