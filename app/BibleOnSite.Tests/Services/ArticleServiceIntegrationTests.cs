using BibleOnSite.Services;
using BibleOnSite.Tests.Fixtures;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Integration tests for ArticleService that require the API server.
/// These tests require the API server to be running on http://127.0.0.1:3003
/// </summary>
[Trait("Category", "Integration")]
[Collection("ApiServer")]
public class ArticleServiceIntegrationTests
{
    [Fact]
    public async Task GetArticleByIdAsync_ShouldReturnArticleContent()
    {
        // Arrange
        // Article ID 1 is the only article with content in dev DB
        const int articleIdWithContent = 1;

        // Act
        var article = await ArticleService.Instance.GetArticleByIdAsync(articleIdWithContent);

        // Assert
        article.Should().NotBeNull("Article 1 should exist in dev DB");
        article!.ArticleContent.Should().NotBeNullOrEmpty(
            "Article 1 should have content - the GraphQL query must request articleContent field");
    }
}
