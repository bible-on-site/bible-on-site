using System.Globalization;
using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #2474: in the focused-pasuk reader the vertical scroll indicator must sit
/// in its own outer gutter, closer to the screen edge than the text column.
/// The indicator hugs the CollectionView's outer edge, so the view's outer
/// margin must be smaller than the horizontal padding applied to its content.
/// </summary>
public class FocusedPasukOverlayLayoutTests
{
    private static readonly string AppRoot = FindAppRoot();

    [Fact]
    public void FocusedPerushim_keeps_scrollbar_in_outer_gutter_clear_of_text()
    {
        XNamespace p = "http://schemas.microsoft.com/dotnet/2021/maui";
        var doc = XDocument.Load(Path.Join(AppRoot, "Controls", "FocusedPasukOverlay.xaml"));

        var collection = doc.Descendants(p + "CollectionView")
            .First(e => (string?)e.Attribute("AutomationId") == "FocusedPerushimCollection");

        var margin = ParseThickness((string?)collection.Attribute("Margin"));

        var header = collection.Element(p + "CollectionView.Header")!
            .Descendants(p + "VerticalStackLayout").First();
        var headerPadding = ParseThickness((string?)header.Attribute("Padding"));

        var item = collection.Element(p + "CollectionView.ItemTemplate")!
            .Descendants(p + "VerticalStackLayout").First();
        var itemPadding = ParseThickness((string?)item.Attribute("Padding"));

        margin.Left.Should().BeLessThan(headerPadding.Left,
            "the scroll indicator needs an outer gutter outside the text column");
        margin.Left.Should().BeLessThan(itemPadding.Left,
            "the scroll indicator needs an outer gutter outside the perushim rows");
        (margin.Left + headerPadding.Left).Should().BeGreaterThanOrEqualTo(20,
            "the pasuk/commentary text keeps its readable inset");
        (margin.Left + itemPadding.Left).Should().BeGreaterThanOrEqualTo(20,
            "the pasuk/commentary text keeps its readable inset");
    }

    private static (double Left, double Top, double Right, double Bottom) ParseThickness(string? value)
    {
        value.Should().NotBeNullOrWhiteSpace();
        var parts = value!.Split(',')
            .Select(s => double.Parse(s.Trim(), CultureInfo.InvariantCulture))
            .ToArray();
        return parts.Length switch
        {
            1 => (parts[0], parts[0], parts[0], parts[0]),
            2 => (parts[0], parts[1], parts[0], parts[1]),
            4 => (parts[0], parts[1], parts[2], parts[3]),
            _ => throw new InvalidOperationException($"Unexpected thickness '{value}'"),
        };
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
