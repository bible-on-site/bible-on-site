using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class ArticleTests
{
    [Fact]
    public void CreateMock_ShouldReturnValidMockArticle()
    {
        // Act
        var mock = Article.CreateMock();

        // Assert
        mock.Id.Should().Be(-1);
        mock.Abstract.Should().Be("בטעינה");
        mock.ArticleContent.Should().Be("טוען...");
        mock.AuthorId.Should().Be(Author.SystemId);
        mock.PerekId.Should().Be(-1);
        mock.Priority.Should().Be(1);
    }
}
