using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>Guards the shared reader sheet against the painted-cover and empty-view regressions.</summary>
public class PerushimPanelShadowTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";
    private static XDocument Sheet => XDocument.Load(Path.Join(AppRoot, "Controls", "PerushimSheet.xaml"));

    [Theory]
    [InlineData("PerekPage.xaml")]
    [InlineData("ParashaPage.xaml")]
    [InlineData("MasoraPage.xaml")]
    public void Reader_uses_the_shared_sheet(string pageFile)
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageFile));
        XNamespace controls = "clr-namespace:BibleOnSite.Controls";
        doc.Descendants(controls + "PerushimSheet").Should().ContainSingle();
    }

    [Fact]
    public void Sheet_does_not_use_the_native_shadow_wrapper()
    {
        Sheet.Root!.Element(Maui + "Border.Shadow").Should().BeNull();
        ((string?)Sheet.Root.Attribute("StrokeShape")).Should().Contain("RoundRectangle");
        ((string?)Sheet.Root.Attribute("StrokeThickness")).Should().Be("1");
    }

    [Fact]
    public void Entire_content_viewport_reserves_the_bottom_bar()
    {
        var viewport = Sheet.Root!.Element(Maui + "Grid")!;
        ((string?)viewport.Attribute("Margin")).Should().Be("0,0,0,90");
        ((string?)viewport.Attribute("IsClippedToBounds")).Should().Be("True");
    }

    [Fact]
    public void Empty_content_uses_a_separate_scroll_host_without_a_scroll_indicator()
    {
        var doc = Sheet;
        doc.Descendants(Maui + "CollectionView.EmptyView").Should().BeEmpty();
        var empty = doc.Descendants(Maui + "ScrollView").Single();
        ((string?)empty.Attribute("VerticalScrollBarVisibility")).Should().Be("Never");
        empty.Descendants(Maui + "Button").Should().HaveCount(2,
            "download and support actions stay inside the same bounded empty-content host");
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
