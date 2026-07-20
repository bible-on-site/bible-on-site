using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using BibleOnSite.Models;
using BibleOnSite.Services;
using GraphQL.Client.Http;
using GraphQL.Client.Serializer.Newtonsoft;

namespace BibleOnSite.Tests.Services;

public class ArticleServiceTests
{
    [Fact]
    public async Task GetArticlesByPerekIdAsync_maps_articles_and_orders_by_priority()
    {
        await using var server = new GraphQLStubServer(_ => """
            {
              "data": {
                "articlesByPerekId": [
                  {
                    "id": 2,
                    "perekId": 9,
                    "authorId": 1,
                    "abstract": null,
                    "name": null,
                    "priority": 20
                  },
                  {
                    "id": 1,
                    "perekId": 9,
                    "authorId": 2,
                    "abstract": "<H1>First</H1>",
                    "name": "first article",
                    "priority": 10
                  }
                ]
              }
            }
            """);
        var service = CreateService(server.Url);

        var articles = await service.GetArticlesByPerekIdAsync(9);

        articles.Select(article => article.Id).Should().Equal(1, 2);
        articles[0].Abstract.Should().Be("<H1>First</H1>");
        articles[0].Name.Should().Be("first article");
        articles[1].Abstract.Should().BeEmpty();
        articles[1].Name.Should().BeEmpty();
        server.RequestBody.Should().Contain("ArticlesByPerekId");
        server.RequestBody.Should().Contain("\"perekId\":9");
    }

    [Fact]
    public async Task GetArticleByIdAsync_maps_article_content()
    {
        await using var server = new GraphQLStubServer(_ => """
            {
              "data": {
                "articleById": {
                  "id": 42,
                  "perekId": 7,
                  "authorId": 3,
                  "abstract": null,
                  "articleContent": "<p>full article</p>",
                  "name": null,
                  "priority": 4
                }
              }
            }
            """);
        var service = CreateService(server.Url);

        var article = await service.GetArticleByIdAsync(42);

        article.Should().NotBeNull();
        article!.Id.Should().Be(42);
        article.Abstract.Should().BeEmpty();
        article.ArticleContent.Should().Be("<p>full article</p>");
        article.Name.Should().BeEmpty();
        article.Priority.Should().Be(4);
        server.RequestBody.Should().Contain("ArticleById");
        server.RequestBody.Should().Contain("\"id\":42");
    }

    [Fact]
    public async Task GetArticleByIdAsync_returns_null_when_api_returns_no_article()
    {
        await using var server = new GraphQLStubServer(_ => """
            {
              "data": {
                "articleById": null
              }
            }
            """);
        var service = CreateService(server.Url);

        var article = await service.GetArticleByIdAsync(404);

        article.Should().BeNull();
    }

    [Fact]
    public async Task GetArticlesByAuthorIdAsync_returns_empty_when_graphql_returns_errors()
    {
        await using var server = new GraphQLStubServer(_ => """
            {
              "errors": [
                { "message": "author unavailable" }
              ],
              "data": {
                "articlesByAuthorId": null
              }
            }
            """);
        var service = CreateService(server.Url);

        var articles = await service.GetArticlesByAuthorIdAsync(12);

        articles.Should().BeEmpty();
    }

    [Fact]
    public async Task GetArticlesByPerekIdAsync_returns_empty_when_http_request_fails()
    {
        var service = CreateService($"http://127.0.0.1:{GetUnusedPort()}/graphql");

        var articles = await service.GetArticlesByPerekIdAsync(9);

        articles.Should().BeEmpty();
    }

    private static ArticleService CreateService(string url)
    {
        var constructor = typeof(ArticleService).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            types: Type.EmptyTypes,
            modifiers: null);

        constructor.Should().NotBeNull();
        var service = (ArticleService)constructor!.Invoke(null);

        var clientField = typeof(BaseGraphQLService).GetField(
            "_client",
            BindingFlags.Instance | BindingFlags.NonPublic);

        clientField.Should().NotBeNull();
        clientField!.SetValue(
            service,
            new Lazy<GraphQLHttpClient>(() =>
                new GraphQLHttpClient(url, new NewtonsoftJsonSerializer())));

        return service;
    }

    private static int GetUnusedPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private sealed class GraphQLStubServer : IAsyncDisposable
    {
        private readonly TcpListener _listener;
        private readonly Func<string, string> _respond;
        private readonly CancellationTokenSource _cts = new();
        private readonly Task _serverTask;

        public GraphQLStubServer(Func<string, string> respond)
        {
            _respond = respond;
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            Url = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}/graphql";
            _serverTask = Task.Run(ServeOneRequestAsync);
        }

        public string Url { get; }

        public string? RequestBody { get; private set; }

        public async ValueTask DisposeAsync()
        {
            _cts.Cancel();
            _listener.Stop();

            try
            {
                await _serverTask;
            }
            catch (OperationCanceledException)
            {
            }
            catch (ObjectDisposedException)
            {
            }

            _cts.Dispose();
        }

        private async Task ServeOneRequestAsync()
        {
            using var client = await _listener.AcceptTcpClientAsync(_cts.Token);
            await using var stream = client.GetStream();

            RequestBody = await ReadRequestBodyAsync(stream);
            var payload = Encoding.UTF8.GetBytes(_respond(RequestBody));
            var header = Encoding.ASCII.GetBytes(
                "HTTP/1.1 200 OK\r\n" +
                "Content-Type: application/json\r\n" +
                $"Content-Length: {payload.Length}\r\n" +
                "Connection: close\r\n\r\n");

            await stream.WriteAsync(header, _cts.Token);
            await stream.WriteAsync(payload, _cts.Token);
        }

        private static async Task<string> ReadRequestBodyAsync(NetworkStream stream)
        {
            var buffer = new byte[8192];
            var received = new List<byte>();

            while (true)
            {
                var count = await stream.ReadAsync(buffer);
                if (count == 0)
                    break;

                received.AddRange(buffer.Take(count));
                var request = Encoding.UTF8.GetString(received.ToArray());
                var headerEnd = request.IndexOf("\r\n\r\n", StringComparison.Ordinal);
                if (headerEnd < 0)
                    continue;

                var headers = request[..headerEnd];
                var contentLength = headers
                    .Split("\r\n")
                    .Select(line => line.Split(':', 2))
                    .Where(parts => parts.Length == 2)
                    .Where(parts => parts[0].Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                    .Select(parts => int.Parse(parts[1].Trim()))
                    .SingleOrDefault();
                var bodyStart = headerEnd + 4;
                var bodyBytesRead = received.Count - bodyStart;
                if (bodyBytesRead >= contentLength)
                    return Encoding.UTF8.GetString(received.Skip(bodyStart).Take(contentLength).ToArray());
            }

            return string.Empty;
        }
    }
}
