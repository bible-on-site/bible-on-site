using System.Net;
using System.Text;
using GraphQL.Client.Http;
using GraphQL.Client.Serializer.Newtonsoft;

namespace BibleOnSite.Tests.Support;

/// <summary>Exercises the real GraphQL serialization/client pipeline with a deterministic HTTP boundary.</summary>
public sealed class GraphQLTransport : HttpMessageHandler
{
    public List<string> Requests { get; } = [];
    public Func<CancellationToken, Task<HttpResponseMessage>> Respond { get; set; }
    public GraphQLHttpClient Client { get; }

    public GraphQLTransport(string json = "{\"data\":null}")
    {
        Respond = _ => Task.FromResult(JsonResponse(json));
        Client = new GraphQLHttpClient(new GraphQLHttpClientOptions
        {
            EndPoint = new Uri("https://api.example.test/graphql")
        }, new NewtonsoftJsonSerializer(), new HttpClient(this));
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
