using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

public class ArticleResponseTests
{
    [Fact]
    public void Instance_ReusesSameService() => ArticleService.Instance.Should().BeSameAs(ArticleService.Instance);
    [Fact]
    public async Task AuthorArticles_MapsFieldsAndSortsByPriority()
    {
        using var http = new GraphQLTransport("""
            {"data":{"articlesByAuthorId":[
            {"id":2,"authorId":9,"perekId":3,"name":null,"abstract":null,"priority":20},
            {"id":1,"authorId":9,"perekId":4,"name":"first","abstract":"intro","priority":10}]}}
            """);
        var articles = await new ArticleService(http.Client).GetArticlesByAuthorIdAsync(9);
        articles.Select(a => a.Id).Should().Equal(1, 2);
        articles[0].Name.Should().Be("first");
        articles[0].Abstract.Should().Be("intro");
        articles[0].PerekId.Should().Be(4);
        articles[1].Name.Should().BeEmpty();
        articles[1].Abstract.Should().BeEmpty();
        articles[1].AuthorId.Should().Be(9);
        http.Requests.Single().Should().Contain("\"authorId\":9");
    }

    [Theory]
    [InlineData("{\"errors\":[{\"message\":\"missing\"}]}")]
    [InlineData("{\"data\":null}")]
    public async Task Requests_WithMissingDataOrGraphQlErrors_ReturnEmptyResults(string response)
    {
        using var http = new GraphQLTransport(response);
        var service = new ArticleService(http.Client);
        (await service.GetArticlesByPerekIdAsync(1)).Should().BeEmpty();
        (await service.GetArticlesByAuthorIdAsync(1)).Should().BeEmpty();
        (await service.GetArticleByIdAsync(1)).Should().BeNull();
    }

    [Fact]
    public async Task Requests_WithTransportFailure_ReturnEmptyResults()
    {
        using var http = new GraphQLTransport();
        http.Respond = _ => throw new HttpRequestException("offline");
        var service = new ArticleService(http.Client);
        (await service.GetArticlesByAuthorIdAsync(1)).Should().BeEmpty();
        (await service.GetArticleByIdAsync(1)).Should().BeNull();
    }
}
