using BibleOnSite.Models;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Tests for ArticleDetailViewModel.
/// </summary>
public class ArticleDetailViewModelTests
{
    [Fact]
    public void ViewModel_InitialState_ShouldBeLoading()
    {
        var viewModel = new ArticleDetailViewModel();

        viewModel.IsLoading.Should().BeTrue();
        viewModel.Article.Should().BeNull();
    }

    [Fact]
    public void SetArticle_ShouldUpdateArticleProperty()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test Article",
            Abstract = "<H1>Test</H1>",
            ArticleContent = "<p>Content</p>",
            AuthorId = 1,
            PerekId = 123
        };

        viewModel.SetArticle(article);

        viewModel.Article.Should().Be(article);
        viewModel.IsLoading.Should().BeFalse();
        viewModel.HasContent.Should().BeTrue();
    }

    [Fact]
    public void SetArticle_WithNullContent_ShouldSetHasContentFalse()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test Article",
            Abstract = "<H1>Test</H1>",
            ArticleContent = null,
            AuthorId = 1,
            PerekId = 123
        };

        viewModel.SetArticle(article);

        viewModel.HasContent.Should().BeFalse();
    }

    [Fact]
    public void ArticleName_ShouldReturnArticleName()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "מאמר מעניין",
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 123
        };

        viewModel.SetArticle(article);

        viewModel.ArticleName.Should().Be("מאמר מעניין");
    }

    [Fact]
    public void AuthorName_ShouldReturnAuthorName()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 123,
            Author = new Author { Id = 1, Name = "הרב משה לוי", Details = "רב" }
        };

        viewModel.SetArticle(article);

        viewModel.AuthorName.Should().Be("הרב משה לוי");
    }

    [Fact]
    public void AuthorName_WithNoAuthor_ShouldReturnEmpty()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 123,
            Author = null
        };

        viewModel.SetArticle(article);

        viewModel.AuthorName.Should().BeEmpty();
    }

    [Fact]
    public void AuthorImageUrl_ShouldReturnAuthorImageUrl()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 123,
            Author = new Author
            {
                Id = 5,
                Name = "Test",
                Details = "רב"
            }
        };

        viewModel.SetArticle(article);

        // ImageUrl is computed from Id: S3 bucket URL with author ID
        viewModel.AuthorImageUrl.Should().Contain("/authors/high-res/5.jpg");
    }

    [Fact]
    public void ShareUrl_ShouldContainArticleIdAndPerekId()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 42,
            Name = "Test",
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 123
        };

        viewModel.SetArticle(article);

        viewModel.ShareUrl.Should().Contain("123");
        viewModel.ShareUrl.Should().Contain("42");
    }
}
