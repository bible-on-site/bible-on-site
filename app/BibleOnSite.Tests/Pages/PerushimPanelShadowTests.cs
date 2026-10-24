using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #2574: the perushim sheet must not paint an extra opaque rectangle around its
/// edges — most visibly the band it lays over the bottom toolbar. Border.Shadow on
/// Android routes the panel through PlatformWrapperView, which renders the shadow
/// via a pooled bitmap whose uncleared padding ring surfaces as a stale white
/// rectangle. The sheet keeps its rounded fill + stroke on the Border and gets its
/// top-edge shadow from a bound PerushimPanelShadow strip instead.
/// </summary>
public class PerushimPanelShadowTests
{
    private static readonly string AppRoot = FindAppRoot();

    private static readonly string[] ReaderPages =
    [
        "PerekPage.xaml",
        "ParashaPage.xaml",
        "MasoraPage.xaml",
    ];

    public static TheoryData<string> Pages => new(ReaderPages);

    [Theory]
    [MemberData(nameof(Pages))]
    public void PerushimPanel_does_not_declare_a_shadow(string pageFile)
    {
        XNamespace p = "http://schemas.microsoft.com/dotnet/2021/maui";
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageFile));

        var panel = doc.Descendants(p + "Border")
            .First(e => (string?)e.Attribute("{http://schemas.microsoft.com/winfx/2009/xaml}Name") == "PerushimPanel");

        panel.Element(p + "Border.Shadow").Should().BeNull(
            "Border.Shadow is the layer that painted the rectangle artifact on Android");
    }

    [Theory]
    [MemberData(nameof(Pages))]
    public void PerushimPanel_keeps_its_rounded_stroke_edge(string pageFile)
    {
        XNamespace p = "http://schemas.microsoft.com/dotnet/2021/maui";
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageFile));

        var panel = doc.Descendants(p + "Border")
            .First(e => (string?)e.Attribute("{http://schemas.microsoft.com/winfx/2009/xaml}Name") == "PerushimPanel");

        ((string?)panel.Attribute("StrokeShape")).Should().Contain("RoundRectangle",
            "the sheet still needs its rounded top corners");
        panel.Attribute("Stroke").Should().NotBeNull("the sheet keeps its border edge");
        ((string?)panel.Attribute("StrokeThickness")).Should().Be("1");
    }

    [Theory]
    [MemberData(nameof(Pages))]
    public void PerushimPanel_empty_state_actions_live_in_the_header_not_the_list(string pageFile)
    {
        XNamespace p = "http://schemas.microsoft.com/dotnet/2021/maui";
        XNamespace x = "http://schemas.microsoft.com/winfx/2009/xaml";
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageFile));

        var panel = doc.Descendants(p + "Border")
            .First(e => (string?)e.Attribute(x + "Name") == "PerushimPanel");

        var emptyView = panel.Descendants(p + "CollectionView.EmptyView").First();
        var header = panel.Descendants(p + "VerticalStackLayout")
            .First(e => (string?)e.Attribute(x + "Name") == "PerushimDragHandle");

        // The sheet's list row is bounded above BottomBar; a taller EmptyView
        // painted past its bounds into the bar's opaque zone — the white
        // rectangle that covered the download/export buttons. Action buttons
        // belong in the always-visible header row, and the empty view keeps a
        // scroll-bounded emoji + message that can never overflow under the bar.
        emptyView.Elements().First().Name.LocalName.Should().Be("ScrollView",
            "the empty state must be clipped to the list bounds so it never paints under the nav bar");
        emptyView.Descendants(p + "Button").Should().BeEmpty(
            "action buttons inside EmptyView paint under the bottom nav bar on short detents");
        header.Descendants(p + "Button")
            .Select(b => (string?)b.Attribute(x + "Name"))
            .Should().Contain("GoToPerushimSettingsButton",
                "the download action must stay visible regardless of sheet height");
    }

    [Theory]
    [MemberData(nameof(Pages))]
    public void PerushimPanelShadow_strip_tracks_the_sheet_transforms(string pageFile)
    {
        XNamespace p = "http://schemas.microsoft.com/dotnet/2021/maui";
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageFile));

        var strip = doc.Descendants(p + "BoxView")
            .First(e => (string?)e.Attribute("{http://schemas.microsoft.com/winfx/2009/xaml}Name") == "PerushimPanelShadow");

        ((string?)strip.Attribute("InputTransparent")).Should().Be("True",
            "the shadow strip must never block input to the reader");
        ((string?)strip.Attribute("ZIndex")).Should().Be("49",
            "the strip renders just under the sheet and above the content");

        var translation = strip.Element(p + "BoxView.TranslationY")
            ?.Element(p + "MultiBinding")
            ?? throw new Xunit.Sdk.XunitException(
                "the strip must follow the sheet's slide/drag transforms");

        var paths = translation.Elements(p + "Binding")
            .Select(b => (string?)b.Attribute("Path"))
            .ToArray();
        paths.Should().BeEquivalentTo(["TranslationY", "HeightRequest"],
            "the offset combines the slide translation and the sheet height");

        ((string?)strip.Attribute("IsVisible")).Should().Contain("IsVisible",
            "the strip hides whenever the sheet is hidden");
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
