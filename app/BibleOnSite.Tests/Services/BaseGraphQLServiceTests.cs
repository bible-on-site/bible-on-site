using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using GraphQL.Client.Http;

namespace BibleOnSite.Tests.Services;

public class BaseGraphQLServiceTests
{
    private sealed class QueryService(GraphQLHttpClient client) : BaseGraphQLService(client)
    {
        public Task<Result?> Query(CancellationToken token = default) =>
            QueryAsync<Result>("query Value($id: Int!) { value(id: $id) }", "Value", new { id = 7 }, token);
        public Task<Result?> QueryWithTimeout(TimeSpan timeout) =>
            QueryWithTimeoutAsync<Result>("query { value }", timeout);
    }
    public sealed class Result { public int Value { get; set; } }

    [Fact]
    public async Task Query_SerializesOperationAndVariables_AndReturnsTypedData()
    {
        using var http = new GraphQLTransport("{\"data\":{\"value\":42}}");
        var result = await new QueryService(http.Client).Query();
        result!.Value.Should().Be(42);
        http.Requests.Single().Should().Contain("\"operationName\":\"Value\"").And.Contain("\"id\":7");
    }

    [Fact]
    public async Task Query_CombinesGraphQlErrors_AndThrowsDomainException()
    {
        using var http = new GraphQLTransport("{\"errors\":[{\"message\":\"first\"},{\"message\":\"second\"}]}");
        await FluentActions.Awaiting(() => new QueryService(http.Client).Query())
            .Should().ThrowAsync<GraphQLException>().WithMessage("first, second");
    }

    [Fact]
    public async Task Query_PropagatesTransportFailures()
    {
        using var http = new GraphQLTransport();
        http.Respond = _ => throw new HttpRequestException("connection lost");
        await FluentActions.Awaiting(() => new QueryService(http.Client).Query())
            .Should().ThrowAsync<HttpRequestException>().WithMessage("connection lost");
    }

    [Fact]
    public async Task Timeout_CancelsPendingHttpRequest()
    {
        using var http = new GraphQLTransport();
        http.Respond = async token =>
        {
            await Task.Delay(Timeout.Infinite, token);
            return GraphQLTransport.JsonResponse("{}");
        };
        await FluentActions.Awaiting(() => new QueryService(http.Client).QueryWithTimeout(TimeSpan.FromMilliseconds(30)))
            .Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task Query_HandlesNullDataAndEmptyErrors()
    {
        using var http = new GraphQLTransport("{\"data\":null,\"errors\":[]}");
        (await new QueryService(http.Client).Query()).Should().BeNull();
    }
}
