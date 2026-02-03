using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class ArticleTests
{
    #region CreateMock Tests

    [Fact]
    public void CreateMock_ShouldReturnValidMockArticle()
    {
        // Act
        var mock = Article.CreateMock();

        // Assert
        mock.Id.Should().Be(-1);
        mock.Abstract.Should().Be("בטעינה");
        mock.ArticleContent.Should().Be("מתחבר לפרק...");
        mock.AuthorId.Should().Be(Author.SystemId);
        mock.PerekId.Should().Be(-1);
        mock.Priority.Should().Be(1);
    }

    #endregion

    #region ShortAbstract Tests

    [Fact]
    public void ShortAbstract_WithH1Tag_ShouldExtractH1Content()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "<H1>פירוש על בראשית</H1><p>תוכן נוסף</p>",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().Be("פירוש על בראשית");
    }

    [Fact]
    public void ShortAbstract_WithLowercaseH1Tag_ShouldExtractH1Content()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "<h1>פירוש על בראשית</h1><p>תוכן נוסף</p>",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().Be("פירוש על בראשית");
    }

    [Fact]
    public void ShortAbstract_WithNoH1Tag_ShouldReturnPlainText()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "<p>תוכן פשוט</p>",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().Be("תוכן פשוט");
    }

    [Fact]
    public void ShortAbstract_WithEmptyAbstract_ShouldReturnEmptyString()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().BeEmpty();
    }

    [Fact]
    public void ShortAbstract_WithNullAbstract_ShouldReturnEmptyString()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = null!,
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().BeEmpty();
    }

    [Fact]
    public void ShortAbstract_WithMultipleHtmlTags_ShouldStripAllTags()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "<div><span>טקסט</span> <b>מודגש</b> <i>נטוי</i></div>",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().Be("טקסט מודגש נטוי");
    }

    [Fact]
    public void ShortAbstract_WithH1ContainingNestedTags_ShouldExtractAndStripTags()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "<H1><span>פירוש</span> על <b>בראשית</b></H1>",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().Be("פירוש על בראשית");
    }

    [Fact]
    public void ShortAbstract_WithPlainText_ShouldReturnTrimmed()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "  פירוש פשוט  ",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert
        article.ShortAbstract.Should().Be("פירוש פשוט");
    }

    [Fact]
    public void ShortAbstract_WithMalformedH1_ShouldHandleGracefully()
    {
        // Arrange - unclosed H1 tag
        var article = new Article
        {
            Id = 1,
            Abstract = "<H1>פירוש ללא סגירה",
            AuthorId = 1,
            PerekId = 1
        };

        // Act & Assert - should strip tags and return content
        article.ShortAbstract.Should().Be("פירוש ללא סגירה");
    }

    #endregion

    #region Properties Tests

    [Fact]
    public void Article_ShouldStoreAllProperties()
    {
        // Arrange
        var author = new Author { Id = 5, Name = "Test Author", Details = "Details" };
        var article = new Article
        {
            Id = 42,
            Abstract = "Abstract",
            ArticleContent = "Content",
            AuthorId = 5,
            PerekId = 100,
            Priority = 2,
            Name = "Article Name",
            Author = author,
            PerekDisplayName = "בראשית א"
        };

        // Assert
        article.Id.Should().Be(42);
        article.Abstract.Should().Be("Abstract");
        article.ArticleContent.Should().Be("Content");
        article.AuthorId.Should().Be(5);
        article.PerekId.Should().Be(100);
        article.Priority.Should().Be(2);
        article.Name.Should().Be("Article Name");
        article.Author.Should().BeSameAs(author);
        article.PerekDisplayName.Should().Be("בראשית א");
    }

    [Fact]
    public void Article_Priority_ShouldBeNullable()
    {
        // Arrange
        var article = new Article
        {
            Id = 1,
            Abstract = "Test",
            AuthorId = 1,
            PerekId = 1,
            Priority = null
        };

        // Assert
        article.Priority.Should().BeNull();
    }

    #endregion
}
