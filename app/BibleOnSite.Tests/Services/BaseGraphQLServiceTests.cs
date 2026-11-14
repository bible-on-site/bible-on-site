using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using System.Text.Json.Serialization;
using GraphQL;
using GraphQL.Client.Http;

namespace BibleOnSite.Tests.Services;

public class BaseGraphQLServiceTests
{
    private sealed class QueryService(GraphQLHttpClient client) : BaseGraphQLService(client)
    {
        public Task<Result?> Query(CancellationToken token = default) =>
            QueryAsync<Result>("query Value($id: Int!) { value(id: $id) }", "Value", new Dictionary<string, object?> { ["id"] = 7 }, token);
        public Task<Result?> QueryWithTimeout(TimeSpan timeout) =>
            QueryWithTimeoutAsync<Result>("query { value }", timeout, null);
    }
    public sealed class Result { public int Value { get; set; } }

    private static readonly ResultJsonContext ResultTypes = ResultJsonContext.Default;

    [Fact]
    public async Task Query_SerializesOperationAndVariables_AndReturnsTypedData()
    {
        using var http = new GraphQLTransport("{\"data\":{\"value\":42}}", ResultTypes);
        var result = await new QueryService(http.Client).Query(TestContext.Current.CancellationToken);
        result!.Value.Should().Be(42);
        http.Requests.Single().Should().Contain("\"operationName\":\"Value\"").And.Contain("\"id\":7");
    }

    [Fact]
    public async Task Query_CombinesGraphQlErrors_AndThrowsDomainException()
    {
        using var http = new GraphQLTransport("{\"errors\":[{\"message\":\"first\"},{\"message\":\"second\"}]}", ResultTypes);
        await FluentActions.Awaiting(() => new QueryService(http.Client).Query())
            .Should().ThrowAsync<GraphQLException>().WithMessage("first, second");
    }

    [Fact]
    public async Task Query_PropagatesTransportFailures()
    {
        using var http = new GraphQLTransport("{\"data\":null}", ResultTypes);
        http.Respond = _ => throw new HttpRequestException("connection lost");
        await FluentActions.Awaiting(() => new QueryService(http.Client).Query())
            .Should().ThrowAsync<HttpRequestException>().WithMessage("connection lost");
    }

    [Fact]
    public async Task Timeout_CancelsPendingHttpRequest()
    {
        using var http = new GraphQLTransport("{\"data\":null}", ResultTypes);
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
        using var http = new GraphQLTransport("{\"data\":null,\"errors\":[]}", ResultTypes);
        (await new QueryService(http.Client).Query(TestContext.Current.CancellationToken)).Should().BeNull();
    }
}

[JsonSerializable(typeof(GraphQLResponse<BaseGraphQLServiceTests.Result>))]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
internal partial class ResultJsonContext : JsonSerializerContext;
#pragma warning restore S2333
