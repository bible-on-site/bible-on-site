using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;
using GraphQL;
using GraphQL.Client.Http;
using GraphQL.Client.Serializer.SystemTextJson;
using BibleOnSite.Config;

namespace BibleOnSite.Services;

/// <summary>
/// Base service for GraphQL API communication.
/// </summary>
public abstract class BaseGraphQLService
{
    private static readonly SystemTextJsonSerializer SharedSerializer = CreateSerializer();

    private readonly Lazy<GraphQLHttpClient> _client;

    protected BaseGraphQLService()
    {
        _client = new Lazy<GraphQLHttpClient>(() =>
            new GraphQLHttpClient(AppConfig.Instance.GetApiUrl(), SharedSerializer));
    }

    /// <summary>
    /// Creates the GraphQL serializer. All request/response metadata comes from
    /// <see cref="GraphQLJsonContext"/>, so no reflection runs on the startup path.
    /// The serializer itself adds case-insensitive matching and its Map/ErrorPath converters.
    /// </summary>
    internal static SystemTextJsonSerializer CreateSerializer() => new(new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        // Keep Hebrew variables readable in the request body (Newtonsoft never escaped them).
        Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
        TypeInfoResolverChain = { GraphQLJsonContext.Default }
    });

    protected GraphQLHttpClient Client => _client.Value;

    protected BaseGraphQLService(GraphQLHttpClient client)
    {
        _client = new Lazy<GraphQLHttpClient>(() => client);
    }

    /// <summary>
    /// Executes a GraphQL query and returns the typed response.
    /// </summary>
    protected async Task<T?> QueryAsync<T>(string query, string? operationName, Dictionary<string, object?>? variables, CancellationToken cancellationToken)
    {
        var request = new GraphQLRequest
        {
            Query = query,
            OperationName = operationName,
            Variables = variables
        };

        try
        {
            var response = await Client.SendQueryAsync<T>(request, cancellationToken);

            if (response.Errors?.Any() == true)
            {
                var errorMessages = string.Join(", ", response.Errors.Select(e => e.Message));
                Console.Error.WriteLine($"GraphQL errors: {errorMessages}");
                throw new GraphQLException(errorMessages);
            }

            return response.Data;
        }
        catch (Exception ex) when (ex is not GraphQLException)
        {
            Console.Error.WriteLine($"GraphQL query failed: {ex.Message}");
            throw;
        }
    }

    /// <summary>
    /// Executes a GraphQL query with timeout support.
    /// </summary>
    protected async Task<T?> QueryWithTimeoutAsync<T>(string query, TimeSpan timeout, string? operationName) =>
        await QueryWithTimeoutAsync<T>(query, timeout, operationName, null);

    /// <summary>
    /// Executes a GraphQL query with timeout support.
    /// </summary>
    protected async Task<T?> QueryWithTimeoutAsync<T>(string query, TimeSpan timeout, string? operationName, Dictionary<string, object?>? variables)
    {
        using var cts = new CancellationTokenSource(timeout);
        return await QueryAsync<T>(query, operationName, variables, cts.Token);
    }
}

/// <summary>
/// Exception thrown when GraphQL operations fail.
/// </summary>
public class GraphQLException : Exception
{
    public GraphQLException(string message) : base(message) { }
    public GraphQLException(string message, Exception innerException) : base(message, innerException) { }
}

/// <summary>
/// Source-generated metadata for every GraphQL request and response the app sends or receives.
/// </summary>
[JsonSerializable(typeof(GraphQLRequest))]
[JsonSerializable(typeof(Dictionary<string, object>))]
[JsonSerializable(typeof(string))]
[JsonSerializable(typeof(string[]))]
[JsonSerializable(typeof(int))]
[JsonSerializable(typeof(GraphQLResponse<StarterService.StarterResponse>))]
[JsonSerializable(typeof(GraphQLResponse<ArticleService.ArticlesByPerekIdResponse>))]
[JsonSerializable(typeof(GraphQLResponse<ArticleService.ArticleByIdResponse>))]
[JsonSerializable(typeof(GraphQLResponse<ArticleService.ArticlesByAuthorIdResponse>))]
[JsonSerializable(typeof(GraphQLResponse<ArticleService.SearchArticlesResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.EntriesResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.RecentEntriesResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.EntryDetailResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.SearchHitsResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.SynonymTargetsResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.CategoryCountsResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.EntitiesResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.TodayEntitiesResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.CategoryHomepageResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.PersonFamilyResponse>))]
[JsonSerializable(typeof(GraphQLResponse<TanahpediaService.PlaceMarkersResponse>))]
[JsonSerializable(typeof(GraphQLResponse<DedicationService.DedicationsResponse>))]
[JsonSerializable(typeof(Models.DedicationContext))]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
internal partial class GraphQLJsonContext : JsonSerializerContext;
#pragma warning restore S2333
