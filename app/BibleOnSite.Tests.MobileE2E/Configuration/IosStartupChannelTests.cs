using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

// Issue #3379: a slow iOS terminate left WebDriverAgent's automation session
// bound to the dead process. The relaunch reported success and snapshot
// lookups resolved the new app's tree, while every live attribute read
// faulted — the reader looked loaded and enabled but hittable polled false
// forever. Startup now proves the live channel and relaunches once to re-pin.
[Trait("Category", "Unit")]
public sealed class IosStartupChannelTests
{
    private readonly List<string> _log = [];
    private readonly string _artifacts = Path.Join(Path.GetTempPath(), $"e2e-{Guid.NewGuid():N}");

    [Fact]
    public void StaleAutomationChannelRepinsWithOneAdditionalLaunch()
    {
        var executor = new ChannelExecutor("iOS") { Faulted = true };
        var session = CreateIosSession(executor);
        var test = new ChannelDeviceTest(new ListOutput(_log), session);

        test.ConnectNow();

        Assert.Equal(2, session.Acquisitions);
        Assert.Equal(2, executor.Launches);
        Assert.Equal(2, executor.Terminations);
        Assert.NotNull(test.StartupPage);
        Assert.Contains(_log, line => line.Contains("stayed bound to the terminated process"));
        Assert.DoesNotContain(_log, line => line.Contains("still faults"));
    }

    [Fact]
    public void HealthyChannelKeepsTheSingleStartupAcquire()
    {
        var executor = new ChannelExecutor("iOS");
        var session = CreateIosSession(executor);
        var test = new ChannelDeviceTest(new ListOutput(_log), session);

        test.ConnectNow();

        Assert.Equal(1, session.Acquisitions);
        Assert.Equal(1, executor.Launches);
        Assert.DoesNotContain(_log, line => line.Contains("stayed bound"));
    }

    [Fact]
    public void ChannelRepairCarriesAFreshLaunchIdentity()
    {
        var executor = new ChannelExecutor("iOS") { Faulted = true };
        var session = CreateIosSession(executor);
        var test = new ChannelDeviceTest(new ListOutput(_log), session, instrumented: true);

        test.ConnectNow();

        var first = Assert.IsAssignableFrom<IReadOnlyDictionary<string, string>>(session.Environments[0]);
        var second = Assert.IsAssignableFrom<IReadOnlyDictionary<string, string>>(session.Environments[1]);
        Assert.True(Guid.TryParseExact(first[ReaderStartupReadiness.LaunchIdEnvironmentVariable], "D", out _));
        Assert.True(Guid.TryParseExact(second[ReaderStartupReadiness.LaunchIdEnvironmentVariable], "D", out _));
        Assert.NotEqual(first[ReaderStartupReadiness.LaunchIdEnvironmentVariable],
            second[ReaderStartupReadiness.LaunchIdEnvironmentVariable]);
        Assert.Equal(2, executor.Launches);
    }

    [Fact]
    public void ChannelStillFaultingAfterRepairFailsTheConnect()
    {
        var executor = new ChannelExecutor("iOS") { Faulted = true, StaysFaulted = true };
        var session = CreateIosSession(executor);
        var test = new ChannelDeviceTest(new ListOutput(_log), session);

        // Snapshot-only scenarios must not report green on a reader nothing
        // can tap; the connect fails once the bounded repair is exhausted.
        var failure = Assert.ThrowsAny<Xunit.Sdk.XunitException>(test.ConnectNow);

        Assert.Equal(2, session.Acquisitions);
        Assert.Equal(2, executor.Launches);
        Assert.Contains("still faults through a second launch", failure.Message);
    }

    [Fact]
    public void LandscapeStartupStillRepairsTheFaultedChannel()
    {
        var executor = new ChannelExecutor("iOS") { Faulted = true, Orientation = "LANDSCAPE" };
        var session = CreateIosSession(executor);
        var test = new ChannelDeviceTest(new ListOutput(_log), session);

        test.ConnectNow();

        Assert.Equal(2, session.Acquisitions);
        Assert.Contains(executor.Commands, command => command == "setOrientation");
        Assert.Equal(2, executor.Launches);
    }

    [Fact]
    public void AndroidStartupNeverProbesTheLiveAttributeChannel()
    {
        var executor = new ChannelExecutor("Android");
        var session = new ChannelSession(_artifacts,
            new AndroidDriver(executor, new AppiumOptions { PlatformName = "Android" }),
            new AndroidPlatformAdapter());
        var test = new ChannelDeviceTest(new ListOutput(_log), session);

        test.ConnectNow();

        Assert.Equal(1, session.Acquisitions);
        Assert.DoesNotContain(executor.Commands, command => command == DriverCommand.GetElementAttribute);
        Assert.DoesNotContain(_log, line => line.Contains("stayed bound"));
    }

    private ChannelSession CreateIosSession(ChannelExecutor executor) => new(_artifacts,
        new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" }),
        new IosPlatformAdapter());

