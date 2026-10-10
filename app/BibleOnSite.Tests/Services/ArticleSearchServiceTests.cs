using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.Services;

public class ArticleSearchServiceTests
{
    private const string SearchResponse = """
        {"data":{"searchArticles":{"total":2,"hits":[
        {"articleId":11,"name":"מאמר ראשון","authorName":"רש\"י","authorId":3,"perekId":1,"source":"בראשית א","excerpt":"קטע ראשון על בראשית","score":0.9},
        {"articleId":12,"name":"מאמר שני","authorName":"רמב\"ן","authorId":4,"perekId":2,"source":"בראשית ב","excerpt":"קטע שני","score":0.5}]}}}
        """;

    [Fact]
    public async Task SearchArticles_MapsHitsAndTotal()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new ArticleService(http.Client);

        var page = await service.SearchArticlesAsync("בראשית", 20, cancellationToken: TestContext.Current.CancellationToken);

        page.Should().NotBeNull();
        page!.Total.Should().Be(2);
        page.Hits.Should().HaveCount(2);
        page.Hits[0].ArticleId.Should().Be(11);
        page.Hits[0].Name.Should().Be("מאמר ראשון");
        page.Hits[0].AuthorName.Should().Be("רש\"י");
        page.Hits[0].PerekId.Should().Be(1);
        page.Hits[0].Source.Should().Be("בראשית א");
        page.Hits[0].Excerpt.Should().Be("קטע ראשון על בראשית");
        page.Hits[0].Score.Should().BeApproximately(0.9f, 0.001f);
        http.Requests.Single().Should().Contain("\"phrase\":\"בראשית\"");
        http.Requests.Single().Should().Contain("searchArticles");
    }

    [Fact]
    public async Task SearchArticles_GraphQlErrors_Throw()
    {
        using var http = new GraphQLTransport("{\"errors\":[{\"message\":\"phrase too long\"}]}");
        var service = new ArticleService(http.Client);
        await FluentActions.Awaiting(() => service.SearchArticlesAsync("x", 20))
            .Should().ThrowAsync<GraphQLException>();
    }

    [Fact]
    public async Task SearchArticles_TransportFailure_Propagates()
    {
        using var http = new GraphQLTransport();
        http.Respond = _ => throw new HttpRequestException("offline");
        var service = new ArticleService(http.Client);
        await FluentActions.Awaiting(() => service.SearchArticlesAsync("x", 20))
            .Should().ThrowAsync<Exception>();
    }

    [Fact]
    public async Task SearchArticles_Timeout_ThrowsTimeoutException()
    {
        using var http = new GraphQLTransport();
        http.Respond = async token =>
        {
            await Task.Delay(TimeSpan.FromMinutes(1), token);
            return GraphQLTransport.JsonResponse("{}");
        };
        var service = new ArticleService(http.Client);
        await FluentActions.Awaiting(() =>
                service.SearchArticlesAsync("x", 20, timeout: TimeSpan.FromMilliseconds(50)))
            .Should().ThrowAsync<TimeoutException>();
    }

    [Fact]
    public async Task SearchArticles_CallerCancellation_PropagatesCancellation()
    {
        using var http = new GraphQLTransport();
        http.Respond = async token =>
        {
            await Task.Delay(TimeSpan.FromMinutes(1), token);
            return GraphQLTransport.JsonResponse("{}");
        };
        var service = new ArticleService(http.Client);
        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(50));
        await FluentActions.Awaiting(() => service.SearchArticlesAsync("x", 20, cancellationToken: cts.Token))
            .Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task SearchViewModel_AddsRemoteArticleResults_WhenFilterEnabled()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new ArticleService(http.Client);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            service)
        { SearchPhrase = "בראשית" };
        foreach (var filter in new[] { SearchFilter.Author, SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }
        // The remote kind is opt-in: enable it explicitly for this search.
        vm.SetFilterEnabled(SearchFilter.Articles, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        var articles = vm.SearchResults.OfType<ArticleSearchResult>().ToList();
        articles.Should().HaveCount(2);
        articles[0].ArticleId.Should().Be(11);
        articles[0].Title.Should().Be("מאמר ראשון");
        articles[0].Source.Should().Be("בראשית א");
        articles[0].ResultType.Should().Be(SearchFilter.Articles);
        articles[0].Category.Should().Be("תוכן מאמרים (חיבור רשת נדרש)");
        vm.IsLoading.Should().BeFalse();
        vm.AvailabilityMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task SearchViewModel_ArticleSearchFailure_SetsAvailabilityMessage_WithoutLosingLocalResults()
    {
        using var http = new GraphQLTransport();
        http.Respond = _ => throw new HttpRequestException("offline");
        var service = new ArticleService(http.Client);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            service)
        { SearchPhrase = "בראשית" };
        vm.SetAuthors([new Author { Id = 1, Name = "בראשית בוטנר", Details = "" }]);
        foreach (var filter in new[] { SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }
        vm.SetFilterEnabled(SearchFilter.Articles, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<AuthorSearchResult>();
        vm.AvailabilityMessage.Should().Contain("חיבור רשת");
        vm.ErrorMessage.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task SearchViewModel_DisabledArticleFilter_SkipsRemoteCall()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new ArticleService(http.Client);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            service)
        { SearchPhrase = "בראשית" };
        vm.SetAuthors([new Author { Id = 1, Name = "בראשית בוטנר", Details = "" }]);
        foreach (var filter in new[] { SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek, SearchFilter.Articles })
        {
            vm.SetFilterEnabled(filter, false);
        }

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        http.Requests.Should().BeEmpty();
        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<AuthorSearchResult>();
    }

    [Fact]
    public async Task SearchViewModel_ArticlesFilter_IsOptIn_NotEnabledByDefault()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new ArticleService(http.Client);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            service)
        { SearchPhrase = "בראשית" };

        vm.IsFilterEnabled(SearchFilter.Articles).Should().BeFalse();
        foreach (var filter in new[] { SearchFilter.Author, SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        http.Requests.Should().BeEmpty();
        vm.SearchResults.Should().NotContain(r => r is ArticleSearchResult);
    }

    [Fact]
    public async Task SearchViewModel_CancelledSearch_DropsStaleArticleResults()
    {
        var gate = new TaskCompletionSource<HttpResponseMessage>();
        using var http = new GraphQLTransport();
        // Each request gets its own response object after the gate — the
        // cancelled search's in-flight request and the live one must not share
        // a response stream, just like real network responses.
        http.Respond = async token =>
        {
            await gate.Task.WaitAsync(token);
            return GraphQLTransport.JsonResponse(SearchResponse);
        };
        var service = new ArticleService(http.Client);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            service)
        { SearchPhrase = "בראשית" };
        foreach (var filter in new[] { SearchFilter.Author, SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }
        vm.SetFilterEnabled(SearchFilter.Articles, true);

        var pending = vm.SearchAsync(TestContext.Current.CancellationToken);
        // Newer phrase cancels the in-flight search — the stale response must
        // never overwrite the next query's results.
        vm.SearchPhrase = "שמות";
        var latest = vm.SearchAsync(TestContext.Current.CancellationToken);
        gate.SetResult(GraphQLTransport.JsonResponse(SearchResponse));
        await Task.WhenAll(pending, latest);

        vm.SearchResults.Should().AllBeOfType<ArticleSearchResult>();
        vm.SearchResults.Should().HaveCount(2);
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public void ArticlesFilter_HasExactNetworkLabel()
    {
        SearchFilter.Articles.GetHebrewName().Should().Be("תוכן מאמרים (חיבור רשת נדרש)");
        new ArticleSearchResult(1, 2, "author", "בראשית א", "קטע", "q")
        {
            Title = "t",
            SubtitleHtml = "s"
        }.ResultType.Should().Be(SearchFilter.Articles);
    }
}
