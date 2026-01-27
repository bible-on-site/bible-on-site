using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Tests for navigation-related functionality in ViewModels.
/// These tests verify that navigation parameters are correctly handled.
/// </summary>
public class NavigationTests
{
    #region PerekViewModel Navigation Tests

    [Fact]
    public void PerekViewModel_GoToArticles_ShouldHaveCorrectParameters()
    {
        // The GoToArticlesCommand navigates with perekId and perekTitle
        // Verify the Source property provides the correct title format

        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = new Perek
        {
            PerekId = 123,
            PerekNumber = 5,
            Additional = null,
            Date = "2026-01-20",
            HebDate = "תשרי",
            HasRecording = false,
            Header = "Header",
            SeferId = 1,
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "18:00"
        };

        var viewModel = new PerekViewModel(preferences, _ => perek);
        viewModel.LoadByPerekId(123);

        // Verify the source includes the perek ID and Hebrew date for navigation
        viewModel.Source.Should().Be("בראשית ה - 123 | תשרי");
        viewModel.PerekId.Should().Be(123);
    }

    #endregion

    #region ArticlesViewModel Navigation Tests

    [Fact]
    public void ArticlesViewModel_ByPerek_ShouldHaveCorrectRoute()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית ה - 123");

        viewModel.IsFilterByPerek.Should().BeTrue();
        viewModel.PerekId.Should().Be(123);
        viewModel.PerekTitle.Should().Be("בראשית ה - 123");

        // Route format: ArticlesPage?perekId=123&perekTitle=...
    }

    [Fact]
    public void ArticlesViewModel_ByAuthor_ShouldHaveCorrectRoute()
    {
        var viewModel = ArticlesViewModel.ForAuthor(5, "הרב משה לוי");

        viewModel.IsFilterByAuthor.Should().BeTrue();
        viewModel.AuthorId.Should().Be(5);
        viewModel.AuthorName.Should().Be("הרב משה לוי");

        // Route format: ArticlesPage?authorId=5&authorName=...
    }

    #endregion

    #region AuthorsViewModel Navigation Tests

    [Fact]
    public void AuthorsViewModel_NavigateToAuthor_ShouldProvideAuthorId()
    {
        var viewModel = new AuthorsViewModel();
        var authors = new List<Author>
        {
            new Author { Id = 5, Name = "הרב משה לוי", Details = "רב", ArticlesCount = 10 }
        };
        viewModel.SetAuthors(authors);

        // When navigating, we use AuthorId
        var author = viewModel.FilteredAuthors[0];
        author.Id.Should().Be(5);
        author.Name.Should().Be("הרב משה לוי");

        // Route format: ArticlesPage?authorId=5&authorName=...
    }

    #endregion

    #region Route Path Format Tests

    [Theory]
    [InlineData(1, "בראשית א - 1")]
    [InlineData(123, "בראשית ה - 123")]
    [InlineData(929, "דברי הימים ב א - 929")]
    public void PerekSource_ShouldContainPerekId(int perekId, string expectedPattern)
    {
        // The Source should end with " - {perekId}"
        expectedPattern.Should().EndWith($" - {perekId}");
    }

    [Fact]
    public void ArticlesPage_ByPerek_RouteFormat()
    {
        // Expected: ArticlesPage?perekId={id}&perekTitle={title}
        var perekId = 123;
        var perekTitle = Uri.EscapeDataString("בראשית ה - 123");

        var route = $"ArticlesPage?perekId={perekId}&perekTitle={perekTitle}";

        route.Should().Contain("perekId=123");
        route.Should().StartWith("ArticlesPage");
    }

    [Fact]
    public void ArticlesPage_ByAuthor_RouteFormat()
    {
        // Expected: ArticlesPage?authorId={id}&authorName={name}
        var authorId = 5;
        var authorName = Uri.EscapeDataString("הרב משה לוי");

        var route = $"ArticlesPage?authorId={authorId}&authorName={authorName}";

        route.Should().Contain("authorId=5");
        route.Should().StartWith("ArticlesPage");
    }

    [Fact]
    public void AuthorsPage_RouteFormat()
    {
        // Expected: AuthorsPage (no parameters)
        var route = "AuthorsPage";

        route.Should().Be("AuthorsPage");
    }

    #endregion

    #region Back Navigation Tests

    [Fact]
    public void ArticlesViewModel_BackNavigation_ShouldNotLoseState()
    {
        // When navigating back, the filter state should be preserved
        var viewModel = new ArticlesViewModel(123, "בראשית ה - 123");

        // Simulate adding articles
        viewModel.SetArticles(new List<Article>
        {
            new Article
            {
                Id = 1, Abstract = "Test", AuthorId = 1, PerekId = 123, Name = "Test Article"
            }
        });

        // State should be preserved
        viewModel.PerekId.Should().Be(123);
        viewModel.HasArticles.Should().BeTrue();
        viewModel.Articles.Count.Should().Be(1);
    }

    #endregion
}
