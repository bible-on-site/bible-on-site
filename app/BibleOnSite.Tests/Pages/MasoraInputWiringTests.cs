using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #2721: the masora reader shares <c>ReaderFanMenu</c> with the other
/// readers, so a dead title or satellite tap can only come from page-level
/// wiring - a missing handler, a satellite left out of the fan, or a
/// hidden overlay stacked above the interactive layers. These guards pin
/// that contract so the regression cannot come back silently.
/// </summary>
public class MasoraInputWiringTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";
    private static readonly XNamespace Controls = "clr-namespace:BibleOnSite.Controls";
    private static readonly XNamespace X = "http://schemas.microsoft.com/winfx/2009/xaml";

    private static XDocument Page => XDocument.Load(Path.Join(AppRoot, "Pages", "MasoraPage.xaml"));

    private static XElement NamedElement(XDocument doc, string name) =>
        doc.Descendants().Single(e => (string?)e.Attribute(X + "Name") == name);

    private static int ZIndexOf(XDocument doc, string name) =>
        int.Parse((string?)NamedElement(doc, name).Attribute("ZIndex") ?? "0");

    [Fact]
    public void TitleButton_OpensTheUnitPicker()
    {
        var doc = Page;
        var title = doc.Descendants()
            .Single(e => (string?)e.Attribute("AutomationId") == "MasoraSource");

        ((string?)title.Attribute("Clicked")).Should().Be("OnUnitSourceClicked",
            "the title pill must fire the handler that opens the unit picker");
        ((string?)title.Attribute("SemanticProperties.Hint")).Should().NotBeNullOrEmpty(
            "the title keeps its accessible picker hint");

        // The title must live inside the top bar - an element drifting into
        // the content grid could be covered by reader overlays.
        title.Ancestors(Controls + "SharedTopBar").Should().ContainSingle(
            "MasoraSource belongs inside SharedTopBar like the other readers' titles");
    }

    [Fact]
    public void UnitPickerSatellite_IsAWiredFanSatellite()
    {
        var doc = Page;
        var satellite = doc.Descendants(Controls + "ReaderFanMenuSatellite")
            .Single(e => (string?)e.Attribute("AutomationId") == "UnitPickerButton");

        ((string?)satellite.Attribute("Clicked")).Should().Be("OnUnitPickerClicked",
            "the satellite must fire the handler that opens the unit picker");
        satellite.Ancestors(Controls + "ReaderFanMenu.Satellites").Should().ContainSingle(
            "only satellites inside the fan's Satellites collection get positioned and enabled on open");
    }

    [Theory]
    [InlineData("PrevUnitButton", "LoadPreviousCommand")]
    [InlineData("NextUnitButton", "LoadNextCommand")]
    public void NavigationSatellites_CloseTheFanThroughTheSharedHandler(string automationId, string command)
    {
        var doc = Page;
        var satellite = doc.Descendants(Controls + "ReaderFanMenuSatellite")
            .Single(e => (string?)e.Attribute("AutomationId") == automationId);

        ((string?)satellite.Attribute("Command")).Should().Contain(command);
        ((string?)satellite.Attribute("Clicked")).Should().Be("OnMenuItemClicked",
            "activation closes the fan like the sibling readers' satellites");
    }

    [Fact]
    public void InteractiveLayers_StayAboveEveryHiddenOverlay()
    {
        var doc = Page;

        // The fan must sit above the always-on chrome so satellites and the
        // scrim receive touches; the picker sits above the fan so its card
        // wins once shown. Anything invisible above the fan would swallow
        // satellite taps without ever becoming visible.
        ZIndexOf(doc, "FanMenu").Should().BeGreaterThan(ZIndexOf(doc, "BottomBar"),
            "fan satellites draw and hit-test above the bottom bar");
        ZIndexOf(doc, "FanMenu").Should().BeGreaterThan(ZIndexOf(doc, "PerushimPanel"),
            "the collapsed perushim sheet can never sit over the fan");
        ZIndexOf(doc, "FanMenu").Should().BeGreaterThan(ZIndexOf(doc, "CarouselLoadingOverlay"),
            "the loading overlay can never sit over the fan");
        ZIndexOf(doc, "MasoraUnitPickerPopup").Should().BeGreaterThan(ZIndexOf(doc, "FanMenu"),
            "the unit picker lands above the fan when it opens");
    }

    [Fact]
    public void PickerPopup_StartsHiddenSoItCannotInterceptInput()
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Controls", "MasoraUnitPickerPopup.xaml"));
        ((string?)doc.Root!.Attribute("IsVisible"))
            .Should().Be("False",
                "a visible-but-transparent popup at the top of the z-order would swallow every reader tap");
    }

    [Fact]
    public void BothEntryPoints_RouteToTheSamePicker()
    {
        var source = File.ReadAllText(Path.Join(AppRoot, "Pages", "MasoraPage.xaml.cs"));

        var titleHandler = BodyOf(source, "OnUnitSourceClicked");
        var satelliteHandler = BodyOf(source, "OnUnitPickerClicked");
        titleHandler.Should().Contain("MasoraUnitPickerPopup.Show(",
            "the title tap opens the unit picker");
        satelliteHandler.Should().Contain("MasoraUnitPickerPopup.Show(",
            "the satellite tap opens the unit picker");
    }

    [Fact]
    public void MasoraReader_KeepsTheSharedFanBottomInsetParity()
    {
        // #2721: the other readers pad the fan above the home-indicator inset
        // so satellite layout bounds match the rendered positions. Masora
        // skipped the call, leaving satellites laid out against the shifted
        // canvas - the bounds-vs-render mismatch behind the dead taps.
        var source = File.ReadAllText(Path.Join(AppRoot, "Pages", "MasoraPage.xaml.cs"));
        source.Should().Contain("ReaderSafeArea.Configure(MainGrid)",
            "the reader grid opts out of per-layout safe-area padding like the sibling readers");
        source.Should().Contain("FanMenu.SetBottomInset(",
            "the fan geometry must clear the same bottom inset the bottom bar covers");
    }

    /// <summary>Returns the statements of a handler for targeted assertions.</summary>
    private static string BodyOf(string source, string methodName)
    {
        var start = source.IndexOf(methodName + "(", StringComparison.Ordinal);
        start.Should().BeGreaterThan(-1, $"handler {methodName} must exist");
        var brace = source.IndexOf('{', start);
        var depth = 0;
        for (var i = brace; i < source.Length; i++)
        {
            if (source[i] == '{')
            {
                depth++;
            }
            else if (source[i] == '}' && --depth == 0)
            {
                return source.Substring(brace, i - brace + 1);
            }
        }
        return source[brace..];
    }

    private static string FindAppRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Join(dir, "BibleOnSite");
            if (Directory.Exists(candidate) && File.Exists(Path.Join(candidate, "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var siblingCandidate = Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite");
            if (Directory.Exists(siblingCandidate) && File.Exists(Path.Join(siblingCandidate, "BibleOnSite.csproj")))
            {
                return siblingCandidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException(
            "Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
    }
}
