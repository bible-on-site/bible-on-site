using BibleOnSite.Services;
using BibleOnSite.Tests.Fixtures;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Integration tests for ArticleService that require the API server.
/// The ApiServer fixture provides an isolated server backed by the test database.
/// </summary>
[Trait("Category", "Integration")]
[Collection("ApiServer")]
public class ArticleServiceIntegrationTests
{
    [Fact]
    public async Task GetArticleByIdAsync_ShouldReturnArticleContent()
    {
        // Arrange
        // Article ID 1 has content in the test database (tanah_test)
        const int articleIdWithContent = 1;

        // Act
        var article = await ArticleService.Instance.GetArticleByIdAsync(articleIdWithContent);

        // Assert
        article.Should().NotBeNull("Article 1 should exist in test database");
        article!.ArticleContent.Should().NotBeNullOrEmpty(
            "Article 1 should have content - the GraphQL query must request articleContent field");
    }
}
