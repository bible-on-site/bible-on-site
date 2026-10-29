using System.Drawing;
using BibleOnSite.Tests.MobileE2E.Platforms;
using BibleOnSite.Tests.MobileE2E.Pages;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

[Trait("Category", "Unit")]
public sealed class NativeSnapshotTests
{
    private static Dictionary<string, object> Entry(string id, bool displayed = true, double x = 0, double y = 0) => new()
    {
        ["element-6066-11e4-a52e-4f735466cecf"] = id,
        ["displayed"] = displayed,
        ["text"] = id,
        ["enabled"] = displayed,
        ["rect"] = new Dictionary<string, object>
        {
            ["x"] = x,
            ["y"] = y,
            ["width"] = 20,
            ["height"] = 20d
        }
    };

    [Fact]
    public void EachLookupReturnsItsOwnNativeStateInOneCommand()
    {
        var executor = new SnapshotExecutor([Entry("first"), Entry("next", false)]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var first = Assert.Single(driver.FindSnapshots(MobileBy.AccessibilityId("PerekSource")));
        var next = Assert.Single(driver.FindSnapshots(MobileBy.AccessibilityId("PerekSource")));
        Assert.True(first.Snapshot.IsVisibleIn(new(100, 100)));
        Assert.False(next.Snapshot.IsVisibleIn(new(100, 100)));
        Assert.Equal("first", first.Snapshot.Id);
        Assert.Equal("next", next.Snapshot.Id);
        Assert.Equal(2, executor.Lookups);
        Assert.Equal("accessibility id", executor.LastParameters!["using"]);
        Assert.Equal("PerekSource", executor.LastParameters["value"]);
        Assert.DoesNotContain(DriverCommand.IsElementDisplayed, executor.Commands);
        Assert.DoesNotContain(DriverCommand.GetElementRect, executor.Commands);
    }

    [Theory]
    [InlineData(true, @"name == 'PasukText' AND (value == 'it\'s \\ here' OR label == 'it\'s \\ here')")]
    [InlineData(false, "name == 'PasukText' AND visible == 1")]
    public void NarrowedLookupsAreFilteredOnTheDeviceWithEscapedLiterals(bool byText, string predicate)
    {
        var executor = new SnapshotExecutor([Entry("target")]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var adapter = new IosPlatformAdapter();
        driver.FindSnapshots(byText
            ? adapter.AutomationIdWithText("PasukText", @"it's \ here")
            : adapter.DisplayedAutomationId("PasukText"));
        Assert.Equal("-ios predicate string", executor.LastParameters!["using"]);
        Assert.Equal(predicate, executor.LastParameters["value"]);
    }

    [Fact]
    public void AndroidNarrowedLookupsKeepTheResourceIdLocator()
    {
        var adapter = new AndroidPlatformAdapter();
        Assert.Equal(adapter.AutomationId("PasukText"), adapter.AutomationIdWithText("PasukText", "text"));
        Assert.Equal(adapter.AutomationId("PasukText"), adapter.DisplayedAutomationId("PasukText"));
    }

    [Fact]
    public void PageLookupsByIdUseThePlainAccessibilityId()
    {
        var executor = new SnapshotExecutor([Entry("ready")]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        new PerekPage(driver, new IosPlatformAdapter()).WaitFor("PerekSource");
        Assert.Equal("accessibility id", executor.LastParameters!["using"]);
        Assert.Equal("PerekSource", executor.LastParameters["value"]);
    }

    [Fact]
    public void PollConditionsUseFreshTextButTheReturnedElementStaysLive()
    {
        var executor = new SnapshotExecutor([Entry("ready")]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var page = new PerekPage(driver, new IosPlatformAdapter());
        var element = page.WaitFor("PerekSource", candidate => candidate.Text == "ready" && candidate.Enabled);
        Assert.DoesNotContain(DriverCommand.GetElementText, executor.Commands);
        Assert.DoesNotContain(DriverCommand.IsElementEnabled, executor.Commands);
        Assert.Equal("live text after lookup", element.Text);
        Assert.False(element.Enabled);
        Assert.Single(executor.Commands, command => command == DriverCommand.GetElementText);
        Assert.Single(executor.Commands, command => command == DriverCommand.IsElementEnabled);
    }

    [Fact]
    public void ReadOnlySearchGeometryNeedsNoNativeHitTestOrPropertyRequests()
    {
        var executor = new SnapshotExecutor([Entry("search input", x: 10, y: 20)]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var match = Assert.Single(new PerekPage(driver, new IosPlatformAdapter()).RenderedElements("PerekSearchInput"));
        Assert.Equal("search input", match.Text);
        Assert.Equal(new Point(10, 20), match.Frame.Location);
        Assert.Equal(1, executor.Lookups);
        Assert.DoesNotContain(DriverCommand.GetElementAttribute, executor.Commands);
        Assert.DoesNotContain(DriverCommand.GetElementRect, executor.Commands);
        Assert.DoesNotContain(DriverCommand.GetElementText, executor.Commands);
    }

    [Fact]
    public void RejectedTextDoesNotRequestAViewportButTheAcceptedPollDoes()
    {
        var executor = new SnapshotExecutor([Entry("loading"), Entry("ready")]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var page = new PerekPage(driver, new IosPlatformAdapter());
        page.WaitFor("PerekSource", candidate => candidate.Text == "ready");
        Assert.Equal(2, executor.Lookups);
        Assert.Single(executor.Commands, command => command == DriverCommand.GetWindowRect);
    }

    [Fact]
    public void TimedOutLookupRetriesWithinThePollDeadline()
    {
        var executor = new SnapshotExecutor([Entry("ready")]) { TimeoutOnLookup = 1 };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var page = new PerekPage(driver, new IosPlatformAdapter());
        Assert.NotNull(page.WaitFor("PerekSource"));
        Assert.Equal(2, executor.Lookups);
    }

    [Fact]
    public void HiddenWaitRetriesAfterACommandTimeout()
    {
        var executor = new SnapshotExecutor([]) { TimeoutOnLookup = 1 };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var page = new PerekPage(driver, new IosPlatformAdapter());
        page.WaitForHidden("FlyoutPreferences");
        Assert.Equal(2, executor.Lookups);
    }

    [Fact]
    public void ScrollReturnRetriesAHeadingLookupStraggler()
    {
        var executor = new SnapshotExecutor([Entry("collection"), Entry("collection"), Entry("heading", y: 40)])
        {
            TimeoutOnLookup = 2,
            FrameWidth = 100
        };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var page = new PerekPage(driver, new IosPlatformAdapter());
        Assert.NotNull(page.ScrollBackTo("PasukText", "heading"));
        Assert.Equal(3, executor.Lookups);
    }

    [Fact]
    public void TouchGeometryReadsTheCurrentFrameOnceInsteadOfReusingLookupBounds()
    {
        var executor = new SnapshotExecutor([Entry("ready", x: 1)]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var match = Assert.Single(driver.FindSnapshots(MobileBy.AccessibilityId("PerekSource")));
        var first = MobilePlatformAdapter.ReadFrame(match.Element);
        Assert.Equal(new Point(10, 20), first.Location);
        Assert.Equal(new Size(30, 40), first.Size);
        executor.FrameX = 50;
        Assert.Equal(50, MobilePlatformAdapter.ReadFrame(match.Element).Location.X);
        Assert.Equal(2, executor.Commands.Count(command => command == DriverCommand.GetElementRect));
    }

    [Fact]
    public void ConditionsDoNotRetainValuesAcrossLookups()
    {
        var executor = new SnapshotExecutor([Entry("first"), Entry("next", false)]);
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        var first = Assert.Single(driver.FindSnapshots(MobileBy.AccessibilityId("PerekSource")));
        var next = Assert.Single(driver.FindSnapshots(MobileBy.AccessibilityId("PerekSource")));
        Assert.Equal("first", first.ConditionElement.Text);
        Assert.True(first.ConditionElement.Enabled);
        Assert.Equal("next", next.ConditionElement.Text);
        Assert.False(next.ConditionElement.Enabled);
    }

    [Fact]
    public void EmptyNativeTextIsValidButMissingTextIsRejected()
    {
        var entry = Entry("empty");
        entry["text"] = null!;
        Assert.Equal(string.Empty, Assert.Single(NativeElementSnapshot.Decode(new object[] { entry })).Text);
        entry.Remove("text");
        Assert.Throws<WebDriverException>(() => NativeElementSnapshot.Decode(new object[] { entry }));
    }

    [Fact]
    public void NativeStaleErrorsKeepTheSdkExceptionType()
    {
        var executor = new SnapshotExecutor([]) { Stale = true };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        Assert.Throws<StaleElementReferenceException>(() => driver.FindSnapshots(By.XPath("//*")));
    }

    [Fact]
    public void PreloadedOffscreenElementsAreExcludedEvenWhenDisplayed()
    {
        var snapshot = Assert.Single(NativeElementSnapshot.Decode(new object[] { Entry("outside", x: 200) }));
        Assert.False(snapshot.IsVisibleIn(new(100, 100)));
    }

    [Fact]
    public void VisibilityUsesTheCurrentViewportAfterRotation()
    {
        var snapshot = Assert.Single(NativeElementSnapshot.Decode(new object[] { Entry("rotated", x: 120) }));
        Assert.False(snapshot.IsVisibleIn(new(100, 200)));
        Assert.True(snapshot.IsVisibleIn(new(200, 100)));
    }

    [Fact]
    public void ZeroSizedFramesAreNeverVisible() =>
        Assert.False(new NativeElementSnapshot("empty", true, 0, 0, 0, 20, string.Empty, true).IsVisibleIn(new(100, 100)));

    [Fact]
    public void FractionalNativeCoordinatesArePreserved()
    {
        var entry = Entry("fractional", x: -10.25);
        var snapshot = Assert.Single(NativeElementSnapshot.Decode(new object[] { entry }));
        Assert.Equal(-10.25, snapshot.X);
        Assert.False(snapshot.IsVisibleIn(new(100, 100)));
    }

    [Theory]
    [InlineData("element-6066-11e4-a52e-4f735466cecf")]
    [InlineData("displayed")]
    [InlineData("rect")]
    [InlineData("text")]
    [InlineData("enabled")]
    public void IncompleteMetadataCannotBecomeASuccessfulVisibilityCheck(string missing)
    {
        var entry = Entry("incomplete");
        entry.Remove(missing);
        Assert.Throws<WebDriverException>(() => NativeElementSnapshot.Decode(new object[] { entry }));
    }

    [Fact]
    public void NonfiniteFramesFailInsteadOfHidingControls()
    {
        var entry = Entry("bad", x: double.NaN);
        Assert.Throws<WebDriverException>(() => NativeElementSnapshot.Decode(new object[] { entry }));
    }

    [Fact]
    public void AnEmptyLookupStaysEmpty() => Assert.Empty(NativeElementSnapshot.Decode(Array.Empty<object>()));

    [Fact]
    public void RealWireJsonUsesTheSameDecoderAsTheDriver()
    {
        var response = Response.FromJson("""
            {"value":[{"element-6066-11e4-a52e-4f735466cecf":"wire-id","displayed":true,"text":"wire text","enabled":true,"rect":{"x":1.25,"y":2,"width":20,"height":30}}]}
            """);
        var snapshot = Assert.Single(NativeElementSnapshot.Decode(response.Value));
        Assert.Equal("wire-id", snapshot.Id);
        Assert.Equal(1.25, snapshot.X);
        Assert.True(snapshot.IsVisibleIn(new(100, 100)));
    }

    [Theory]
    [InlineData("PORTRAIT", 0)]
    [InlineData("LANDSCAPE", 1)]
    public void PortraitResetUsesTheActualOrientationAndAvoidsRedundantRotation(string initial, int rotations)
    {
        var executor = new SnapshotExecutor([]) { Orientation = initial };
        using var driver = new IosSnapshotDriver(executor, new AppiumOptions { PlatformName = "iOS" });
        MobilePlatformAdapter.EnsurePortrait(driver);
        Assert.Equal(ScreenOrientation.Portrait, driver.Orientation);
        Assert.Equal(rotations, executor.Commands.Count(command => command == "setOrientation"));
    }

    private sealed class SnapshotExecutor(Dictionary<string, object>[] results) : ICommandExecutor
    {
        public List<string> Commands { get; } = [];
        public int Lookups { get; private set; }
        public Dictionary<string, object?>? LastParameters { get; private set; }
        public bool Stale { get; init; }
        public int TimeoutOnLookup { get; init; }
        public string Orientation { get; set; } = "PORTRAIT";
        public int FrameX { get; set; } = 10;
        public int FrameWidth { get; set; } = 30;
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
                LastParameters = command.Parameters;
                Lookups++;
                if (Lookups == TimeoutOnLookup)
                {
                    status = WebDriverResult.Timeout;
                    value = new Dictionary<string, object>
                    {
                        ["message"] = "The driver did not receive any response from the 'findElements' command within 45000 ms"
                    };
                }
                else if (Stale)
                {
                    status = WebDriverResult.ObsoleteElement;
                    value = new Dictionary<string, object> { ["message"] = "The native element changed." };
                }
                else
                {
                    value = results.Length == 0
                        ? Array.Empty<object>()
                        : new object[] { results[(Lookups - 1) % results.Length] };
                }
            }
            else if (command.Name == DriverCommand.GetElementRect)
            {
                value = new Dictionary<string, object> { ["x"] = FrameX, ["y"] = 20, ["width"] = FrameWidth, ["height"] = 40 };
            }
            else if (command.Name == DriverCommand.GetWindowRect)
            {
                value = new Dictionary<string, object> { ["x"] = 0, ["y"] = 0, ["width"] = 100, ["height"] = 100 };
            }
            else if (command.Name == DriverCommand.GetElementText)
            {
                value = "live text after lookup";
            }
            else if (command.Name == DriverCommand.IsElementEnabled)
            {
                value = false;
            }
            else if (command.Name == "getOrientation")
            {
                value = Orientation;
            }
            else if (command.Name == "setOrientation")
            {
                Orientation = (string)command.Parameters["orientation"]!;
            }
            return Task.FromResult(new Response("snapshot-session", value, status));
        }
    }
}
