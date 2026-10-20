using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.Services;

public class TanahpediaSearchServiceTests
{
    private const string SearchResponse = """
        {"data":{"searchTanahpediaEntries":[
        {"id":"e1","uniqueName":"משה-רבנו","title":"משה רבנו","excerpt":"משה עלה להר סיני","score":220},
        {"id":"e2","uniqueName":"משה-בן-עמרם","title":"משה בן עמרם","excerpt":"נקרא גם: משה רבנו","score":160}]}}
        """;

    [Fact]
    public async Task SearchEntries_MapsHitsAndSendsVariables()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new TanahpediaService(http.Client);

        var hits = await service.SearchEntriesAsync("משה", 10, TestContext.Current.CancellationToken);

        hits.Should().HaveCount(2);
        hits[0].Id.Should().Be("e1");
        hits[0].UniqueName.Should().Be("משה-רבנו");
        hits[0].Title.Should().Be("משה רבנו");
        hits[0].Excerpt.Should().Be("משה עלה להר סיני");
        hits[0].Score.Should().Be(220);
        hits[1].UniqueName.Should().Be("משה-בן-עמרם");
        http.Requests.Single().Should().Contain("searchTanahpediaEntries");
        http.Requests.Single().Should().Contain("\"phrase\":\"משה\"");
        http.Requests.Single().Should().Contain("\"limit\":10");
    }

    [Fact]
    public async Task SearchEntries_ClampsOversizedLimit()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new TanahpediaService(http.Client);

        // Contract promises clamping to the API's 1-50 range — the request
        // must carry 50 rather than the caller's oversized value.
        await service.SearchEntriesAsync("משה", 100, TestContext.Current.CancellationToken);

        http.Requests.Single().Should().Contain("\"limit\":50");
    }

    [Fact]
    public async Task SearchEntries_GraphQlErrors_Throw()
    {
        using var http = new GraphQLTransport("{\"errors\":[{\"message\":\"limit out of range\"}]}");
        var service = new TanahpediaService(http.Client);
        await FluentActions.Awaiting(() => service.SearchEntriesAsync("x", 20, CancellationToken.None))
            .Should().ThrowAsync<GraphQLException>();
    }

    [Fact]
    public async Task SearchEntries_TransportFailure_Propagates()
    {
        using var http = new GraphQLTransport();
        http.Respond = _ => throw new HttpRequestException("offline");
        var service = new TanahpediaService(http.Client);
        await FluentActions.Awaiting(() => service.SearchEntriesAsync("x", 20, CancellationToken.None))
            .Should().ThrowAsync<Exception>();
    }

    [Fact]
    public async Task SearchEntries_TransportTimeout_ThrowsTimeoutException()
    {
        using var http = new GraphQLTransport();
        http.Respond = async token =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return GraphQLTransport.JsonResponse("{}");
        };
        var service = new TanahpediaService(http.Client, TimeSpan.FromMilliseconds(50));
        await FluentActions.Awaiting(() => service.SearchEntriesAsync("x", 20, CancellationToken.None))
            .Should().ThrowAsync<TimeoutException>();
    }

    [Fact]
    public async Task SearchEntries_CallerCancellation_ThrowsOperationCanceled()
    {
        using var http = new GraphQLTransport();
        http.Respond = async token =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, token);
            return GraphQLTransport.JsonResponse("{}");
        };
        var service = new TanahpediaService(http.Client);
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();
        await FluentActions.Awaiting(() => service.SearchEntriesAsync("x", 20, cts.Token))
            .Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task SearchViewModel_AddsRemoteTanahpediaResults_WhenFilterEnabled()
    {
        using var http = new GraphQLTransport(SearchResponse);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            null,
            new TanahpediaService(http.Client))
        { SearchPhrase = "משה" };
        foreach (var filter in new[] { SearchFilter.Author, SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }
        // The remote kind is opt-in: enable it explicitly for this search.
        vm.SetFilterEnabled(SearchFilter.Tanahpedia, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        var entries = vm.SearchResults.OfType<TanahpediaSearchResult>().ToList();
        entries.Should().HaveCount(2);
        entries[0].UniqueName.Should().Be("משה-רבנו");
        entries[0].Title.Should().Be("משה רבנו");
        entries[0].ResultType.Should().Be(SearchFilter.Tanahpedia);
        entries[0].Category.Should().Be("תנכפדיה (חיבור רשת נדרש)");
        entries[0].Score.Should().Be(220);
        entries[0].SubtitleHtml.Should().Contain("<b>משה</b>");
        vm.IsLoading.Should().BeFalse();
        vm.AvailabilityMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task SearchViewModel_TanahpediaSearchFailure_SetsAvailabilityMessage_WithoutLosingLocalResults()
    {
        using var http = new GraphQLTransport();
        http.Respond = _ => throw new HttpRequestException("offline");
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            null,
            new TanahpediaService(http.Client))
        { SearchPhrase = "בראשית" };
        vm.SetAuthors([new Author { Id = 1, Name = "בראשית בוטנר", Details = "" }]);
        foreach (var filter in new[] { SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }
        vm.SetFilterEnabled(SearchFilter.Tanahpedia, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<AuthorSearchResult>();
        // Same availability message the website reports for this provider.
        vm.AvailabilityMessage.Should().Be("חיפוש התנכפדיה אינו זמין כרגע");
        vm.ErrorMessage.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task SearchViewModel_DisabledTanahpediaFilter_SkipsRemoteCall()
    {
        using var http = new GraphQLTransport(SearchResponse);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            null,
            new TanahpediaService(http.Client))
        { SearchPhrase = "משה" };
        vm.SetAuthors([new Author { Id = 1, Name = "משה בוטנר", Details = "" }]);
        foreach (var filter in new[] { SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek, SearchFilter.Tanahpedia })
        {
            vm.SetFilterEnabled(filter, false);
        }

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        http.Requests.Should().BeEmpty();
        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<AuthorSearchResult>();
    }

    [Fact]
    public async Task SearchViewModel_TanahpediaFilter_IsOptIn_NotEnabledByDefault()
    {
        using var http = new GraphQLTransport(SearchResponse);
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            null,
            new TanahpediaService(http.Client))
        { SearchPhrase = "משה" };

        vm.IsFilterEnabled(SearchFilter.Tanahpedia).Should().BeFalse();
        foreach (var filter in new[] { SearchFilter.Author, SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        http.Requests.Should().BeEmpty();
        vm.SearchResults.Should().NotContain(result => result is TanahpediaSearchResult);
    }

    [Fact]
    public async Task SearchViewModel_CancelledSearch_DropsStaleTanahpediaResults()
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
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            null,
            new TanahpediaService(http.Client))
        { SearchPhrase = "משה" };
        foreach (var filter in new[] { SearchFilter.Author, SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }
        vm.SetFilterEnabled(SearchFilter.Tanahpedia, true);

        var pending = vm.SearchAsync(TestContext.Current.CancellationToken);
        // Newer phrase cancels the in-flight search — the stale response must
        // never overwrite the next query's results.
        vm.SearchPhrase = "אהרן";
        var latest = vm.SearchAsync(TestContext.Current.CancellationToken);
        gate.SetResult(GraphQLTransport.JsonResponse(SearchResponse));
        await Task.WhenAll(pending, latest);

        vm.SearchResults.Should().AllBeOfType<TanahpediaSearchResult>();
        vm.SearchResults.Should().HaveCount(2);
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task SearchViewModel_NullTanahpediaService_CompletesWithLocalResultsOnly()
    {
        // No service injected and no default fallback → the remote leg returns
        // null and the local pipeline still publishes normally.
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null,
            articleService: null,
            tanahpediaService: null)
        { SearchPhrase = "בראשית" };
        vm.SetAuthors([new Author { Id = 1, Name = "בראשית בוטנר", Details = "" }]);
        foreach (var filter in new[] { SearchFilter.Pasuk, SearchFilter.Perush, SearchFilter.Perek })
        {
            vm.SetFilterEnabled(filter, false);
        }
        vm.SetFilterEnabled(SearchFilter.Tanahpedia, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<AuthorSearchResult>();
        vm.AvailabilityMessage.Should().BeEmpty();
        vm.ErrorMessage.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public void TanahpediaFilter_HasNetworkLabel_AndResultMapsToCanonicalName()
    {
        SearchFilter.Tanahpedia.GetHebrewName().Should().Be("תנכפדיה (חיבור רשת נדרש)");
        SearchFilter.Tanahpedia.RequiresNetwork().Should().BeTrue();
        var result = new TanahpediaSearchResult("e1", "דתן-ואבירם", "נקרא גם: בני קרח", 220, "בני קרח")
        {
            Title = "דתן ואבירם",
            SubtitleHtml = "נקרא גם: <b>בני קרח</b>",
        };
        result.ResultType.Should().Be(SearchFilter.Tanahpedia);
        result.Category.Should().Contain("תנכפדיה");
        result.UniqueName.Should().Be("דתן-ואבירם");
    }
}

public class TanahpediaScopedSearchTests
{
    private const string SearchResponse = """
        {"data":{"searchTanahpediaEntries":[
        {"id":"e1","uniqueName":"משה-רבנו","title":"משה רבנו","excerpt":"","score":220}]}}
        """;

    [Fact]
    public async Task SearchEntries_SendsCategoryKeysVariable()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new TanahpediaService(http.Client);

        var hits = await service.SearchEntriesAsync("משה", 10, ["PERSON", "PROPHET"], TestContext.Current.CancellationToken);

        hits.Should().ContainSingle().Which.UniqueName.Should().Be("משה-רבנו");
        http.Requests.Single().Should().Contain("categories");
        http.Requests.Single().Should().Contain("PERSON").And.Contain("PROPHET");
    }

    [Fact]
    public async Task SearchEntries_EmptyOrNullCategories_SendNoScope()
    {
        using var http = new GraphQLTransport(SearchResponse);
        var service = new TanahpediaService(http.Client);

        await service.SearchEntriesAsync("משה", 10, [], TestContext.Current.CancellationToken);
        await service.SearchEntriesAsync("משה", 10, (IReadOnlyCollection<string>?)null, TestContext.Current.CancellationToken);

        http.Requests.Should().HaveCount(2);
        http.Requests.Should().OnlyContain(request => !request.Contains("\"categories\""));
    }
}
