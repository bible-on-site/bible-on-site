using BibleOnSite.Models;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

public class AuthorsViewModelTests
{
    [Fact]
    public void FilteredAuthors_WhenSearchPhraseIsEmpty_ShouldReturnAllAuthors()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        viewModel.SearchPhrase = "";

        viewModel.FilteredAuthors.Should().HaveCount(3);
        viewModel.FilteredAuthors.Should().BeEquivalentTo(authors);
    }

    [Fact]
    public void FilteredAuthors_WhenSearchPhraseMatches_ShouldReturnMatchingAuthors()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        viewModel.SearchPhrase = "הרב משה";

        viewModel.FilteredAuthors.Should().HaveCount(1);
        viewModel.FilteredAuthors[0].Name.Should().Contain("משה");
    }

    [Fact]
    public void FilteredAuthors_ShouldMatchByPartialName()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        viewModel.SearchPhrase = "כהן";

        viewModel.FilteredAuthors.Should().HaveCount(1);
        viewModel.FilteredAuthors[0].Name.Should().Contain("כהן");
    }

    [Fact]
    public void FilteredAuthors_ShouldBeCaseInsensitive()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        viewModel.SearchPhrase = "RABBI"; // English search should not match Hebrew names

        viewModel.FilteredAuthors.Should().HaveCount(0);
    }

    [Fact]
    public void FilteredAuthors_ShouldIgnoreHaravPrefix()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        // Searching without "הרב" prefix should still match
        viewModel.SearchPhrase = "משה לוי";

        viewModel.FilteredAuthors.Should().HaveCount(1);
        viewModel.FilteredAuthors[0].Name.Should().Contain("משה לוי");
    }

    [Fact]
    public void FilteredAuthors_WhenNoMatch_ShouldReturnEmptyList()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        viewModel.SearchPhrase = "לא קיים";

        viewModel.FilteredAuthors.Should().BeEmpty();
    }

    [Fact]
    public void FilteredAuthors_ShouldUpdateWhenSearchPhraseChanges()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        viewModel.SearchPhrase = "משה";
        viewModel.FilteredAuthors.Should().HaveCount(1);

        viewModel.SearchPhrase = "כהן";
        viewModel.FilteredAuthors.Should().HaveCount(1);
        viewModel.FilteredAuthors[0].Name.Should().Contain("כהן");

        viewModel.SearchPhrase = "";
        viewModel.FilteredAuthors.Should().HaveCount(3);
    }

    [Fact]
    public void SearchPhrase_ShouldTrimWhitespace()
    {
        var viewModel = new AuthorsViewModel();
        var authors = CreateTestAuthors();
        viewModel.SetAuthors(authors);

        viewModel.SearchPhrase = "  משה  ";

        viewModel.FilteredAuthors.Should().HaveCount(1);
    }

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
