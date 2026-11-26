using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class AndroidBackNavigationTests
{
    [Fact]
    public void BackPressesOnceWhenThePageTurnsAndSettles()
    {
        // The failing runs left the app one page deep: pressBack reported
        // success for a key the navigation stack dropped mid-animation.
        var executor = new BackExecutor(swallowFirstPress: false);
        using var driver = new AndroidDriver(executor, new AppiumOptions { PlatformName = "Android" });
        new AndroidPlatformAdapter().GoBack(driver);
        Assert.Equal(1, executor.Presses);
    }

    [Fact]
    public void BackReissuesTheKeyWhenTheTreeNeverTurns()
    {
        var executor = new BackExecutor(swallowFirstPress: true);
        using var driver = new AndroidDriver(executor, new AppiumOptions { PlatformName = "Android" });
        new AndroidPlatformAdapter().GoBack(driver);
        Assert.Equal(2, executor.Presses);
    }

    [Fact]
    public void BackGivesUpAfterOneRetryInsteadOfPressingForever()
    {
        var executor = new BackExecutor(swallowFirstPress: true, swallowEveryPress: true);
        using var driver = new AndroidDriver(executor, new AppiumOptions { PlatformName = "Android" });
        new AndroidPlatformAdapter().GoBack(driver);
        Assert.Equal(2, executor.Presses);
    }

    /// <summary>
    /// Models the physics of a pop: a registered press rewrites the tree over
    /// a few frames before it settles, a dropped press changes nothing.
    /// </summary>
    private sealed class BackExecutor(bool swallowFirstPress, bool swallowEveryPress = false) : ICommandExecutor
    {
        public int Presses { get; private set; }
        private readonly Dictionary<string, CommandInfo> _commands = [];
        private readonly Queue<string> _frames = new();
        private string _source = "<preferences/>";
        public bool TryAddCommand(string name, CommandInfo? info) =>
            info != null && _commands.TryAdd(name, info);
        public void Dispose() => _commands.Clear();
        public Response Execute(Command command) => ExecuteAsync(command).GetAwaiter().GetResult();
        public Task<Response> ExecuteAsync(Command command)
        {
            object? value = null;
            if (command.Name == DriverCommand.NewSession)
            {
                value = new Dictionary<string, object> { ["platformName"] = "Android" };
            }
            else if (command.Name == DriverCommand.GetPageSource)
            {
                if (_frames.Count > 0)
                {
                    _source = _frames.Dequeue();
                }
                value = _source;
            }
            else if (command.Name == DriverCommand.GoBack)
            {
                var swallow = swallowEveryPress || (swallowFirstPress && Presses == 0);
                Presses++;
                if (!swallow)
                {
                    _frames.Enqueue("<preferences-pop/>");
                    _frames.Enqueue("<reader/>");
                }
            }
            return Task.FromResult(new Response("back-session", value, WebDriverResult.Success));
        }
    }
}
