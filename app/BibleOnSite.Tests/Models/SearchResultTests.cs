using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class SearchFilterTests
{
    [Fact]
    public void SearchFilter_Author_ShouldBeZero()
    {
        ((int)SearchFilter.Author).Should().Be(0);
    }

    [Fact]
    public void SearchFilter_Pasuk_ShouldBeOne()
    {
        ((int)SearchFilter.Pasuk).Should().Be(1);
    }

    [Fact]
    public void SearchFilter_Perush_ShouldBeTwo()
    {
        ((int)SearchFilter.Perush).Should().Be(2);
    }

    [Fact]
    public void SearchFilter_Perek_ShouldBeThree()
    {
        ((int)SearchFilter.Perek).Should().Be(3);
    }

    [Theory]
    [InlineData(SearchFilter.Author, "רב")]
    [InlineData(SearchFilter.Pasuk, "תוכן פסוק")]
    [InlineData(SearchFilter.Perush, "תוכן פירוש")]
    [InlineData(SearchFilter.Perek, "פרק")]
    public void GetHebrewName_ShouldReturnCorrectName(SearchFilter filter, string expected)
    {
        filter.GetHebrewName().Should().Be(expected);
    }
}

public class AuthorSearchResultTests
{
    [Fact]
    public void ResultType_ShouldBeAuthor()
    {
        var author = new Author { Id = 1, Name = "Test", Details = "Test" };
        var result = new AuthorSearchResult(author, "search");

        result.ResultType.Should().Be(SearchFilter.Author);
    }

    [Fact]
    public void SearchPhrase_ShouldBeStored()
    {
        var author = new Author { Id = 1, Name = "Test", Details = "Test" };
        var result = new AuthorSearchResult(author, "הרב כהנא");

        result.SearchPhrase.Should().Be("הרב כהנא");
    }

    [Fact]
    public void Author_ShouldBeStored()
    {
        var author = new Author { Id = 42, Name = "הרב משה", Details = "פוסק" };
        var result = new AuthorSearchResult(author, "search");

        result.Author.Should().BeSameAs(author);
        result.Author.Id.Should().Be(42);
    }
}

public class PerekSearchResultTests
{
    [Fact]
    public void ResultType_ShouldBePerek()
    {
        var perek = CreatePerek();
        var result = new PerekSearchResult(perek, "search");

        result.ResultType.Should().Be(SearchFilter.Perek);
    }

    [Fact]
    public void Perek_ShouldBeStored()
    {
        var perek = CreatePerek();
        var result = new PerekSearchResult(perek, "search");

        result.Perek.Should().BeSameAs(perek);
    }

    [Fact]
    public void SearchPhrase_ShouldBeStored()
    {
        var perek = CreatePerek();
        var result = new PerekSearchResult(perek, "בראשית");

        result.SearchPhrase.Should().Be("בראשית");
    }

    private static Perek CreatePerek() => new()
    {
        PerekId = 1,
        Date = "2026-01-20",
        HebDate = "טבת",
        SeferName = "בראשית",
        SeferTanahUsName = "Genesis",
        Tseit = "17:30"
    };
}

public class PasukSearchResultTests
{
    [Fact]
    public void ResultType_ShouldBePasuk()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "בראשית ברא" };
        var result = new PasukSearchResult(pasuk, 1, "search");

        result.ResultType.Should().Be(SearchFilter.Pasuk);
    }

    [Fact]
    public void Pasuk_ShouldBeStored()
    {
        var pasuk = new Pasuk { PasukNum = 5, Text = "Test text" };
        var result = new PasukSearchResult(pasuk, 10, "search");

        result.Pasuk.Should().BeSameAs(pasuk);
        result.Pasuk.PasukNum.Should().Be(5);
    }

    [Fact]
    public void PerekId_ShouldBeStored()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "Test" };
        var result = new PasukSearchResult(pasuk, 42, "search");

        result.PerekId.Should().Be(42);
    }

    [Fact]
    public void HighlightedResult_WithMatchingPhrase_ShouldContainBoldTags()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "בראשית ברא אלהים את השמים ואת הארץ" };
        var result = new PasukSearchResult(pasuk, 1, "אלהים");

        result.HighlightedResult.Should().Contain("<b>אלהים</b>");
    }

    [Fact]
    public void HighlightedResult_WithNoMatch_ShouldNotContainBoldTags()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "בראשית ברא אלהים" };
        var result = new PasukSearchResult(pasuk, 1, "notfound");

        result.HighlightedResult.Should().NotContain("<b>");
    }

    [Fact]
    public void HighlightedResult_WithLongText_ShouldBeTruncated()
    {
        var longText = new string('א', 200);
        var pasuk = new Pasuk { PasukNum = 1, Text = longText };
        var result = new PasukSearchResult(pasuk, 1, "notfound");

        result.HighlightedResult.Should().EndWith("...");
        result.HighlightedResult.Length.Should().BeLessThan(longText.Length);
    }

    [Fact]
    public void HighlightedResult_WithEmptySearchPhrase_ShouldReturnTruncatedText()
    {
        var pasuk = new Pasuk { PasukNum = 1, Text = "Short text" };
        var result = new PasukSearchResult(pasuk, 1, "");

        result.HighlightedResult.Should().Be("Short text");
    }
}

public class PerushSearchResultTests
{
    [Fact]
    public void ResultType_ShouldBePerush()
    {
        var result = new PerushSearchResult("perush-1", "Content", 1, 1, "search");

        result.ResultType.Should().Be(SearchFilter.Perush);
    }

    [Fact]
    public void Properties_ShouldBeStored()
    {
        var result = new PerushSearchResult("perush-42", "הפירוש לפסוק", 10, 5, "פירוש");

        result.PerushId.Should().Be("perush-42");
        result.NoteContent.Should().Be("הפירוש לפסוק");
        result.PerekId.Should().Be(10);
        result.PasukNum.Should().Be(5);
        result.SearchPhrase.Should().Be("פירוש");
    }

    [Fact]
    public void HighlightedResult_WithMatchingPhrase_ShouldContainBoldTags()
    {
        var result = new PerushSearchResult("id", "זהו פירוש על הפסוק", 1, 1, "פירוש");

        result.HighlightedResult.Should().Contain("<b>פירוש</b>");
    }

    [Fact]
    public void HighlightedResult_WithNoMatch_ShouldNotContainBoldTags()
    {
        var result = new PerushSearchResult("id", "זהו תוכן הפירוש", 1, 1, "notfound");

        result.HighlightedResult.Should().NotContain("<b>");
    }
}
