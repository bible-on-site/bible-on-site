using System.Drawing;
using System.Globalization;
using System.Xml;
using System.Xml.Linq;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;

namespace BibleOnSite.Tests.MobileE2E.Pages;

// Read-only calendar assertions share one fresh tree. WDA's findElements
// response enriches each match separately; dense mini-months repeatedly walk
// the same accessibility tree before the client receives any of the labels.
// A source request traverses one root snapshot, including native visibility.
// This never supplies handles for taps or changes the global diagnostic source.
internal sealed class CalendarSnapshot(IReadOnlyDictionary<string, CalendarSnapshot.CalendarLabel[]> labels, Size viewport)
{
    internal sealed record CalendarLabel(string Text, double X, double Y, double Width, double Height)
    {
        internal (Point Location, Size Size) Frame =>
            (new Point(Convert.ToInt32(X), Convert.ToInt32(Y)), new Size(Convert.ToInt32(Width), Convert.ToInt32(Height)));
        internal bool IsInside(Size window) => Width > 0 && Height > 0
            && X + Width / 2 >= 0 && X + Width / 2 < window.Width
            && Y + Height / 2 >= 0 && Y + Height / 2 < window.Height;
    }

    internal IReadOnlyList<CalendarLabel> Rendered(string id) => labels[id];
    internal CalendarLabel FirstInViewport(string id) => labels[id].First(label => label.IsInside(viewport));
    internal bool IsReady => labels.Values.All(matches => matches.Any(label => label.IsInside(viewport)));

    internal static CalendarSnapshot WaitFor(AppiumDriver driver, MobilePlatformAdapter platform, params string[] ids)
    {
        var timeout = TimeSpan.FromSeconds(45);
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var snapshot = Capture(driver, platform, ids);
                if (snapshot.IsReady) { return snapshot; }
            }
            catch (StaleElementReferenceException) { }
            catch (WebDriverTimeoutException exception) when (!DeviceSessionDeath.Matches(exception)) { }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"Calendar labels {string.Join(", ", ids)} did not render within {timeout.TotalSeconds} seconds.");
    }

    internal static CalendarSnapshot Capture(AppiumDriver driver, MobilePlatformAdapter platform, params string[] ids)
    {
        if (driver is IosSnapshotDriver)
        {
            // Record the same exact automation IDs in scenario coverage even
            // though this read does not issue an individual locator command.
            foreach (var id in ids) { platform.AutomationId(id); }
            var xml = driver.ExecuteScript("mobile: source", new Dictionary<string, object>
            {
                ["format"] = "xml",
                ["excludedAttributes"] = "accessible"
            }) as string ?? throw new WebDriverException("Calendar source response is not XML text.");
            return Parse(xml, DriverTelemetry.WindowSize(driver), ids);
        }
        var page = new PerekPage(driver, platform);
        var result = ids.ToDictionary(id => id, id => page.RenderedElements(id,
                element => id == "MiniMonthDayText" ? platform.SemanticDescription(element) ?? string.Empty : element.Text)
            .Select(match => new CalendarLabel(match.Text, match.Frame.Location.X, match.Frame.Location.Y,
                match.Frame.Size.Width, match.Frame.Size.Height)).ToArray(), StringComparer.Ordinal);
        return new CalendarSnapshot(result, DriverTelemetry.WindowSize(driver));
    }

    internal static CalendarSnapshot Parse(string xml, Size viewport, params string[] ids)
    {
        using var text = new StringReader(xml);
        using var reader = XmlReader.Create(text, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null
        });
        var document = XDocument.Load(reader);
        var result = ids.ToDictionary(id => id, _ => new List<CalendarLabel>(), StringComparer.Ordinal);
        foreach (var node in document.Descendants())
        {
            var id = (string?)node.Attribute("name");
            if (id is null || !result.TryGetValue(id, out var matches)) { continue; }
            var visible = (string?)node.Attribute("visible") switch
            {
                "true" or "1" => true,
                "false" or "0" => false,
                _ => throw new WebDriverException($"Calendar label {id} has no valid native visibility.")
            };
            if (!visible) { continue; }
            var value = (string?)node.Attribute("value");
            var label = string.IsNullOrEmpty(value) ? (string?)node.Attribute("label") : value;
            if (label is null) { throw new WebDriverException($"Calendar label {id} has no text."); }
            matches.Add(new CalendarLabel(label.Trim(), Coordinate(node, "x"), Coordinate(node, "y"),
                Coordinate(node, "width"), Coordinate(node, "height")));
        }
        return new CalendarSnapshot(result.ToDictionary(pair => pair.Key, pair => pair.Value.ToArray(), StringComparer.Ordinal), viewport);
    }

    private static double Coordinate(XElement node, string attribute)
    {
        if (!double.TryParse((string?)node.Attribute(attribute), NumberStyles.Float, CultureInfo.InvariantCulture, out var value)
            || !double.IsFinite(value) || value < int.MinValue || value > int.MaxValue
            || (attribute is "width" or "height" && value < 0))
        {
            throw new WebDriverException($"Calendar source contains an invalid {attribute}.");
        }
        return value;
    }
}
