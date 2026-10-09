using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class DeviceSessionRecoveryTests
{
    private readonly List<string> _log = [];
    private readonly FakeDeviceTest _test;
    private readonly string _artifacts = Path.Join(Path.GetTempPath(), $"e2e-{Guid.NewGuid():N}");

    public DeviceSessionRecoveryTests() =>
        _test = new(new ListOutput(_log), new FakeSession(_artifacts));

    [Fact]
    public void SessionLossRebuildsTheSessionAndRerunsOnce()
    {
        var calls = 0;
        _test.Execute(() =>
        {
            calls++;
            if (calls == 1)
            {
                throw new UnknownErrorException(
                    "Could not proxy command to the remote server. Original error: socket hang up");
            }
        });

        Assert.Equal(2, calls);
        Assert.Equal(1, _test.Rebuilds);
        Assert.Contains(_log, line => line.Contains("rebuilding it once"));
    }

    [Fact]
    public void ASecondFailureIsNotRetriedAgain()
    {
        var calls = 0;
        var failure = new UnknownErrorException("invalid session id");
        var thrown = Assert.Throws<UnknownErrorException>(() => _test.Execute(() =>
        {
            calls++;
            throw failure;
        }));

        Assert.Same(failure, thrown);
        Assert.Equal(2, calls);
        Assert.Equal(1, _test.Rebuilds);
    }

    [Fact]
    public void AssertionFailuresNeverTriggerARebuild()
    {
        var calls = 0;
        Assert.ThrowsAny<Xunit.Sdk.XunitException>(() => _test.Execute(() =>
        {
            calls++;
            Assert.Fail("the app rendered the wrong content");
        }));

        Assert.Equal(1, calls);
        Assert.Equal(0, _test.Rebuilds);
    }

    [Fact]
    public void OrdinaryDriverFailuresAreNotRetried()
    {
        var calls = 0;
        Assert.Throws<WebDriverTimeoutException>(() => _test.Execute(() =>
        {
            calls++;
            throw new WebDriverTimeoutException("No visible element matching the locator met the condition.");
        }));

        Assert.Equal(1, calls);
        Assert.Equal(0, _test.Rebuilds);
    }

    [Fact]
    public async Task SessionDeathDuringStartupCreatesTheSessionOnceMore()
    {
        _test.ConnectFailures.Enqueue(new UnknownErrorException("invalid session id"));

        await _test.Start();

        Assert.Equal(2, _test.Rebuilds);
        Assert.Contains(_log, line => line.Contains("died during startup"));
    }

    [Fact]
    public async Task StartupFailuresUnrelatedToTheTransportAreNotRetried()
    {
        var failure = new TimeoutException("session creation timed out before a session id existed");
        _test.ConnectFailures.Enqueue(failure);

        var thrown = await Assert.ThrowsAsync<TimeoutException>(() => _test.Start());

        Assert.Same(failure, thrown);
        Assert.Equal(1, _test.Rebuilds);
    }

    [Fact]
    public async Task ASecondStartupDeathStillFails()
    {
        _test.ConnectFailures.Enqueue(new UnknownErrorException("invalid session id"));
        _test.ConnectFailures.Enqueue(new UnknownErrorException("invalid session id"));

        await Assert.ThrowsAsync<UnknownErrorException>(() => _test.Start());

        Assert.Equal(2, _test.Rebuilds);
    }

    [Fact]
    public void LaunchEnvironmentReachesTheSession()
    {
        var session = new FakeSession(_artifacts);
        var test = new EnvironmentDeviceTest(new ListOutput(_log), session);

        test.Reacquire();

        Assert.Equal("1", session.LastEnvironment?["BIBLE_E2E_PERUSHIM"]);
    }

    private sealed class ListOutput(List<string> lines) : ITestOutputHelper
    {
        public string Output => string.Join("\n", lines);
        public void WriteLine(string message) => lines.Add(message);
        public void WriteLine(string format, params object[] args) => lines.Add(string.Format(format, args));
    }

    private sealed class FakeSession(string artifacts) : IMobileDeviceSession
    {
        public MobilePlatformAdapter Adapter { get; } =
            MobilePlatformAdapter.For(MobilePlatform.Android);
        public MobileTestConfiguration Configuration { get; } = new(
            MobilePlatform.Android, "/test/app", "test-device", artifacts,
            new Uri("http://127.0.0.1:4723"));
        public AppiumDriver? Driver => null;
        public IReadOnlyDictionary<string, string>? LastEnvironment { get; private set; }
        public void Acquire(IReadOnlyDictionary<string, string>? environment) =>
            LastEnvironment = environment;
    }

    private sealed class FakeDeviceTest(ITestOutputHelper output, IMobileDeviceSession session)
        : MobileDeviceTest(output, session)
    {
        public int Rebuilds { get; private set; }
        public Queue<Exception> ConnectFailures { get; } = new();
        protected override void Connect()
        {
            Rebuilds++;
            if (ConnectFailures.Count > 0)
            {
                throw ConnectFailures.Dequeue();
            }
        }
        public void Execute(Action run) => Scenario(run);
        public Task Start() => InitializeAsync();
    }

    private sealed class EnvironmentDeviceTest(ITestOutputHelper output, IMobileDeviceSession session)
        : MobileDeviceTest(output, session)
    {
        protected override IReadOnlyDictionary<string, string> LaunchEnvironment =>
            new Dictionary<string, string> { ["BIBLE_E2E_PERUSHIM"] = "1" };
        public void Reacquire() => AcquireSession();
    }
}
