using System.Text;
using GraphQL;
using GraphQL.Client.Http;
using GraphQL.Client.Serializer.Newtonsoft;
using BibleOnSite.Config;

namespace BibleOnSite.Services;

/// <summary>
/// Base service for GraphQL API communication.
/// </summary>
public abstract class BaseGraphQLService
{
    private readonly Lazy<GraphQLHttpClient> _client;

    protected BaseGraphQLService()
    {
        _client = new Lazy<GraphQLHttpClient>(() =>
            new GraphQLHttpClient(AppConfig.Instance.GetApiUrl(), new NewtonsoftJsonSerializer()));
    }

    protected GraphQLHttpClient Client => _client.Value;

    /// <summary>
    /// Executes a GraphQL query and returns the typed response.
    /// </summary>
    protected async Task<T?> QueryAsync<T>(string query, string? operationName = null, object? variables = null, CancellationToken cancellationToken = default)
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
    protected async Task<T?> QueryWithTimeoutAsync<T>(string query, TimeSpan timeout, string? operationName = null, object? variables = null)
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
