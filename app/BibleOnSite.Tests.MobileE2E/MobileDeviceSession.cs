using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Platforms;
using System.Diagnostics;
using System.Runtime.ExceptionServices;
using System.Text.Json;
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
    private readonly Func<Uri, AppiumOptions, TimeSpan, AppiumDriver> _createDriver;
    private readonly Func<MobileTestConfiguration, TimeSpan, VerifiedIosApp> _prepareIos;

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
        _createDriver = (server, options, budget) => configuration.Platform == MobilePlatform.IOS
            ? new IosSnapshotDriver(server, options, budget) : Adapter.CreateDriver(server, options);
        _prepareIos = IosAppInstallation.Prepare;
    }

    internal MobileDeviceSession(MobileTestConfiguration configuration,
        Func<Uri, AppiumOptions, TimeSpan, AppiumDriver> createDriver,
        Func<MobileTestConfiguration, TimeSpan, VerifiedIosApp> prepareIos) : this(configuration)
    {
        _createDriver = createDriver;
        _prepareIos = prepareIos;
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
            CreateWithOneRetry(environment);
        }
        // A brand-new session already launched the app with the suite
        // environment. iOS also receives the scenario variables and launch ID
        // through processArguments, so it must finish that single cold start
        // instead of being terminated while still initializing.
        if (created && (environment == null || Configuration.Platform == MobilePlatform.IOS))
        {
            return;
        }
        try
        {
            Adapter.RestartApp(Driver!, environment);
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            Rebuild(environment);
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
            Rebuild(environment);
        }
    }

    private void Rebuild(IReadOnlyDictionary<string, string>? environment)
    {
        try
        {
            _sessions.Cleanup(CloseDriver);
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // The dropped session has nothing left for Appium to clean.
        }
        Create(environment);
        // iOS session creation already launched with the current environment.
        // Android retains its existing activation path after replacement.
        if (Configuration.Platform != MobilePlatform.IOS)
        {
            Adapter.RestartApp(Driver!, environment);
        }
    }

    private void CreateWithOneRetry(IReadOnlyDictionary<string, string>? environment)
    {
        try
        {
            Create(environment);
        }
        catch (WebDriverException exception) when (DeviceSessionDeath.Matches(exception))
        {
            // Confirmed deaths need no gate; recovery only heals adb when the
            // death rode a dropped transport.
            MobileDeviceTest.TransportRecovery(exception);
            Create(environment);
        }
        catch (WebDriverException exception) when (DeviceTransportLoss.Matches(exception)
            && MobileDeviceTest.TransportRecovery(exception))
        {
            Create(environment);
        }
    }

    // Quit can race a dropped adb transport: "device offline" then means the
    // server-side teardown is unconfirmed, not done. On a healed transport the
    // Quit is re-attempted so a released session is proven before reuse; if the
    // retry also fails the factory latches the device rather than risk a
    // zombie teardown colliding with the next session.
    private void CloseDriver()
    {
        Exception? teardownFailure = null;
        Exception? disposalFailure = null;
        try
        {
            try
            {
                QuitConfirmed();
            }
            catch (WebDriverException exception) when (DeviceTransportLoss.Matches(exception)
                && MobileDeviceTest.TransportRecovery(exception))
            {
                QuitConfirmed();
            }
        }
        catch (Exception exception) //NOSONAR - Preserve any teardown failure across mandatory resource cleanup.
        {
            teardownFailure = exception;
        }
        finally
        {
            // Selenium Dispose sends another DELETE and suppresses its error.
            // Release the same executor resources without duplicating an
            // unconfirmed teardown or pretending that it succeeded.
            try
            {
                Driver?.CommandExecutor.Dispose();
            }
            catch (Exception exception) //NOSONAR - Resource-disposal failures must never hide an uncertain DELETE response.
            {
                disposalFailure = exception;
            }
            finally
            {
                Driver = null;
            }
        }
        if (teardownFailure != null && disposalFailure != null)
        {
            throw new AggregateException("Session teardown and executor disposal both failed.", teardownFailure, disposalFailure);
        }
        if (disposalFailure != null)
        {
            // A disposal error's message cannot prove the remote session died.
            throw new InvalidOperationException("Device command executor resources could not be released.", disposalFailure);
        }
        if (teardownFailure != null)
        {
            ExceptionDispatchInfo.Capture(teardownFailure).Throw();
        }
    }

    private void QuitConfirmed()
    {
        if (Driver == null)
        {
            return;
        }
        // WebDriver.Quit calls Dispose, which catches WebDriverException and
        // clears SessionId even when DELETE failed. Use the public custom
        // command API so the existing death/transport classifier and cleanup
        // latch receive the real response, retaining SessionId for an earned
        // transport-recovery retry. The server route/deadline stay unchanged.
        const string command = "bibleConfirmedQuit";
        Driver.RegisterCustomDriverCommand(command,
            new HttpCommandInfo(HttpCommandInfo.DeleteCommand, "/session/{sessionId}"));
        Driver.ExecuteCustomDriverCommand(command, new Dictionary<string, object>());
    }

    private void Create(IReadOnlyDictionary<string, string>? environment)
    {
        Driver = _sessions.Create(() =>
        {
            var started = Stopwatch.StartNew();
            var preparationMs = 0L;
            var phase = "preparation";
            var success = false;
            try
            {
                var configuration = Configuration;
                var budget = TimeSpan.FromMinutes(5);
                if (configuration.Platform == MobilePlatform.IOS)
                {
                    var proof = _prepareIos(configuration, budget - started.Elapsed);
                    proof.VerifyIdentity(configuration);
                    configuration = configuration with { VerifiedIosApp = proof };
                    preparationMs = started.ElapsedMilliseconds;
                }
                phase = "driver";
                var options = Adapter.CreateOptions(configuration, environment);
                if (configuration.Platform == MobilePlatform.IOS)
                {
                    budget -= started.Elapsed;
                    if (budget <= TimeSpan.Zero)
                    {
                        throw new TimeoutException("iOS preparation exhausted the 300 second session deadline.");
                    }
                }
                var driver = _createDriver(configuration.Server, options, budget);
                success = true;
                return driver;
            }
            finally
            {
                if (Configuration.Platform == MobilePlatform.IOS)
                {
                    Console.WriteLine("iOS session startup: " + JsonSerializer.Serialize(new {
                        udid = Configuration.DeviceId, phase, success,
                        preparationMs = phase == "preparation" ? started.ElapsedMilliseconds : preparationMs,
                        driverMs = phase == "driver" ? started.ElapsedMilliseconds - preparationMs : 0,
                        combinedMs = started.ElapsedMilliseconds, deadlineMs = 300000
                    }));
                }
            }
        });
        Adapter.OnSessionRecreated();
    }
}
