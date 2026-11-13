using System.Drawing;
using System.Xml;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class CalendarSnapshotTests
{
    private static string Label(string attributes = "", string id = "MiniMonthDayText") =>
        $"<XCUIElementTypeStaticText name='{id}' visible='true' x='10' y='20' width='30' height='40' label='יום ראשון, בראשית א' {attributes}/>";

    private static string Tree(params string[] children) => $"<AppiumAUT>{string.Concat(children)}</AppiumAUT>";

    [Fact]
    public void DenseCalendarUsesOneFreshSourcePerCaptureWithRealVisibility()
    {
        var executor = new SourceExecutor(Tree(Enumerable.Repeat(Label(id: "MiniMonthDaySource"), 90).ToArray()));
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var platform = new IosPlatformAdapter();
        var first = CalendarSnapshot.Capture(driver, platform, "MiniMonthDaySource");
        executor.Source = Tree(Label("value='new state'", "MiniMonthDaySource"));
        var next = CalendarSnapshot.Capture(driver, platform, "MiniMonthDaySource");
        Assert.Equal(90, first.Rendered("MiniMonthDaySource").Count);
        Assert.Equal("new state", Assert.Single(next.Rendered("MiniMonthDaySource")).Text);
        Assert.Equal(2, executor.SourceCalls);
        Assert.Equal("mobile: source", executor.LastParameters!["script"]);
        var args = Assert.IsAssignableFrom<IEnumerable<object>>(executor.LastParameters["args"]);
        var options = Assert.IsAssignableFrom<IDictionary<string, object>>(Assert.Single(args));
        Assert.Equal("xml", options["format"]);
        Assert.Equal("accessible", options["excludedAttributes"]);
        Assert.DoesNotContain(DriverCommand.FindElements, executor.Commands);
        Assert.DoesNotContain(DriverCommand.GetElementAttribute, executor.Commands);
        Assert.DoesNotContain(DriverCommand.GetElementRect, executor.Commands);
        Assert.DoesNotContain(DriverCommand.GetElementText, executor.Commands);
    }

    [Fact]
    public void HiddenAndOffscreenNodesCannotSatisfyReadiness()
    {
        var hidden = Label().Replace("visible='true'", "visible='false'", StringComparison.Ordinal);
        var outside = Label().Replace("y='20'", "y='200'", StringComparison.Ordinal);
        var snapshot = CalendarSnapshot.Parse(Tree(hidden, outside), new Size(100, 100), "MiniMonthDayText");
        Assert.False(snapshot.IsReady);
        // Rendered geometry retains native-displayed nodes, including ones
        // clipped by the edge, just like the original RenderedElements read.
        Assert.Single(snapshot.Rendered("MiniMonthDayText"));
        Assert.Throws<InvalidOperationException>(() => snapshot.FirstInViewport("MiniMonthDayText"));
    }

    [Fact]
    public void ReadinessRequiresEveryRequestedIdAndPositiveExtent()
    {
        var zero = Label(id: "MiniMonthWeek").Replace("width='30'", "width='0'", StringComparison.Ordinal);
        var snapshot = CalendarSnapshot.Parse(Tree(Label(), zero), new Size(100, 100),
            "MiniMonthDayText", "MiniMonthWeek", "MiniMonthTitle");
        Assert.False(snapshot.IsReady);
        Assert.Empty(snapshot.Rendered("MiniMonthTitle"));
    }

    [Fact]
    public void ReadinessKeepsNativeFractionalBoundsBeforeRoundingForGeometry()
    {
        var xml = Tree(Label().Replace("x='10'", "x='-15.1'", StringComparison.Ordinal));
        var snapshot = CalendarSnapshot.Parse(xml, new Size(100, 100), "MiniMonthDayText");
        Assert.False(snapshot.IsReady);
        Assert.Equal(-15, Assert.Single(snapshot.Rendered("MiniMonthDayText")).Frame.Location.X);
    }

    [Theory]
    [InlineData("visible='true'", "")]
    [InlineData("visible='true'", "visible='perhaps'")]
    [InlineData("x='10'", "x='NaN'")]
    [InlineData("y='20'", "y='Infinity'")]
    [InlineData("width='30'", "width='-1'")]
    [InlineData("height='40'", "")]
    [InlineData("label='יום ראשון, בראשית א'", "")]
    public void IncompleteNativeEvidenceFailsClosed(string original, string replacement)
    {
        var xml = Tree(Label().Replace(original, replacement, StringComparison.Ordinal));
        Assert.Throws<WebDriverException>(() => CalendarSnapshot.Parse(xml, new Size(100, 100), "MiniMonthDayText"));
    }

    [Fact]
    public void XmlTextUsesNativeValueThenLabelWithoutLosingHebrewOrEscapes()
    {
        var snapshot = CalendarSnapshot.Parse(Tree(Label("value='תנ&quot;ך &amp; מקור'", "MiniMonthDaySource"),
                Label("value=''", "MiniMonthDaySource")), new Size(100, 100), "MiniMonthDaySource");
        Assert.Equal(["תנ\"ך & מקור", "יום ראשון, בראשית א"], snapshot.Rendered("MiniMonthDaySource").Select(label => label.Text));
        Assert.Equal((new Point(10, 20), new Size(30, 40)), snapshot.FirstInViewport("MiniMonthDaySource").Frame);
    }

    [Fact]
    public void DayAlignmentUsesTheSpokenLabelWhenTheNativeValueIsADayNumeral()
    {
        var snapshot = CalendarSnapshot.Parse(Tree(Label("value='א'")), new Size(100, 100), "MiniMonthDayText");
        Assert.Equal("יום ראשון, בראשית א", Assert.Single(snapshot.Rendered("MiniMonthDayText")).Text);
    }

    [Fact]
    public void ADayNumeralCannotReplaceMissingSpokenWeekdayEvidence()
    {
        var xml = Tree(Label("value='א'").Replace("label='יום ראשון, בראשית א'", "", StringComparison.Ordinal));
        Assert.Throws<WebDriverException>(() => CalendarSnapshot.Parse(xml, new Size(100, 100), "MiniMonthDayText"));
    }

    [Theory]
    [InlineData("MiniMonthWeek")]
    [InlineData("MiniMonthTitle")]
    public void GeometryOnlyNodesNeedVisibilityAndBoundsButNoText(string id)
    {
        var node = $"<XCUIElementTypeOther name='{id}' visible='true' x='0' y='20' width='90' height='20'/>";
        var snapshot = CalendarSnapshot.Parse(Tree(node), new Size(100, 100), id);
        Assert.True(snapshot.IsReady);
        Assert.Equal(new Size(90, 20), snapshot.FirstInViewport(id).Frame.Size);
    }

    [Fact]
    public void ExternalEntitiesAreRejectedBeforeAnyCalendarEvidenceIsAccepted()
    {
        const string xml = "<!DOCTYPE AppiumAUT [<!ENTITY external SYSTEM 'file:///untrusted'>]><AppiumAUT>&external;</AppiumAUT>";
        Assert.Throws<XmlException>(() => CalendarSnapshot.Parse(xml, new Size(100, 100), "MiniMonthDayText"));
    }

    [Fact]
    public void DeadSessionDoesNotRetryTheSourceRequest()
    {
        var executor = new SourceExecutor("") { FailSource = true };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var failure = Assert.Throws<WebDriverTimeoutException>(() =>
            CalendarSnapshot.WaitFor(driver, new IosPlatformAdapter(), "MiniMonthDayText"));
        Assert.True(DeviceSessionDeath.Matches(failure));
        Assert.Equal(1, executor.SourceCalls);
    }

    [Theory]
    [InlineData(WebDriverResult.Timeout)]
    [InlineData(WebDriverResult.ObsoleteElement)]
    public void TransientObservationErrorsRetryWithAFreshCalendarTree(WebDriverResult status)
    {
        var executor = new SourceExecutor(Tree(Label())) { FirstSourceFailure = status };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var snapshot = CalendarSnapshot.WaitFor(driver, new IosPlatformAdapter(), "MiniMonthDayText");
        Assert.True(snapshot.IsReady);
        Assert.Equal(2, executor.SourceCalls);
    }

    private sealed class SourceExecutor(string source) : ICommandExecutor
    {
        private readonly Dictionary<string, CommandInfo?> _registeredCommands = new(StringComparer.Ordinal);
        public string Source { get; set; } = source;
        public bool FailSource { get; init; }
        public WebDriverResult? FirstSourceFailure { get; init; }
        public int SourceCalls { get; private set; }
        public List<string> Commands { get; } = [];
        public Dictionary<string, object?>? LastParameters { get; private set; }
        public bool TryAddCommand(string name, CommandInfo? info) => _registeredCommands.TryAdd(name, info);
        public void Dispose() => _registeredCommands.Clear();
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
            else if (command.Name == DriverCommand.ExecuteScript)
            {
                LastParameters = command.Parameters;
                SourceCalls++;
                if (SourceCalls == 1 && FirstSourceFailure is { } observationFailure)
                {
                    status = observationFailure;
                    value = new Dictionary<string, object> { ["message"] = "Transient calendar observation failure." };
                }
                else if (FailSource)
                {
                    status = WebDriverResult.Timeout;
                    value = new Dictionary<string, object>
                    {
                        ["message"] = "The driver did not receive any response from the 'execute' command within 120000 ms"
                    };
                }
                else { value = Source; }
            }
            else if (command.Name == DriverCommand.GetWindowRect)
            {
                value = new Dictionary<string, object> { ["x"] = 0, ["y"] = 0, ["width"] = 100, ["height"] = 100 };
            }
            return Task.FromResult(new Response("calendar-session", value, status));
        }
    }
}
