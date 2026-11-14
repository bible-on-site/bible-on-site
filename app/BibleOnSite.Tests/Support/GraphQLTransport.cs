using System.Net;
using System.Text;
using GraphQL.Client.Http;
using System.Text.Json.Serialization.Metadata;
using BibleOnSite.Services;

namespace BibleOnSite.Tests.Support;

/// <summary>Exercises the real GraphQL serialization/client pipeline with a deterministic HTTP boundary.</summary>
public sealed class GraphQLTransport : HttpMessageHandler
{
    public List<string> Requests { get; } = [];
    public Func<CancellationToken, Task<HttpResponseMessage>> Respond { get; set; }
    public GraphQLHttpClient Client { get; }

    public GraphQLTransport() : this("{\"data\":null}")
    {
    }

    public GraphQLTransport(string json) : this(json, [])
    {
    }

    /// <summary>Adds source-generated metadata for test-only response types.</summary>
    public GraphQLTransport(string json, params IJsonTypeInfoResolver[] extraTypes)
    {
        Respond = _ => Task.FromResult(JsonResponse(json));
        var serializer = BaseGraphQLService.CreateSerializer();
        foreach (var resolver in extraTypes)
        {
            serializer.Options.TypeInfoResolverChain.Add(resolver);
        }
        Client = new GraphQLHttpClient(new GraphQLHttpClientOptions
        {
            EndPoint = new Uri("https://api.example.test/graphql")
        }, serializer, new HttpClient(this));
    }

    public static HttpResponseMessage JsonResponse(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json")
    };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
        return await Respond(cancellationToken);
    }
}
