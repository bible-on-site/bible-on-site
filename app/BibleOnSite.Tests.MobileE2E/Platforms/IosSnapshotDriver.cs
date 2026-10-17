using System.Drawing;
using System.Globalization;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Appium.iOS;
using OpenQA.Selenium.Appium.Interfaces;
using System.Collections.ObjectModel;

namespace BibleOnSite.Tests.MobileE2E.Platforms;

// Preserve SDK error handling and command deadlines. Poll conditions use the
// fresh native lookup response; elements returned to the scenario keep their
// live SDK properties.
internal sealed class IosSnapshotDriver : IOSDriver
{
    public IosSnapshotDriver(Uri server, AppiumOptions options)
        : base(server, options, TimeSpan.FromMinutes(5)) { }

    internal IosSnapshotDriver(ICommandExecutor executor, AppiumOptions options)
        : base(executor, options) { }

    protected override Response? Execute(string driverCommandToExecute, Dictionary<string, object>? parameters)
        => DriverTelemetry.Execute(this, driverCommandToExecute, parameters,
            () => base.Execute(driverCommandToExecute, parameters));

    internal IReadOnlyList<NativeElementMatch> FindSnapshots(By locator)
    {
        var mechanism = locator.Mechanism;
        var criteria = locator.Criteria;
        if (locator is MobileBy)
        {
            // MobileBy keeps its strategy outside Selenium's By properties.
            // Let the SDK resolve it through its public selector interface.
            var capture = new LocatorCapture();
            locator.FindElements(capture);
            mechanism = capture.Mechanism;
            criteria = capture.Criteria;
        }
        if (string.IsNullOrEmpty(mechanism))
        {
            throw new WebDriverException("Native snapshot lookup requires a concrete locator strategy.");
        }

        var response = Execute(DriverCommand.FindElements, new Dictionary<string, object>
        {
            ["using"] = mechanism,
            ["value"] = criteria
        }) ?? throw new WebDriverException("Native lookup returned no response.");
        return NativeElementSnapshot.Decode(response.Value)
            .Select(snapshot => new NativeElementMatch(new NativeLiveElement(this, snapshot.Id),
                new NativeConditionElement(this, snapshot), snapshot))
            .ToArray();
    }
    internal Rectangle ReadFrame(string id)
    {
        var response = Execute(DriverCommand.GetElementRect,
            new Dictionary<string, object> { ["id"] = id })
            ?? throw new WebDriverException("Native frame request returned no response.");
        if (response.Value is not IDictionary<string, object> rect)
        {
            throw new WebDriverException("Native frame request did not return a rectangle.");
        }
        return new(Convert.ToInt32(NativeElementSnapshot.Number(rect, "x")),
            Convert.ToInt32(NativeElementSnapshot.Number(rect, "y")),
            Convert.ToInt32(NativeElementSnapshot.Number(rect, "width")),
            Convert.ToInt32(NativeElementSnapshot.Number(rect, "height")));
    }

    // This object exists only while evaluating one poll's condition. Returning
    // the separate SDK element prevents snapshot values leaking into a later
    // assertion or action, including after navigation or text entry.
    private sealed class NativeConditionElement(IosSnapshotDriver driver, NativeElementSnapshot snapshot)
        : AppiumElement(driver, snapshot.Id)
    {
        public override string Text => snapshot.Text;
        public override bool Enabled => snapshot.Enabled;
        // Snapshot-backed attributes avoid a second /attribute round-trip per
        // poll; anything not captured falls through to the live endpoint.
        public override string? GetAttribute(string attributeName) =>
            attributeName == "hittable" && snapshot.Hittable is { } hittable
                ? hittable ? "true" : "false"
                : base.GetAttribute(attributeName);
    }

    private sealed class LocatorCapture : ISearchContext, IFindsByFluentSelector<IWebElement>
    {
        public string Mechanism { get; private set; } = string.Empty;
        public string Criteria { get; private set; } = string.Empty;
        public IReadOnlyCollection<IWebElement> FindElements(string selector, string value)
        {
            Mechanism = selector;
            Criteria = value;
            return Array.Empty<IWebElement>();
        }
        public ReadOnlyCollection<IWebElement> FindElements(By by) =>
            new(FindElements(by.Mechanism, by.Criteria).ToList());
        public IWebElement FindElement(By by) => throw new NotSupportedException();
        public IWebElement FindElement(string selector, string value) => throw new NotSupportedException();
    }
}

// Read a live frame in one SDK command instead of separate Location/Size
// requests. No geometry from an earlier lookup is reused for a later touch.
internal sealed class NativeLiveElement(IosSnapshotDriver driver, string id) : AppiumElement(driver, id)
{
    internal Rectangle ReadFrame() => driver.ReadFrame(Id);
}

internal sealed record NativeElementMatch(
    AppiumElement Element, AppiumElement ConditionElement, NativeElementSnapshot Snapshot);

internal readonly record struct NativeElementSnapshot(
    string Id, bool Displayed, double X, double Y, double Width, double Height, string Text, bool Enabled,
    bool? Hittable = null)
{
    internal bool IsVisibleIn(Size window)
    {
        var centerX = X + Width / 2;
        var centerY = Y + Height / 2;
        return Displayed && Width > 0 && Height > 0
            && centerX >= 0 && centerX < window.Width
            && centerY >= 0 && centerY < window.Height;
    }

    internal static IReadOnlyList<NativeElementSnapshot> Decode(object? value)
    {
        if (value is not IEnumerable<object> elements)
            {
                throw new WebDriverException("Native lookup did not return an element array.");
            }
        var result = new List<NativeElementSnapshot>();
        foreach (var entry in elements)
        {
            if (entry is not IDictionary<string, object> element
                || !element.TryGetValue("element-6066-11e4-a52e-4f735466cecf", out var id)
                || id is not string { Length: > 0 } elementId
                || !element.TryGetValue("displayed", out var displayed)
                || displayed is not bool isDisplayed
                || !element.TryGetValue("rect", out var rawRect)
                || rawRect is not IDictionary<string, object> rect
                || !element.TryGetValue("text", out var text)
                || text is not (null or string)
                || !element.TryGetValue("enabled", out var enabled)
                || enabled is not bool isEnabled)
                {
                    throw new WebDriverException("Native lookup is missing its element ID, displayed state, frame, text or enabled state.");
                }
            result.Add(new(elementId, isDisplayed, Number(rect, "x"), Number(rect, "y"),
                Number(rect, "width"), Number(rect, "height"), (string?)text ?? string.Empty, isEnabled,
                element.TryGetValue("hittable", out var hittable) && hittable is bool isHittable
                    ? isHittable : null));
        }
        return result;
    }

    internal static double Number(IDictionary<string, object> rect, string name)
    {
        if (!rect.TryGetValue(name, out var value)
            || value is not (int or long or double or float or decimal))
            {
                throw new WebDriverException($"Native frame has no numeric {name}.");
            }
        var number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
        if (!double.IsFinite(number))
            {
                throw new WebDriverException($"Native frame {name} must be finite.");
            }
        return number;
    }
}
