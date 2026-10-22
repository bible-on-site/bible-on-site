using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class SearchResultPresentationTests
{
    [Fact]
    public void MixedResults_SortByChapterThenVerseWithAuthorsLast()
    {
        SearchResult[] results =
        [
            new AuthorSearchResult(new Author { Id = 1, Name = "רב", Details = "פירוש" }, "שלום"),
            new PerushSearchResult("rashi", "שלום", 2, 10, "שלום"),
            new PasukSearchResult(new Pasuk { PasukNum = 9, Text = "שלום" }, 2, "שלום"),
            new PerekSearchResult(CreatePerek(2), "שלום"),
            new PasukSearchResult(new Pasuk { PasukNum = 20, Text = "שלום" }, 1, "שלום")
        ];

        var ordered = results.OrderBy(result => result.SourceOrder).ToArray();
        ordered.Should().Equal(results[4], results[3], results[2], results[1], results[0]);
        ordered.Select(result => result.Category).Should().Equal("תוכן פסוק", "פרק", "תוכן פסוק", "תוכן פירוש", "רב");
    }

    [Fact]
    public void OnlyAuthorResults_PresentAnAuthorPortrait()
    {
        var author = new Author { Id = 42, Name = "רב", Details = "פירוש" };
        SearchResult[] results =
        [
            new PerekSearchResult(CreatePerek(1), "שלום"),
            new PasukSearchResult(new Pasuk { PasukNum = 1, Text = "שלום" }, 1, "שלום"),
            new PerushSearchResult("rashi", "שלום", 1, 1, "שלום"),
            new AuthorSearchResult(author, "שלום")
        ];

        results.Where(result => result.HasThumbnail).Should().ContainSingle().Which.Should().BeSameAs(results[3]);
        results[3].ThumbnailUrl.Should().Be(author.ImageUrl);
        results.Take(3).Should().OnlyContain(result => result.ThumbnailUrl == null);
    }

    private static Perek CreatePerek(int id) => new()
    {
        PerekId = id, Date = "2026-10-09", HebDate = "תשרי", SeferName = "בראשית",
        SeferTanahUsName = "Genesis", Tseit = "17:30"
    };
}
