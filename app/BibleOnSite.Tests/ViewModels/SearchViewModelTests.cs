using BibleOnSite.Models;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

public class SearchViewModelTests
{
    #region Search Phrase Tests

    [Fact]
    public void OptimizedSearchPhrase_WhenEmpty_ShouldReturnAll()
    {
        var viewModel = new SearchViewModel();
        viewModel.SearchPhrase = "";

        viewModel.OptimizedSearchPhrase.Should().Be("*");
    }

    [Fact]
    public void OptimizedSearchPhrase_WhenWhitespace_ShouldReturnAll()
    {
        var viewModel = new SearchViewModel();
        viewModel.SearchPhrase = "   ";

        viewModel.OptimizedSearchPhrase.Should().Be("*");
    }

    [Fact]
    public void OptimizedSearchPhrase_ShouldTrimWhitespace()
    {
        var viewModel = new SearchViewModel();
        viewModel.SearchPhrase = "  משה  ";

        viewModel.OptimizedSearchPhrase.Should().Be("משה");
    }

    [Fact]
    public void OptimizedSearchPhrase_ShouldRemoveHaravPrefix()
    {
        var viewModel = new SearchViewModel();
        viewModel.SearchPhrase = "הרב משה";

        viewModel.OptimizedSearchPhrase.Should().Be("משה");
    }

    #endregion

    #region Search Filter Tests

    [Fact]
    public void SearchFilters_ByDefault_ShouldHaveAllFiltersEnabled()
    {
        var viewModel = new SearchViewModel();

        viewModel.IsFilterEnabled(SearchFilter.Author).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perush).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perek).Should().BeTrue();
    }

    [Fact]
    public void SetFilterEnabled_ShouldToggleFilter()
    {
        var viewModel = new SearchViewModel();

        viewModel.SetFilterEnabled(SearchFilter.Author, false);
        viewModel.IsFilterEnabled(SearchFilter.Author).Should().BeFalse();

        viewModel.SetFilterEnabled(SearchFilter.Author, true);
        viewModel.IsFilterEnabled(SearchFilter.Author).Should().BeTrue();
    }

    [Fact]
    public void SetFilterEnabled_ShouldNotAffectOtherFilters()
    {
        var viewModel = new SearchViewModel();

        viewModel.SetFilterEnabled(SearchFilter.Author, false);

        viewModel.IsFilterEnabled(SearchFilter.Pasuk).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perush).Should().BeTrue();
        viewModel.IsFilterEnabled(SearchFilter.Perek).Should().BeTrue();
    }

    #endregion

    #region Sefer Filter Tests

    [Fact]
    public void SeferFilters_ByDefault_ShouldHaveAllSefarimEnabled()
    {
        var viewModel = new SearchViewModel();

        for (int seferId = 1; seferId <= 35; seferId++)
        {
            viewModel.IsSeferFilterEnabled(seferId).Should().BeTrue($"Sefer {seferId} should be enabled by default");
        }
    }

    [Fact]
    public void SetSeferFilterEnabled_ShouldToggleSeferFilter()
    {
        var viewModel = new SearchViewModel();

        viewModel.SetSeferFilterEnabled(1, false);
        viewModel.IsSeferFilterEnabled(1).Should().BeFalse();

        viewModel.SetSeferFilterEnabled(1, true);
        viewModel.IsSeferFilterEnabled(1).Should().BeTrue();
    }

    [Fact]
    public void SetSeferGroupFilterEnabled_ShouldToggleAllSefarimInGroup()
    {
        var viewModel = new SearchViewModel();

        // Torah group (group 0) contains sefarim 1-5
        viewModel.SetSeferGroupFilterEnabled(0, false);

        viewModel.IsSeferFilterEnabled(1).Should().BeFalse("Bereishit should be disabled");
        viewModel.IsSeferFilterEnabled(2).Should().BeFalse("Shemot should be disabled");
        viewModel.IsSeferFilterEnabled(3).Should().BeFalse("Vayikra should be disabled");
        viewModel.IsSeferFilterEnabled(4).Should().BeFalse("Bamidbar should be disabled");
        viewModel.IsSeferFilterEnabled(5).Should().BeFalse("Devarim should be disabled");

        // Other groups should remain enabled
        viewModel.IsSeferFilterEnabled(6).Should().BeTrue("Yehoshua (Neviim) should still be enabled");
    }

    [Fact]
    public void IsSeferGroupFilterEnabled_ShouldReturnTrue_WhenAllSefarimInGroupEnabled()
    {
        var viewModel = new SearchViewModel();

        viewModel.IsSeferGroupFilterEnabled(0).Should().BeTrue();

        viewModel.SetSeferFilterEnabled(1, false);
        viewModel.IsSeferGroupFilterEnabled(0).Should().BeFalse();
    }

    #endregion

    #region Author Search Results Tests

    [Fact]
    public void AuthorResults_WhenSearchPhraseMatches_ShouldReturnMatchingAuthors()
    {
        var viewModel = new SearchViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);
        viewModel.SearchPhrase = "משה";

        var results = viewModel.GetAuthorResults();

        results.Should().HaveCount(1);
        results[0].Author.Name.Should().Contain("משה");
    }

    [Fact]
    public void AuthorResults_WhenFilterDisabled_ShouldReturnEmpty()
    {
        var viewModel = new SearchViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);
        viewModel.SearchPhrase = "משה";
        viewModel.SetFilterEnabled(SearchFilter.Author, false);

        var results = viewModel.GetAuthorResults();

        results.Should().BeEmpty();
    }

    #endregion

    #region Results Limit Tests

    [Fact]
    public void ResultsLimit_ByDefault_ShouldBe10()
    {
        var viewModel = new SearchViewModel();

        viewModel.ResultsLimit.Should().Be(10);
    }

    [Fact]
    public void ResultsLimit_ShouldBeSettable()
    {
        var viewModel = new SearchViewModel();
        viewModel.ResultsLimit = 25;

        viewModel.ResultsLimit.Should().Be(25);
    }

    #endregion

    private static List<Author> CreateTestAuthors()
    {
        return new List<Author>
        {
            new Author { Id = 1, Name = "הרב משה לוי", Details = "רב ומחנך", ArticlesCount = 10 },
            new Author { Id = 2, Name = "הרב יוסף כהן", Details = "מרצה ומחבר", ArticlesCount = 5 },
            new Author { Id = 3, Name = "הרב דוד ישראלי", Details = "דיין ופוסק", ArticlesCount = 15 }
        };
    }
}
