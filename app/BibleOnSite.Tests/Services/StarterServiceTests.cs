using System.Reflection;
using BibleOnSite.Services;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

public class StarterServiceTests
{
    [Fact]
    public void ApplyResponse_ShouldSortAuthorsAndLinkArticles()
    {
        var service = CreateService();
        var response = new StarterService.StarterResponse(
            new StarterService.StarterData(
                [
                    new StarterService.AuthorData(2, 1, "second", "Beta"),
                    new StarterService.AuthorData(1, 2, "first", "Alpha")
                ],
                [
                    new StarterService.ArticleData(10, 3, 2, null, "Linked", 7),
                    new StarterService.ArticleData(11, 3, 99, "kept", "Missing author", 1)
                ],
                [4, 0, 2]));

        ApplyResponse(service, response);

        service.Authors.Select(author => author.Name).Should().Equal("Alpha", "Beta");
        service.PerekArticlesCounters.Should().Equal(4, 0, 2);
        service.Articles.Should().HaveCount(2);
        service.Articles[0].Abstract.Should().BeEmpty();
        service.Articles[0].Author.Should().BeSameAs(service.Authors.Single(author => author.Id == 2));
        service.Articles[1].Abstract.Should().Be("kept");
        service.Articles[1].Author.Should().BeNull();
    }

    [Fact]
    public void GetArticlesByAuthorId_ShouldFilterAndOrderByPriority()
    {
        var service = CreateService();
        ApplyResponse(
            service,
            new StarterService.StarterResponse(
                new StarterService.StarterData(
                    [new StarterService.AuthorData(1, 3, "details", "Author")],
                    [
                        new StarterService.ArticleData(1, 8, 1, "third", "A", 30),
                        new StarterService.ArticleData(2, 8, 2, "other", "B", 10),
                        new StarterService.ArticleData(3, 9, 1, "first", "C", 5)
                    ],
                    [])));

        var articles = service.GetArticlesByAuthorId(1);

        articles.Select(article => article.Id).Should().Equal(3, 1);
    }

    [Fact]
    public void GetArticlesByPerekId_ShouldFilterAndOrderByPriority()
    {
        var service = CreateService();
        ApplyResponse(
            service,
            new StarterService.StarterResponse(
                new StarterService.StarterData(
                    [new StarterService.AuthorData(1, 3, "details", "Author")],
                    [
                        new StarterService.ArticleData(1, 8, 1, "second", "A", 20),
                        new StarterService.ArticleData(2, 8, 1, "first", "B", 10),
                        new StarterService.ArticleData(3, 9, 1, "other", "C", 5)
                    ],
                    [])));

        var articles = service.GetArticlesByPerekId(8);

        articles.Select(article => article.Id).Should().Equal(2, 1);
    }

    private static StarterService CreateService()
    {
        var constructor = typeof(StarterService).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            types: Type.EmptyTypes,
            modifiers: null);

        constructor.Should().NotBeNull();
        return (StarterService)constructor!.Invoke(null);
    }

    private static void ApplyResponse(StarterService service, StarterService.StarterResponse response)
    {
        var method = typeof(StarterService).GetMethod(
            "ApplyResponse",
            BindingFlags.Instance | BindingFlags.NonPublic);

        method.Should().NotBeNull();
        method!.Invoke(service, [response]);
    }
}
