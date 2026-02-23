using BibleOnSite.Models;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Tests for ArticleDetailViewModel.
/// </summary>
public class ArticleDetailViewModelTests
{
    #region Initial State Tests

    [Fact]
    public void ViewModel_InitialState_ShouldBeLoading()
    {
        var viewModel = new ArticleDetailViewModel();

        viewModel.IsLoading.Should().BeTrue();
        viewModel.Article.Should().BeNull();
    }

    [Fact]
    public void ViewModel_InitialState_ComputedPropertiesShouldHaveDefaults()
    {
        var viewModel = new ArticleDetailViewModel();

        viewModel.HasContent.Should().BeFalse();
        viewModel.StyledContent.Should().BeNull();
        viewModel.WebViewContent.Should().BeNull();
        viewModel.ArticleName.Should().BeEmpty();
        viewModel.AuthorName.Should().BeEmpty();
        viewModel.AuthorImageUrl.Should().BeNull();
        viewModel.ShareUrl.Should().BeEmpty();
    }

    #endregion

    #region SetArticle Tests

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
    public void SetArticle_WithEmptyContent_ShouldSetHasContentFalse()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = "",
            AuthorId = 1,
            PerekId = 123
        };

        viewModel.SetArticle(article);

        viewModel.HasContent.Should().BeFalse();
    }

    [Fact]
    public void SetArticle_ShouldRaisePropertyChangedForAllProperties()
    {
        var viewModel = new ArticleDetailViewModel();
        var changedProperties = new List<string>();
        viewModel.PropertyChanged += (_, args) => changedProperties.Add(args.PropertyName!);

        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = "<p>Content</p>",
            AuthorId = 1,
            PerekId = 123
        };

        viewModel.SetArticle(article);

        changedProperties.Should().Contain("Article");
        changedProperties.Should().Contain("IsLoading");
        changedProperties.Should().Contain("HasContent");
        changedProperties.Should().Contain("StyledContent");
        changedProperties.Should().Contain("WebViewContent");
        changedProperties.Should().Contain("ArticleName");
        changedProperties.Should().Contain("AuthorName");
        changedProperties.Should().Contain("AuthorImageUrl");
        changedProperties.Should().Contain("ShareUrl");
    }

    #endregion

    #region ArticleName Tests

    [Fact]
    public void ArticleName_ShouldReturnShortAbstract()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "מאמר מעניין",
            ShortAbstract = "תקציר קצר",
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 123
        };

        viewModel.SetArticle(article);

        viewModel.ArticleName.Should().Be("תקציר קצר");
    }

    [Fact]
    public void ArticleName_WithNoArticle_ShouldReturnEmpty()
    {
        var viewModel = new ArticleDetailViewModel();

        viewModel.ArticleName.Should().BeEmpty();
    }

    #endregion

    #region AuthorName Tests

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

    #endregion

    #region AuthorImageUrl Tests

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
    public void AuthorImageUrl_WithNoAuthor_ShouldReturnNull()
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

        viewModel.AuthorImageUrl.Should().BeNull();
    }

    #endregion

    #region ShareUrl Tests

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

    [Fact]
    public void ShareUrl_ShouldBeHebrewDomain()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 1
        };

        viewModel.SetArticle(article);

        viewModel.ShareUrl.Should().Contain("תנך.co.il");
    }

    [Fact]
    public void ShareUrl_WithNoArticle_ShouldReturnEmpty()
    {
        var viewModel = new ArticleDetailViewModel();

        viewModel.ShareUrl.Should().BeEmpty();
    }

    #endregion

    #region StyledContent Tests

    [Fact]
    public void StyledContent_WithContent_ShouldWrapInRtlDiv()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = "<p>תוכן המאמר</p>",
            AuthorId = 1,
            PerekId = 1
        };

        viewModel.SetArticle(article);

        viewModel.StyledContent.Should().Contain("direction: rtl");
        viewModel.StyledContent.Should().Contain("text-align: justify");
        viewModel.StyledContent.Should().Contain("<p>תוכן המאמר</p>");
    }

    [Fact]
    public void StyledContent_WithNullContent_ShouldReturnNull()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = null,
            AuthorId = 1,
            PerekId = 1
        };

        viewModel.SetArticle(article);

        viewModel.StyledContent.Should().BeNull();
    }

    #endregion

    #region WebViewContent Tests

    [Fact]
    public void WebViewContent_WithContent_ShouldBeFullHtmlDocument()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = "<p>תוכן</p>",
            AuthorId = 1,
            PerekId = 1
        };

        viewModel.SetArticle(article);

        viewModel.WebViewContent.Should().Contain("<!DOCTYPE html>");
        viewModel.WebViewContent.Should().Contain("<html dir=\"rtl\" lang=\"he\">");
        viewModel.WebViewContent.Should().Contain("<head>");
        viewModel.WebViewContent.Should().Contain("<body>");
        viewModel.WebViewContent.Should().Contain("<p>תוכן</p>");
    }

    [Fact]
    public void WebViewContent_ShouldContainDarkModeStyles()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = "<p>Content</p>",
            AuthorId = 1,
            PerekId = 1
        };

        viewModel.SetArticle(article);

        viewModel.WebViewContent.Should().Contain("prefers-color-scheme: dark");
    }

    [Fact]
    public void WebViewContent_ShouldContainHeadingStyles()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = "<h1>Title</h1><h2>Subtitle</h2>",
            AuthorId = 1,
            PerekId = 1
        };

        viewModel.SetArticle(article);

        viewModel.WebViewContent.Should().Contain("h1 {");
        viewModel.WebViewContent.Should().Contain("h2 {");
        viewModel.WebViewContent.Should().Contain("h3 {");
    }

    [Fact]
    public void WebViewContent_WithNullContent_ShouldReturnNull()
    {
        var viewModel = new ArticleDetailViewModel();
        var article = new Article
        {
            Id = 1,
            Name = "Test",
            Abstract = "Test",
            ArticleContent = null,
            AuthorId = 1,
            PerekId = 1
        };

        viewModel.SetArticle(article);

        viewModel.WebViewContent.Should().BeNull();
    }

    #endregion

    #region ErrorMessage Tests

    [Fact]
    public void ErrorMessage_ShouldBeNullByDefault()
    {
        var viewModel = new ArticleDetailViewModel();

        viewModel.ErrorMessage.Should().BeNull();
    }

    [Fact]
    public void ErrorMessage_ShouldBeSettable()
    {
        var viewModel = new ArticleDetailViewModel();

        viewModel.ErrorMessage = "שגיאה בטעינת המאמר";

        viewModel.ErrorMessage.Should().Be("שגיאה בטעינת המאמר");
    }

    #endregion
}
