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
    public void BackPressesOnceIntoAQuietTreeAndWaitsForThePopToSettle()
    {
        // The failing runs left the app one page deep: pressBack reported
        // success for a key the shell consumed inside its settle window.
        var executor = new BackExecutor();
        using var driver = new AndroidDriver(executor, new AppiumOptions { PlatformName = "Android" });
        new AndroidPlatformAdapter().GoBack(driver);
        Assert.Equal(1, executor.Presses);
        // The press waits out a full quiet window on the starting page, and
        // the helper must not return on the first rewrite: the pop counts
        // only once the settled frame served twice in a row.
        var quietFor = executor.PressedAt!.Value - executor.FirstSampleAt!.Value;
        Assert.True(quietFor >= TimeSpan.FromMilliseconds(500), $"pressed after only {quietFor.TotalMilliseconds}ms of quiet");
        var quiet = executor.Served.TakeWhile(frame => frame == "<preferences/>").Count();
        Assert.Equal(new[] { "<preferences-pop/>", "<reader/>", "<reader/>" }, executor.Served.Skip(quiet));
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

    [Fact]
    public void BackWaitsOutAPushInFlightInsteadOfPressingIntoIt()
    {
        // A press inside the push's settle window is consumed, yet the push's
        // own rewrite still turns the tree — the false positive the one-shot
        // verification could not tell from a pop. The push holds a frame for
        // three samples mid-animation and stays in flight past the first full
        // quiet window, so equal snapshots alone are not a settled page; the
        // press must land only after the push goes quiet.
        var executor = new BackExecutor(pushFrames: new[]
        {
            "<push-mid/>", "<push-mid/>", "<push-mid/>", "<push-late/>",
            "<push-tail/>", "<push-final/>", "<settings/>"
        });
        using var driver = new AndroidDriver(executor, new AppiumOptions { PlatformName = "Android" });
        new AndroidPlatformAdapter().GoBack(driver);
        Assert.Equal(1, executor.Presses);
        Assert.Equal(1, executor.AcceptedPresses);
        Assert.Equal(new[] { "<reader/>", "<reader/>" }, executor.Served.TakeLast(2));
    }

    /// <summary>
    /// Models the physics of the shell's settle window: the tree rewrites
    /// itself frame by frame while a transition runs, a press landing in
    /// that window is consumed without a pop, and only a press into a quiet
    /// tree pushes the pop frames. <paramref name="pushFrames"/> plays an
    /// unrelated in-flight push before the tree goes quiet.
    /// </summary>
    private sealed class BackExecutor(
        bool swallowFirstPress = false,
        bool swallowEveryPress = false,
        IReadOnlyList<string>? pushFrames = null) : ICommandExecutor
    {
        public int Presses { get; private set; }
        public int AcceptedPresses { get; private set; }
        public List<string> Served { get; } = new();
        public DateTime? FirstSampleAt { get; private set; }
        public DateTime? PressedAt { get; private set; }
        private readonly Dictionary<string, CommandInfo> _commands = [];
        private readonly Queue<string> _frames = new(pushFrames ?? Array.Empty<string>());
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
                FirstSampleAt ??= DateTime.UtcNow;
                Served.Add(_source);
                value = _source;
            }
            else if (command.Name == DriverCommand.GoBack)
            {
                var swallow = swallowEveryPress || (swallowFirstPress && Presses == 0);
                Presses++;
                PressedAt ??= DateTime.UtcNow;
                // The settle window owns every press while the tree is still
                // rewriting itself; such a press never reaches the stack.
                if (!swallow && _frames.Count == 0)
                {
                    AcceptedPresses++;
                    _frames.Enqueue("<preferences-pop/>");
                    _frames.Enqueue("<reader/>");
                }
            }
            return Task.FromResult(new Response("back-session", value, WebDriverResult.Success));
        }
    }
}