    private sealed class ChannelSession(string artifacts, AppiumDriver driver, MobilePlatformAdapter adapter)
        : IMobileDeviceSession
    {
        public MobilePlatformAdapter Adapter { get; } = adapter;
        public MobileTestConfiguration Configuration { get; } = new(
            adapter is IosPlatformAdapter ? MobilePlatform.IOS : MobilePlatform.Android,
            "/test/app", "unit-device", artifacts, new Uri("http://127.0.0.1:4723"));
        public AppiumDriver? Driver => _driver;
        private readonly AppiumDriver _driver = driver;
        public List<IReadOnlyDictionary<string, string>?> Environments { get; } = [];
        public int Acquisitions => Environments.Count;
        public void Acquire(IReadOnlyDictionary<string, string>? environment)
        {
            Environments.Add(environment);
            Adapter.RestartApp(_driver, environment);
        }
    }

    private sealed class ChannelDeviceTest(ITestOutputHelper output, IMobileDeviceSession session,
        bool instrumented = false) : MobileDeviceTest(output, session)
    {
        protected override bool InstrumentedStartup => instrumented;
        protected override TimeSpan WaitForReaderReady(string launchId, TimeSpan budget)
        {
            Assert.True(Guid.TryParseExact(launchId, "D", out _),
                "an instrumented launch carries a canonical launch id");
            return budget;
        }
        protected override TimeSpan LiveChannelProbe => TimeSpan.FromMilliseconds(700);
        public PerekPage StartupPage => Page;
        public void ConnectNow() => Connect();
    }

    private sealed class ListOutput(List<string> lines) : ITestOutputHelper
    {
        public string Output => string.Join("\n", lines);
        public void Write(string message) => lines.Add(message);
        public void Write(string format, params object[] args) => lines.Add(string.Format(format, args));
        public void WriteLine(string message) => lines.Add(message);
        public void WriteLine(string format, params object[] args) => lines.Add(string.Format(format, args));
    }

    // A snapshot lookup always resolves the reader's source button with its
    // non-empty text. The live label read answers only when the automation
    // session is bound to the running process — exactly the incident's fault.
    private sealed class ChannelExecutor(string platformName) : ICommandExecutor
    {
        public bool Faulted { get; set; }
        public bool StaysFaulted { get; init; }
        public string Orientation { get; set; } = "PORTRAIT";
        public List<string> Commands { get; } = [];
        public int Launches { get; private set; }
        public int Terminations { get; private set; }
        private readonly Dictionary<string, CommandInfo> _commands = [];
        public bool TryAddCommand(string name, CommandInfo? info) =>
            info != null && _commands.TryAdd(name, info);
        public void Dispose() => _commands.Clear();
        public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();
        public Task<Response> ExecuteAsync(Command command)
        {
            Commands.Add(command.Name);
            object? value = null;
            if (command.Name == DriverCommand.NewSession)
            {
                value = new Dictionary<string, object> { ["platformName"] = platformName };
            }
            else if (command.Name == "terminateApp")
            {
                Terminations++;
                value = true;
            }
            else if (command.Name == DriverCommand.ExecuteScript)
            {
                Assert.Equal("mobile: launchApp", command.Parameters["script"]);
                // The incident's stale binding survives the launch that created
                // it; only the recovery launch re-pins the automation session.
                Launches++;
                if (Launches > 1 && !StaysFaulted)
                {
                    Faulted = false;
                }
            }
            else if (command.Name == DriverCommand.FindElements)
            {
                value = platformName == "iOS"
                    ? new object[]
                    {
                        new Dictionary<string, object>
                        {
                            ["element-6066-11e4-a52e-4f735466cecf"] = "source",
                            ["displayed"] = true,
                            ["text"] = "מלכים ב ז",
                            ["enabled"] = true,
                            ["rect"] = new Dictionary<string, object>
                            {
                                ["x"] = 52, ["y"] = 68, ["width"] = 238, ["height"] = 44
                            }
                        }
                    }
                    : new object[]
                    {
                        new Dictionary<string, object>
                        {
                            ["element-6066-11e4-a52e-4f735466cecf"] = "source"
                        }
                    };
            }
            else if (command.Name == DriverCommand.GetElementAttribute)
            {
                value = (string)command.Parameters["name"]! == "hittable"
                    ? (Faulted ? "false" : "true")
                    : null;
            }
            else if (command.Name == DriverCommand.GetElementText)
            {
                value = "מלכים ב ז";
            }
            else if (command.Name == DriverCommand.IsElementDisplayed)
            {
                value = true;
            }
            else if (command.Name == DriverCommand.GetElementRect)
            {
                value = new Dictionary<string, object>
                {
                    ["x"] = 52, ["y"] = 68, ["width"] = 238, ["height"] = 44
                };
            }
            else if (command.Name == DriverCommand.GetWindowRect)
            {
                value = new Dictionary<string, object>
                {
                    ["x"] = 0, ["y"] = 0, ["width"] = 402, ["height"] = 874
                };
            }
            else if (command.Name == "getOrientation")
            {
                value = Orientation;
            }
            else if (command.Name == "setOrientation")
            {
                Orientation = (string)command.Parameters["orientation"]!;
            }
            return Task.FromResult(new Response("channel-session", value, WebDriverResult.Success));
        }
    }
}
