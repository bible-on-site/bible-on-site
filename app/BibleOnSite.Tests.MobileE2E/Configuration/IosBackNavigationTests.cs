using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class IosBackNavigationTests
{
    [Theory]
    [InlineData(true, "PreferencesBackButton")]
    [InlineData(false, "//XCUIElementTypeNavigationBar/XCUIElementTypeButton[1]")]
    public void BackTapsTheVisiblePreferencesControlBeforeTryingNativeNavigation(bool preferencesVisible, string expectedLocator)
    {
        // The failing simulator had a visible custom Back button and no native
        // navigation bar. Edge swipes left it on the preferences root page.
        var executor = new BackExecutor(preferencesVisible);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        new IosPlatformAdapter().GoBack(driver);
        Assert.Equal(expectedLocator, executor.LastLocator);
        var sequence = Assert.Single(executor.Actions!);
        var actions = Assert.IsAssignableFrom<IEnumerable<object>>(sequence["actions"])
            .Select(action => Assert.IsType<Dictionary<string, object>>(action)).ToArray();
        Assert.Equal(new[] { "pointerMove", "pointerDown", "pause", "pointerUp" },
            actions.Select(action => action["type"]));
        Assert.Equal(24, actions[0]["x"]);
        Assert.Equal(90, actions[0]["y"]);
        Assert.Equal(1, executor.Touches);
    }

    private sealed class BackExecutor(bool preferencesVisible) : ICommandExecutor
    {
        public string? LastLocator { get; private set; }
        public IEnumerable<Dictionary<string, object>>? Actions { get; private set; }
        public int Touches { get; private set; }
        private readonly Dictionary<string, CommandInfo> _commands = [];
        public bool TryAddCommand(string name, CommandInfo? info) =>
            info != null && _commands.TryAdd(name, info);
        public void Dispose() => _commands.Clear();
        public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();
        public Task<Response> ExecuteAsync(Command command)
        {
            object? value = command.Name switch
            {
                var name when name == DriverCommand.NewSession => new Dictionary<string, object> { ["platformName"] = "iOS" },
                var name when name == DriverCommand.GetPageSource => Touches == 0 ? "<preferences/>" : "<reader/>",
                var name when name == DriverCommand.IsElementDisplayed || name == DriverCommand.IsElementEnabled => true,
                var name when name == DriverCommand.GetElementAttribute => "true",
                var name when name == DriverCommand.GetElementRect => new Dictionary<string, object>
                {
                    ["x"] = 0, ["y"] = 62, ["width"] = 48, ["height"] = 56
                },
                _ => null
            };
            if (command.Name == DriverCommand.FindElements)
            {
                LastLocator = (string)command.Parameters["value"]!;
                var visible = LastLocator != "PreferencesBackButton" || preferencesVisible;
                value = visible ? new object[] { new Dictionary<string, object>
                {
                    ["element-6066-11e4-a52e-4f735466cecf"] = "back"
                } } : Array.Empty<object>();
            }
            else if (command.Name == DriverCommand.Actions)
            {
                Touches++;
                Actions = ((IEnumerable<object>)command.Parameters["actions"]!).Cast<Dictionary<string, object>>();
            }
            return Task.FromResult(new Response("back-session", value, WebDriverResult.Success));
        }
    }
}
