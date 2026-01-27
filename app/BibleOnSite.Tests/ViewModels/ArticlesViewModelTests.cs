using BibleOnSite.Models;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

public class ArticlesViewModelTests
{
    #region Constructor Tests

    [Fact]
    public void Constructor_WithPerekId_ShouldSetPerekIdAndTitle()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית א - 123");

        viewModel.PerekId.Should().Be(123);
        viewModel.PerekTitle.Should().Be("בראשית א - 123");
        viewModel.AuthorId.Should().BeNull();
        viewModel.AuthorName.Should().BeEmpty();
    }

    [Fact]
    public void Constructor_WithAuthorId_ShouldSetAuthorIdAndName()
    {
        var viewModel = ArticlesViewModel.ForAuthor(5, "הרב משה לוי");

        viewModel.AuthorId.Should().Be(5);
        viewModel.AuthorName.Should().Be("הרב משה לוי");
        viewModel.PerekId.Should().Be(0);
        viewModel.PerekTitle.Should().BeEmpty();
    }

    #endregion

    #region Filter Mode Tests

    [Fact]
    public void IsFilterByPerek_WhenPerekIdSet_ShouldBeTrue()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית א");

        viewModel.IsFilterByPerek.Should().BeTrue();
        viewModel.IsFilterByAuthor.Should().BeFalse();
    }

    [Fact]
    public void IsFilterByAuthor_WhenAuthorIdSet_ShouldBeTrue()
    {
        var viewModel = ArticlesViewModel.ForAuthor(5, "הרב משה");

        viewModel.IsFilterByAuthor.Should().BeTrue();
        viewModel.IsFilterByPerek.Should().BeFalse();
    }

    #endregion

    #region Display Title Tests

    [Fact]
    public void DisplayTitle_WhenFilterByPerek_ShouldShowPerekTitle()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית א - 123");

        viewModel.DisplayTitle.Should().Be("מאמרים על בראשית א - 123");
    }

    [Fact]
    public void DisplayTitle_WhenFilterByAuthor_ShouldShowAuthorName()
    {
        var viewModel = ArticlesViewModel.ForAuthor(5, "הרב משה לוי");

        viewModel.DisplayTitle.Should().Be("מאמרים של הרב משה לוי");
    }

    #endregion

    #region Articles Collection Tests

    [Fact]
    public void SetArticles_ShouldUpdateArticlesCollection()
    {
        var viewModel = new ArticlesViewModel(1, "Test");
        var articles = CreateTestArticles();

        viewModel.SetArticles(articles);

        viewModel.Articles.Should().HaveCount(3);
        viewModel.HasArticles.Should().BeTrue();
    }

    [Fact]
    public void HasArticles_WhenEmpty_ShouldBeFalse()
    {
        var viewModel = new ArticlesViewModel(1, "Test");

        viewModel.HasArticles.Should().BeFalse();
    }

    [Fact]
    public void SetArticles_ShouldClearPreviousArticles()
    {
        var viewModel = new ArticlesViewModel(1, "Test");
        viewModel.SetArticles(CreateTestArticles());
        viewModel.Articles.Should().HaveCount(3);

        viewModel.SetArticles(new List<Article> { CreateTestArticle(1) });

        viewModel.Articles.Should().HaveCount(1);
    }

    #endregion

    #region Helper Methods

    private static List<Article> CreateTestArticles()
    {
        return new List<Article>
        {
            CreateTestArticle(1),
            CreateTestArticle(2),
            CreateTestArticle(3)
        };
    }

    private static Article CreateTestArticle(int id)
    {
        return new Article
        {
            Id = id,
            Abstract = $"<H1>Article {id} Title</H1>",
            ArticleContent = $"Content for article {id}",
            AuthorId = 1,
            PerekId = 1,
            Priority = 1,
            Name = $"Article {id}"
        };
    }

    #endregion
}
