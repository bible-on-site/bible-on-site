using System.Xml.Linq;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// The perek reader's לקריאה נוספת grouping (#3752): the articles strip is a
/// grouped CollectionView whose first (untitled) group keeps the perek's own
/// list and whose titled group carries the secondary-coverage
/// recommendations. A group only renders when it has items — a perek with no
/// articles of its own still shows its recommendations, and a perek with no
/// recommendations keeps the flat untitled look.
/// </summary>
public class FurtherReadingGroupingTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Controls = "clr-namespace:BibleOnSite.Controls";

    private static Article Article(int id, int perekId = 1) =>
        new() { Id = id, PerekId = perekId, Name = $"a{id}", Abstract = "", AuthorId = 1 };

    [Fact]
    public void Both_lists_produce_an_untitled_primary_group_then_a_titled_further_group()
    {
        var groups = ArticleListGroup.Build(
            [Article(1), Article(2)],
            [Article(9, 8)]);

        groups.Should().HaveCount(2);
        groups[0].Title.Should().BeEmpty("the perek's own list keeps today's flat look");
        groups[0].Select(a => a.Id).Should().Equal(1, 2);
        groups[1].Title.Should().Be("לקריאה נוספת");
        groups[1].Select(a => a.Id).Should().Equal(9);
    }

    [Fact]
    public void A_perek_with_only_recommendations_still_shows_the_titled_group()
    {
        var groups = ArticleListGroup.Build([], [Article(9, 8), Article(10, 4)]);

        groups.Should().ContainSingle();
        groups[0].Title.Should().Be("לקריאה נוספת");
        groups[0].Select(a => a.Id).Should().Equal(9, 10);
    }

    [Fact]
    public void No_recommendations_leave_one_untitled_group()
    {
        var groups = ArticleListGroup.Build([Article(1)], []);

        groups.Should().ContainSingle();
        groups[0].Title.Should().BeEmpty();
    }

    [Fact]
    public void No_articles_at_all_hide_every_group()
    {
        ArticleListGroup.Build([], []).Should().BeEmpty();
    }

    [Fact]
    public void Perek_page_enables_grouping_on_the_shared_articles_view()
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", "PerekPage.xaml"));

        var isGrouped = doc.Descendants(Controls + "ReaderArticlesView").Single()
            .Attribute("IsGrouped");
        isGrouped.Should().NotBeNull(
            "the perek reader must mark its articles strip grouped — the לקריאה נוספת header only renders under grouping");
        isGrouped!.Value.Should().Be("True",
            "the perek reader groups its articles strip so לקריאה נוספת renders below the perek's own list");
    }

    [Fact]
    public void The_articles_view_declares_a_title_bound_group_header()
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Controls", "ReaderArticlesView.xaml"));

        // The template lives in Resources and is applied from code-behind only
        // while a grouped, non-empty source exists: iOS emits a group
        // supplementary view whenever the template property is set, and
        // EmptySource.Group throws IndexOutOfRangeException on an empty list —
        // crashing the reader's layout pass on first render.
        var xaml = XNamespace.Get("http://schemas.microsoft.com/winfx/2009/xaml");
        var template = doc.Descendants().Single(e =>
            e.Name.LocalName == "DataTemplate"
            && e.Attribute(xaml + "Key")?.Value == "ArticleGroupHeaderTemplate");
        template.Descendants().Any(e =>
                e.Attribute("Text")?.Value.Contains("Title") == true)
            .Should().BeTrue("the section label binds ArticleListGroup.Title — the untitled group collapses it");
    }

    [Fact]
    public void Group_header_policy_clears_the_template_when_the_source_empties()
    {
        BibleOnSite.Controls.ReaderArticlesView
            .ServesGroupHeaders(true, ArticleListGroup.Build([Article(1)], []))
            .Should().BeTrue("a grouped, populated source serves section headers");

        BibleOnSite.Controls.ReaderArticlesView
            .ServesGroupHeaders(true, ArticleListGroup.Build([], []))
            .Should().BeFalse(
                "an empty source must drop the template — iOS resolves a supplementary view whenever the property is set and EmptySource.Group throws");

        BibleOnSite.Controls.ReaderArticlesView
            .ServesGroupHeaders(false, ArticleListGroup.Build([Article(1)], []))
            .Should().BeFalse("a flat source never serves section headers");
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
