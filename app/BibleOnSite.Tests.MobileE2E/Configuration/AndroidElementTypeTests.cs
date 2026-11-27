using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.Android;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class AndroidElementTypeTests
{
    [Fact]
    public void ElementTypeReadsTheClassNameAttributeNeverTheNameEndpoint()
    {
        // UiAutomator2 server 11.6 answers GET /element/<id>/name with a JSON
        // null for elements without content-desc, which the Selenium client
        // rejects outright (EnsureValueIsNotNull). The widget type lives in
        // the className attribute instead.
        var executor = new AttributeExecutor();
        using var driver = new AndroidDriver(executor, new AppiumOptions { PlatformName = "Android" });
        var element = driver.FindElement(By.Id("com.tanah.daily929:id/PerekSearchInput"));
        Assert.Equal("android.widget.EditText", new AndroidPlatformAdapter().ElementType(element));
        Assert.Equal("className", executor.RequestedAttribute);
        // Exactly session + lookup + one attribute read: a TagName/name-endpoint
        // call (or a swallowed failed one) would show up as a fourth command.
        Assert.Equal(
            new[] { DriverCommand.NewSession, DriverCommand.FindElement, DriverCommand.GetElementAttribute },
            executor.Commands);
    }

    private sealed class AttributeExecutor : ICommandExecutor
    {
        public string? RequestedAttribute { get; private set; }
        public List<string> Commands { get; } = new();
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
                value = new Dictionary<string, object> { ["platformName"] = "Android" };
            }
            else if (command.Name == DriverCommand.FindElement)
            {
                value = new Dictionary<string, object>
                {
                    ["element-6066-11e4-a52e-4f735466cecf"] = "wire-element-id",
                };
            }
            else if (command.Name == DriverCommand.GetElementAttribute)
            {
                RequestedAttribute = command.Parameters["name"]?.ToString();
                value = "android.widget.EditText";
            }
            return Task.FromResult(new Response("attr-session", value, WebDriverResult.Success));
        }
    }
}
