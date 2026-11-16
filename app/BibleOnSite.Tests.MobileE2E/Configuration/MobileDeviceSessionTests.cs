using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[CollectionDefinition("Mobile session lifecycle", DisableParallelization = true)]
public sealed class MobileSessionLifecycleCollection;

[Trait("Category", "Unit")]
[Collection("Mobile session lifecycle")]
public sealed class MobileDeviceSessionTests
{
    private const string FirstLaunchId = "50a16675-077e-4474-9d1e-4eb503c1ea67";
    private const string NextLaunchId = "bc5ba640-d3bb-4316-9ed9-63e507c95c5f";

    [Fact]
    public async Task FirstIosAcquireLaunchesOnceWithItsNonceAndScenarioEnvironment()
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        await using var session = CreateSession(factory);
        session.Acquire(ScenarioEnvironment(FirstLaunchId, synthetic: true));

        var executor = Assert.Single(factory.Executors);
        Assert.Single(factory.Preparations);
        Assert.Equal(1, executor.SessionCreations);
        Assert.Equal(0, executor.Terminations);
        Assert.Empty(executor.Launches);
        var options = Assert.Single(factory.Options);
        Assert.Equal(true, options["appium:forceAppLaunch"]);
        var environment = CreatedEnvironment(options);
        Assert.Equal(FirstLaunchId, environment[ReaderStartupReadiness.LaunchIdEnvironmentVariable]);
        Assert.Equal("1", environment["BIBLE_E2E_PERUSHIM"]);
        AssertBaseline(environment);
    }

    [Fact]
    public async Task NextIosScenarioRestartsOnceWithFreshNonceAndClearsSyntheticVariables()
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        await using var session = CreateSession(factory);
        session.Acquire(ScenarioEnvironment(FirstLaunchId, synthetic: true));
        session.Acquire(ScenarioEnvironment(NextLaunchId, synthetic: false));

        var executor = Assert.Single(factory.Executors);
        Assert.Single(factory.Options);
        Assert.Equal(1, executor.Terminations);
        var environment = Assert.Single(executor.Launches);
        Assert.Equal(NextLaunchId, environment[ReaderStartupReadiness.LaunchIdEnvironmentVariable]);
        Assert.False(environment.ContainsKey("BIBLE_E2E_PERUSHIM"));
        Assert.Equal(FirstLaunchId, CreatedEnvironment(factory.Options[0])[ReaderStartupReadiness.LaunchIdEnvironmentVariable]);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task IosRecoveryAppliesTheCurrentEnvironmentDuringReplacementCreationOnly(bool sessionDeath)
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        await using var session = CreateSession(factory);
        session.Acquire(ScenarioEnvironment(FirstLaunchId, synthetic: true));
        var original = Assert.Single(factory.Executors);
        original.FailTermination(sessionDeath
            ? new UnknownErrorException("invalid session id")
            : new WebDriverTimeoutException("The restart did not answer."));

        session.Acquire(ScenarioEnvironment(NextLaunchId, synthetic: false));

        Assert.Equal(2, factory.Executors.Count);
        Assert.Equal(2, factory.Preparations.Count);
        Assert.Equal(1, original.Terminations);
        Assert.Equal(1, original.Quits);
        var replacement = factory.Executors[1];
        Assert.Equal(1, replacement.SessionCreations);
        Assert.Equal(0, replacement.Terminations);
        Assert.Empty(replacement.Launches);
        var environment = CreatedEnvironment(factory.Options[1]);
        Assert.Equal(true, factory.Options[1]["appium:forceAppLaunch"]);
        Assert.Equal(NextLaunchId, environment[ReaderStartupReadiness.LaunchIdEnvironmentVariable]);
        Assert.False(environment.ContainsKey("BIBLE_E2E_PERUSHIM"));
        AssertBaseline(environment);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task InitialAndroidAcquireRetainsItsExistingExtraEnvironmentRestart(bool withEnvironment)
    {
        var factory = new DriverFactory(MobilePlatform.Android);
        await using var session = CreateSession(factory);
        session.Acquire(withEnvironment ? ScenarioEnvironment(FirstLaunchId, synthetic: true) : null);

        var executor = Assert.Single(factory.Executors);
        Assert.Equal(withEnvironment ? 1 : 0, executor.Terminations);
        Assert.Equal(withEnvironment ? 1 : 0, executor.Activations);
        Assert.Empty(executor.Launches);
        var options = Assert.Single(factory.Options);
        Assert.False(options.ContainsKey("appium:processArguments"));
        Assert.Equal($"--ez BIBLE_E2E true --es BIBLE_E2E_COVERAGE_TOKEN {AppCoverage.Token}",
            options["appium:optionalIntentArguments"]);
    }

    [Fact]
    public async Task AndroidReplacementRetainsItsExistingRestart()
    {
        var factory = new DriverFactory(MobilePlatform.Android);
        await using var session = CreateSession(factory);
        session.Acquire(null);
        Assert.Single(factory.Executors).FailTermination(new UnknownErrorException("invalid session id"));
        session.Acquire(ScenarioEnvironment(NextLaunchId, synthetic: true));

        Assert.Equal(2, factory.Executors.Count);
        var replacement = factory.Executors[1];
        Assert.Equal(1, replacement.Terminations);
        Assert.Equal(1, replacement.Activations);
        Assert.Empty(factory.Preparations);
    }

    [Fact]
    public async Task FailedIosPreparationLatchesBeforeAnyDriverCanStart()
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        var failure = new InvalidOperationException("Installed woven IL does not match.");
        factory.PreparationFailure = failure;
        await using var session = CreateSession(factory);
        Assert.Same(failure, Assert.Throws<InvalidOperationException>(() =>
            session.Acquire(ScenarioEnvironment(FirstLaunchId, false))));
        factory.PreparationFailure = null;
        var blocked = Assert.Throws<InvalidOperationException>(() =>
            session.Acquire(ScenarioEnvironment(NextLaunchId, false)));
        Assert.Same(failure, blocked.InnerException);
        Assert.Empty(factory.Executors);
        Assert.Single(factory.Preparations);
    }

    [Fact]
    public async Task RecoveryPreparationFailureNeverStartsAReplacementDriver()
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        await using var session = CreateSession(factory);
        session.Acquire(ScenarioEnvironment(FirstLaunchId, false));
        var original = Assert.Single(factory.Executors);
        original.FailTermination(new UnknownErrorException("invalid session id"));
        var failure = new InvalidOperationException("Could not prove fresh app data.");
        factory.PreparationFailure = failure;
        Assert.Same(failure, Assert.Throws<InvalidOperationException>(() =>
            session.Acquire(ScenarioEnvironment(NextLaunchId, false))));
        Assert.Equal(1, original.Quits);
        Assert.Equal(2, factory.Preparations.Count);
        Assert.Single(factory.Executors);
    }

    [Fact]
    public async Task UnconfirmedCleanupPreventsAnyReplacementPreparation()
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        await using var session = CreateSession(factory);
        session.Acquire(ScenarioEnvironment(FirstLaunchId, false));
        var original = Assert.Single(factory.Executors);
        original.FailTermination(new WebDriverTimeoutException("The old launch did not answer."));
        original.FailQuit(new UnknownErrorException("DELETE /session teardown was not confirmed."));

        Assert.Throws<UnknownErrorException>(() => session.Acquire(ScenarioEnvironment(NextLaunchId, false)));
        Assert.Single(factory.Preparations);
        Assert.Single(factory.Executors);
        var blocked = Assert.Throws<InvalidOperationException>(() => session.Acquire(ScenarioEnvironment(NextLaunchId, false)));
        Assert.Contains("teardown was not confirmed", blocked.InnerException!.Message);
        Assert.Single(factory.Preparations);
    }

    [Fact]
    public async Task ExecutorDisposalFailureClearsThePublishedDriverAndLatchesReplacement()
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        await using var session = CreateSession(factory);
        session.Acquire(ScenarioEnvironment(FirstLaunchId, false));
        var original = Assert.Single(factory.Executors);
        original.FailTermination(new WebDriverTimeoutException("The old launch did not answer."));
        var failure = new InvalidOperationException("Executor resources could not be released.");
        original.FailDisposal(failure);

        var disposal = Assert.Throws<InvalidOperationException>(() => session.Acquire(ScenarioEnvironment(NextLaunchId, false)));
        Assert.Same(failure, disposal.InnerException);
        Assert.Null(session.Driver);
        var blocked = Assert.Throws<InvalidOperationException>(() => session.Acquire(ScenarioEnvironment(NextLaunchId, false)));
        Assert.Same(disposal, blocked.InnerException);
        Assert.Single(factory.Preparations);
        Assert.Single(factory.Executors);
    }

    [Fact]
    public async Task BenignLookingDisposalErrorCannotHideAnUnconfirmedDelete()
    {
        var factory = new DriverFactory(MobilePlatform.IOS);
        await using var session = CreateSession(factory);
        session.Acquire(ScenarioEnvironment(FirstLaunchId, false));
        var original = Assert.Single(factory.Executors);
        original.FailTermination(new WebDriverTimeoutException("restart did not answer"));
        var teardown = new UnknownErrorException("DELETE /session was not confirmed.");
        var disposal = new UnknownErrorException("invalid session id during executor disposal");
        original.FailQuit(teardown);
        original.FailDisposal(disposal);
        var failure = Assert.Throws<AggregateException>(() => session.Acquire(ScenarioEnvironment(NextLaunchId, false)));
        Assert.Equal([teardown, disposal], failure.InnerExceptions);
        Assert.Null(session.Driver);
        var blocked = Assert.Throws<InvalidOperationException>(() => session.Acquire(ScenarioEnvironment(NextLaunchId, false)));
        Assert.Same(failure, blocked.InnerException);
        Assert.Single(factory.Preparations);
    }

    [Fact]
    public async Task EarnedTransportRecoveryRetriesTheSameDeleteDespiteDuplicateCommandRegistration()
    {
        var previous = MobileDeviceTest.TransportRecovery;
        var recoveries = 0;
        MobileDeviceTest.TransportRecovery = _ => { recoveries++; return true; };
        try
        {
            var factory = new DriverFactory(MobilePlatform.Android);
            await using var session = CreateSession(factory);
            session.Acquire(null);
            var original = Assert.Single(factory.Executors);
            original.FailTermination(new WebDriverTimeoutException("restart did not answer"));
            original.FailNextQuit(new UnknownErrorException("adb: device offline"));
            session.Acquire(ScenarioEnvironment(NextLaunchId, false));

            Assert.Equal(1, recoveries);
            Assert.Equal(2, original.Quits);
            Assert.Equal(2, original.ConfirmedQuitRegistrations);
            Assert.Equal(2, factory.Executors.Count);
            Assert.Empty(factory.Preparations);
        }
        finally
        {
            MobileDeviceTest.TransportRecovery = previous;
        }
    }

    private static MobileDeviceSession CreateSession(DriverFactory factory) => new(
        new MobileTestConfiguration(factory.Platform, "/test/app", "unit-device", "/test/artifacts",
            new Uri("http://127.0.0.1:4723"))
        {
            PrebuiltWdaPath = "/test/WebDriverAgentRunner-Runner.app"
        }, factory.Create, factory.Prepare);

    private static Dictionary<string, string> ScenarioEnvironment(string launchId, bool synthetic)
    {
        var environment = new Dictionary<string, string>
        {
            [ReaderStartupReadiness.LaunchIdEnvironmentVariable] = launchId
        };
        if (synthetic)
        {
            environment["BIBLE_E2E_PERUSHIM"] = "1";
        }
        return environment;
    }

    private static IReadOnlyDictionary<string, string> CreatedEnvironment(Dictionary<string, object> options)
    {
        var arguments = Assert.IsType<Dictionary<string, object>>(options["appium:processArguments"]);
        return Assert.IsAssignableFrom<IReadOnlyDictionary<string, string>>(arguments["env"]);
    }

    private static void AssertBaseline(IReadOnlyDictionary<string, string> environment)
    {
        foreach (var (key, value) in MobilePlatformAdapter.IosE2eEnvironment)
        {
            Assert.Equal(value, environment[key]);
        }
    }

    private sealed class DriverFactory(MobilePlatform platform)
    {
        public MobilePlatform Platform { get; } = platform;
        public List<Dictionary<string, object>> Options { get; } = [];
        public List<SessionExecutor> Executors { get; } = [];
        public List<MobileTestConfiguration> Preparations { get; } = [];
        public List<TimeSpan> DriverBudgets { get; } = [];
        public Exception? PreparationFailure { get; set; }
        public VerifiedIosApp Prepare(MobileTestConfiguration configuration, TimeSpan budget)
        {
            Preparations.Add(configuration);
            Assert.Equal(TimeSpan.FromMinutes(5), budget);
            if (PreparationFailure != null)
            {
                throw PreparationFailure;
            }
            return new(configuration.DeviceId, configuration.AppPath, Guid.NewGuid().ToString("N"), new string('a', 64));
        }
        public AppiumDriver Create(Uri server, AppiumOptions options, TimeSpan budget)
        {
            Assert.Equal(new Uri("http://127.0.0.1:4723"), server);
            DriverBudgets.Add(budget);
            Assert.True(budget > TimeSpan.Zero);
            if (Platform == MobilePlatform.IOS)
            {
                Assert.True(budget < TimeSpan.FromMinutes(5));
            }
            else
            {
                Assert.Equal(TimeSpan.FromMinutes(5), budget);
            }
            Options.Add(new Dictionary<string, object>(options.ToDictionary()));
            if (Platform == MobilePlatform.IOS)
            {
                Assert.False(options.ToDictionary().ContainsKey("appium:app"));
                Assert.Equal(true, options.ToDictionary()["appium:noReset"]);
            }
            var executor = new SessionExecutor(Platform);
            Executors.Add(executor);
            return Platform == MobilePlatform.IOS
                ? new IosSnapshotDriver(executor, options)
                : new AndroidDriver(executor, options);
        }
    }

    private sealed class SessionExecutor(MobilePlatform platform) : ICommandExecutor
    {
        private readonly Dictionary<string, CommandInfo> _commands = [];
        private WebDriverException? _terminationFailure;
        private WebDriverException? _quitFailure;
        private Exception? _disposalFailure;
        private bool _quitFailureOnce;
        public int SessionCreations { get; private set; }
        public int Terminations { get; private set; }
        public int Activations { get; private set; }
        public int Quits { get; private set; }
        public int ConfirmedQuitRegistrations { get; private set; }
        public void FailTermination(WebDriverException exception) => _terminationFailure = exception;
        public void FailQuit(WebDriverException exception) => _quitFailure = exception;
        public void FailDisposal(Exception exception) => _disposalFailure = exception;
        public void FailNextQuit(WebDriverException exception)
        {
            _quitFailure = exception;
            _quitFailureOnce = true;
        }
        public List<Dictionary<string, object>> Launches { get; } = [];
        public bool TryAddCommand(string name, CommandInfo? info)
        {
            if (name == "bibleConfirmedQuit")
            {
                ConfirmedQuitRegistrations++;
            }
            return info != null && _commands.TryAdd(name, info);
        }
        public void Dispose()
        {
            if (_disposalFailure != null)
            {
                throw _disposalFailure;
            }
            _commands.Clear();
        }
        public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();
        public Task<Response> ExecuteAsync(Command command)
        {
            object? value = null;
            if (command.Name == DriverCommand.NewSession)
            {
                SessionCreations++;
                value = new Dictionary<string, object>
                {
                    ["platformName"] = platform == MobilePlatform.IOS ? "iOS" : "Android"
                };
            }
            else if (command.Name == "terminateApp")
            {
                Terminations++;
                if (_terminationFailure != null)
                {
                    throw _terminationFailure;
                }
                value = true;
            }
            else if (command.Name == "activateApp")
            {
                Activations++;
            }
            else if (command.Name == DriverCommand.ExecuteScript)
            {
                Assert.Equal("mobile: launchApp", command.Parameters["script"]);
                var arguments = Assert.IsType<Dictionary<string, object>>(
                    Assert.Single((IEnumerable<object>)command.Parameters["args"]!));
                Launches.Add(Assert.IsType<Dictionary<string, object>>(arguments["environment"]));
            }
            else if (command.Name == "getOrientation")
            {
                value = "PORTRAIT";
            }
            else if (command.Name == DriverCommand.Quit || command.Name == "bibleConfirmedQuit")
            {
                Quits++;
                if (_quitFailure != null)
                {
                    var failure = _quitFailure;
                    if (_quitFailureOnce)
                    {
                        _quitFailure = null;
                    }
                    throw failure;
                }
            }
            return Task.FromResult(new Response("unit-session", value, WebDriverResult.Success));
        }
    }
}
