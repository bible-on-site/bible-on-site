using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// The perushim picker's name search filters the visible rows in place
/// (#3306): typing narrows the bound collection instead of scrolling a
/// complete list to the first match, and a name-search miss surfaces the
/// sheet's empty state rather than the missing-package one. These contracts
/// pin the visible-collection bindings so a full-list regression fails here
/// even when the first row would already match.
/// </summary>
public class PerushimSheetFilterTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Maui = "http://schemas.microsoft.com/dotnet/2021/maui";
    private static readonly XNamespace Controls = "clr-namespace:BibleOnSite.Controls";
    private static readonly XNamespace Xaml = "http://schemas.microsoft.com/winfx/2009/xaml";
    private static XDocument Sheet => XDocument.Load(Path.Join(AppRoot, "Controls", "PerushimSheet.xaml"));

    private static XElement PerushimCollection =>
        Sheet.Descendants(Maui + "CollectionView")
            .Single(view => (string?)view.Attribute(Xaml + "Name") == "PerushimCollection");

    [Fact]
    public void Picker_rows_bind_the_name_filtered_collection_not_the_full_list()
    {
        // The reported case: typing אונקלוס must leave unrelated commentaries
        // off the rows — only a FilteredPerushim binding produces that.
        ((string?)PerushimCollection.Attribute("ItemsSource"))
            .Should().Be("{Binding FilteredPerushim}",
                "the visible picker rows must narrow as the search text is typed");
    }

    [Fact]
    public void A_filter_miss_shows_the_empty_state_instead_of_rows()
    {
        // Visibility keys on the filtered count so a non-matching query hides
        // the list — Perushim.Count stays positive while the user searches.
        PerushimCollection.Element(Maui + "CollectionView.Triggers")!
            .Descendants(Maui + "DataTrigger").Single()
            .Attribute("Binding")!.Value.Should().Be("{Binding FilteredPerushim.Count}");

        var empty = Sheet.Descendants(Maui + "ScrollView")
            .Single(view => (string?)view.Attribute(Xaml + "Name") == "PerushimEmptyState");
        ((string?)empty.Attribute("IsVisible"))
            .Should().Be("{Binding FilteredPerushim.Count, Converter={StaticResource ZeroToTrueConverter}}",
                "a name-search miss must surface the empty state, not painted rows");
    }

    [Fact]
    public void The_search_bar_survives_a_filter_miss()
    {
        // The search affordance keys on the complete list: filtering to zero
        // must leave the input visible so the query can be edited or cleared.
        var searchBar = Sheet.Descendants(Controls + "RtlSearchBar").Single();
        var searchStack = searchBar.Ancestors(Maui + "VerticalStackLayout")
            .First(stack => stack.Element(Maui + "VerticalStackLayout.Triggers") != null);
        var trigger = searchStack.Element(Maui + "VerticalStackLayout.Triggers")!
            .Descendants(Maui + "DataTrigger").Single();
        trigger.Attribute("Binding")!.Value.Should().Be("{Binding Perushim.Count}",
            "the search input hides only when the perek has no perushim at all");
    }

    [Fact]
    public void The_search_entry_still_drives_the_name_filter()
    {
        var searchBar = Sheet.Descendants(Controls + "RtlSearchBar").Single();
        ((string?)searchBar.Attribute("Text")).Should().Be("{Binding PerushNameFilter}");
    }

    [Fact]
    public void The_code_behind_no_longer_scrolls_a_complete_list_on_search()
    {
        // Filtering replaced scroll-to-match: no property-change subscription
        // or ScrollTo may creep back beside the filtered binding.
        var code = File.ReadAllText(Path.Join(AppRoot, "Controls", "PerushimSheet.xaml.cs"));
        code.Should().NotContain("ScrollTo(",
            "the picker filters rows in place — it must not keep the jump-to-match behavior");
        code.Should().NotContain("OnViewModelPropertyChanged",
            "the sheet no longer reacts to PerushNameFilter outside the collection binding");
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
