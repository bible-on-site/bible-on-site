using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class DriverTelemetryTests
{
    [Fact]
    public void WindowSizeIsReadFromTheDeviceOncePerDriver()
    {
        var executor = new Executor();
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        Assert.Equal(100, DriverTelemetry.WindowSize(driver).Width);
        Assert.Equal(100, DriverTelemetry.WindowSize(driver).Height);
        Assert.Single(executor.Commands, command => command == DriverCommand.GetWindowRect);
    }

    [Fact]
    public void SetOrientationInvalidatesTheWindowAndTracksTheOrientation()
    {
        var executor = new Executor();
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        DriverTelemetry.WindowSize(driver);
        driver.Orientation = ScreenOrientation.Landscape;
        // The orientation write is observed, so the next read does not re-query.
        Assert.Equal(ScreenOrientation.Landscape, DriverTelemetry.Orientation(driver));
        Assert.Single(executor.Commands, command => command == "setOrientation");
        Assert.DoesNotContain("getOrientation", executor.Commands);
        // Rotating resizes the window, so the next read must hit the device again.
        Assert.Equal(200, DriverTelemetry.WindowSize(driver).Width);
        Assert.Equal(2, executor.Commands.Count(command => command == DriverCommand.GetWindowRect));
    }

    [Fact]
    public void EnsurePortraitQueriesTheOrientationAtMostOncePerDriver()
    {
        var executor = new Executor();
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        MobilePlatformAdapter.EnsurePortrait(driver);
        MobilePlatformAdapter.EnsurePortrait(driver);
        Assert.Single(executor.Commands, command => command == "getOrientation");
        Assert.DoesNotContain("setOrientation", executor.Commands);
    }

    [Fact]
    public void EnsurePortraitStillRotatesAnUncachedLandscapeDriver()
    {
        var executor = new Executor { Orientation = "LANDSCAPE" };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        MobilePlatformAdapter.EnsurePortrait(driver);
        MobilePlatformAdapter.EnsurePortrait(driver);
        Assert.Single(executor.Commands, command => command == "getOrientation");
        Assert.Single(executor.Commands, command => command == "setOrientation");
        Assert.Equal("PORTRAIT", executor.Orientation);
    }

    [Fact]
    public void DriverCommandsAccumulateIntoTheScenarioProfile()
    {
        var executor = new Executor();
        DriverTelemetry.Reset();
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        DriverTelemetry.WindowSize(driver);
        driver.FindElements(MobileBy.AccessibilityId("PasukText"));
        var dump = DriverTelemetry.Dump();
        Assert.Contains(DriverCommand.GetWindowRect, dump);
        Assert.Contains(DriverCommand.FindElements, dump);
    }

    [Fact]
    public void HittableFromTheLookupFeedsCanTapWithoutARoundTrip()
    {
        var executor = new Executor(hittable: true);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var page = new PerekPage(driver, new IosPlatformAdapter());
        var element = page.WaitFor("SearchResultTitle", new IosPlatformAdapter().CanTap);
        Assert.NotNull(element);
        Assert.DoesNotContain(executor.Commands, command => command == DriverCommand.GetElementAttribute);
    }

    [Fact]
    public void MissingHittableInTheLookupFallsBackToTheLiveAttributeRead()
    {
        var executor = new Executor(hittable: false);
        // Strip the key entirely so the poll's CanTap must ask the driver.
        executor.StripHittable = true;
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var page = new PerekPage(driver, new IosPlatformAdapter());
        page.WaitFor("SearchResultTitle", new IosPlatformAdapter().CanTap);
        Assert.Single(executor.Commands, command => command == DriverCommand.GetElementAttribute);
    }

    private sealed class Executor(bool hittable = false) : ICommandExecutor
    {
        public List<string> Commands { get; } = [];
        public string Orientation { get; set; } = "PORTRAIT";
        public bool StripHittable { get; set; }
        private int _windowReads;
        public bool TryAddCommand(string name, CommandInfo? info) => true;
        public void Dispose() { }
        public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();
        public Task<Response> ExecuteAsync(Command command)
        {
            Commands.Add(command.Name);
            object? value = null;
            var status = WebDriverResult.Success;
            if (command.Name == DriverCommand.NewSession)
            {
                value = new Dictionary<string, object> { ["platformName"] = "iOS" };
            }
            else if (command.Name == DriverCommand.FindElements)
            {
                var element = new Dictionary<string, object>
                {
                    ["element-6066-11e4-a52e-4f735466cecf"] = "el",
                    ["displayed"] = true,
                    ["text"] = "el",
                    ["enabled"] = true,
                    ["rect"] = new Dictionary<string, object>
                    {
                        ["x"] = 1, ["y"] = 1, ["width"] = 10, ["height"] = 10
                    }
                };
                if (!StripHittable)
                {
                    element["hittable"] = hittable;
                }
                value = new object[] { element };
            }
            else if (command.Name == DriverCommand.GetElementAttribute)
            {
                value = "true";
            }
            else if (command.Name == DriverCommand.GetWindowRect)
            {
                var width = ++_windowReads == 1 ? 100 : 200;
                value = new Dictionary<string, object> { ["x"] = 0, ["y"] = 0, ["width"] = width, ["height"] = 100 };
            }
            else if (command.Name == "getOrientation")
            {
                value = Orientation;
            }
            else if (command.Name == "setOrientation")
            {
                Orientation = (string)command.Parameters["orientation"]!;
            }
            return Task.FromResult(new Response("telemetry-session", value, status));
        }
    }
}
