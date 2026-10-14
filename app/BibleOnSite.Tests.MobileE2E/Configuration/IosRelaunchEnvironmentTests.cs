using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosRelaunchEnvironmentTests
{
    private static readonly IReadOnlyDictionary<string, string> ScenarioEnvironment =
        new Dictionary<string, string> { ["BIBLE_E2E_PERUSHIM"] = "1" };

    [Fact]
    public void EveryStoppedAppRestartUsesExplicitLaunchWithBaselineEnvironment()
    {
        var executor = new RelaunchExecutor();
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var adapter = new IosPlatformAdapter();
        adapter.RestartApp(driver, null);
        adapter.RestartApp(driver, null);
        Assert.Equal(2, executor.Terminations);
        Assert.Equal(2, executor.Launches.Count);
        Assert.All(executor.Launches, AssertBaselineEnvironment);
    }

    [Fact]
    public void RestartAfterScenarioEnvironmentClearsStoredVariables()
    {
        var executor = new RelaunchExecutor();
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var adapter = new IosPlatformAdapter();
        adapter.RestartApp(driver, ScenarioEnvironment);
        adapter.RestartApp(driver, null);
        adapter.RestartApp(driver, null);
        Assert.Equal("1", executor.Launches[0]["BIBLE_E2E_PERUSHIM"]);
        AssertBaselineEnvironment(executor.Launches[1]);
        AssertBaselineEnvironment(executor.Launches[2]);
    }

    [Fact]
    public void InteractionTimeoutFailsWithoutRetryingTheStoppedAppLaunch()
    {
        var executor = new RelaunchExecutor { LaunchTimeout = true };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        Assert.Throws<WebDriverTimeoutException>(() => new IosPlatformAdapter().RestartApp(driver, null));
        Assert.Equal(1, executor.Terminations);
        Assert.Single(executor.Launches);
    }

    [Fact]
    public void OnlyTheExistingXctDaemonLaunchErrorIsTransient()
    {
        var timeout = new WebDriverException(
            "Error Domain=XCTDaemonErrorDomain Code=5 \"Timed out attempting to launch app.\"");
        var persistent = new WebDriverException("no such session");
        Assert.True(IosPlatformAdapter.IsTransientLaunchError(timeout));
        Assert.False(IosPlatformAdapter.IsTransientLaunchError(persistent));
    }

    private static void AssertBaselineEnvironment(Dictionary<string, object> environment)
    {
        var baseline = MobilePlatformAdapter.IosE2eEnvironment;
        Assert.Equal(baseline.Count, environment.Count);
        foreach (var (key, value) in baseline)
        {
            Assert.Equal(value, environment[key]);
        }
    }

    private sealed class RelaunchExecutor : ICommandExecutor
    {
        public int Terminations { get; private set; }
        public List<Dictionary<string, object>> Launches { get; } = [];
        public bool LaunchTimeout { get; init; }
        public bool TryAddCommand(string name, CommandInfo? info) => true;
        public void Dispose() { }
        public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();
        public Task<Response> ExecuteAsync(Command command)
        {
            object? value = null;
            var status = WebDriverResult.Success;
            if (command.Name == DriverCommand.NewSession)
            {
                value = new Dictionary<string, object> { ["platformName"] = "iOS" };
            }
            else if (command.Name == "terminateApp")
            {
                Terminations++;
                value = true;
            }
            else if (command.Name == DriverCommand.ExecuteScript)
            {
                Assert.Equal("mobile: launchApp", command.Parameters["script"]);
                var args = Assert.IsType<Dictionary<string, object>>(
                    Assert.Single((IEnumerable<object>)command.Parameters["args"]!));
                Assert.Equal("com.tanah.daily929", args["bundleId"]);
                Launches.Add(Assert.IsType<Dictionary<string, object>>(args["environment"]));
                if (LaunchTimeout)
                {
                    status = WebDriverResult.Timeout;
                    value = new Dictionary<string, object>
                    {
                        ["message"] = "The driver did not receive any response within 45000 ms"
                    };
                }
            }
            else if (command.Name == "getOrientation")
            {
                value = "PORTRAIT";
            }
            return Task.FromResult(new Response("relaunch-session", value, status));
        }
    }
}
