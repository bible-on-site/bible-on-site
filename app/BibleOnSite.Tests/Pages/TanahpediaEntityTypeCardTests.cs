using System.Xml.Linq;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// Entity-card accessibility contract (#3252): the card is a tappable only
/// for single-entry entities, and entry chips stay outside it so disabling
/// the card can never disable the chips. Multi-entry and unlinked cards
/// must not surface dead focus stops to keyboard/UIA users.
/// </summary>
public class TanahpediaEntityTypeCardTests
{
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";
    private static readonly XNamespace Controls = "clr-namespace:BibleOnSite.Controls";
    private static readonly XDocument Page = XDocument.Load(
        Path.Join(FindAppRoot(), "Pages", "TanahpediaEntityTypePage.xaml"));

    [Fact]
    public void Card_tappable_is_enabled_only_for_single_entry_entities()
    {
        var card = Page.Descendants(Controls + "TappableView")
            .Single(e => ((string?)e.Attribute("CommandParameter"))?.Contains("SingleUniqueName") == true);
        ((string?)card.Attribute("IsEnabled")).Should().Be("{Binding IsSingleLink}",
            "entities without a single entry would otherwise be focusable buttons that open nothing");
    }

    [Fact]
    public void Entry_chips_are_not_nested_inside_the_card_tappable()
    {
        var card = Page.Descendants(Controls + "TappableView")
            .Single(e => ((string?)e.Attribute("CommandParameter"))?.Contains("SingleUniqueName") == true);
        card.Descendants(Controls + "TappableView").Should().BeEmpty(
            "a chip nested in the card's WinUI Button would fire both buttons and inherit its disabled state");
        Page.Descendants(Controls + "TappableView")
            .Count(e => (string?)e.Attribute("CommandParameter") == "{Binding UniqueName}")
            .Should().Be(1, "entry chips remain independently invokable tappables");
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

        throw new DirectoryNotFoundException("Could not locate the BibleOnSite project root from the test output directory.");
    }
}
