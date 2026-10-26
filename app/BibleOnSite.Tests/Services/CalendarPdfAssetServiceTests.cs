using System.Net;
using BibleOnSite.Services;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

public class CalendarPdfAssetServiceTests
{
    private const string AssetsBase = "https://assets.example";

    private const string ManifestJson = """
        {
          "version": 1,
          "fingerprint": "fp",
          "generatedAt": "2026-10-26T00:00:00.000Z",
          "bounds": {},
          "artifacts": {
            "month:578512": {
              "object": "generated/calendar-pdf/objects/x.pdf",
              "sha256": "x",
              "bytes": 10,
              "filename": "learning-calendar-578512.pdf"
            },
            "cycle:4": {
              "object": "generated/calendar-pdf/objects/cycle4.pdf",
              "sha256": "y",
              "bytes": 999,
              "filename": "learning-calendar-cycle-4.pdf"
            }
          }
        }
        """;

    private sealed class StubHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> respond)
        : HttpMessageHandler
    {
        public List<Uri?> Requested { get; } = [];
        private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _respond = respond;

        public StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
            : this(req => Task.FromResult(respond(req)))
        {
        }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Requested.Add(request.RequestUri);
            return _respond(request);
        }
    }

    private static HttpResponseMessage Json(string body) =>
        new(HttpStatusCode.OK) { Content = new StringContent(body) };

    [Fact]
    public async Task TryResolve_MapsKeyToPublishedObjectUrl()
    {
        var handler = new StubHandler(_ => Json(ManifestJson));
        using var http = new HttpClient(handler);
        var service = new CalendarPdfAssetService(http, AssetsBase);

        var uri = await service.TryResolveAsync("cycle:4");

        uri.Should().Be(new Uri($"{AssetsBase}/generated/calendar-pdf/objects/cycle4.pdf"));
        handler.Requested.Should().Equal(new Uri($"{AssetsBase}/{CalendarPdfAssetService.ManifestObjectPath}"));
    }

    [Fact]
    public async Task TryResolve_UnknownKey_ReturnsNull()
    {
        var handler = new StubHandler(_ => Json(ManifestJson));
        using var http = new HttpClient(handler);
        var service = new CalendarPdfAssetService(http, AssetsBase);

        (await service.TryResolveAsync("cycle:99")).Should().BeNull();
    }

    [Fact]
    public async Task TryResolve_NonSuccessMalformedOrWrongVersion_ReturnsNull()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        using var http = new HttpClient(handler);
        var service = new CalendarPdfAssetService(http, AssetsBase);
        (await service.TryResolveAsync("cycle:4")).Should().BeNull();

        service = new CalendarPdfAssetService(
            new HttpClient(new StubHandler(_ => Json("not json"))), AssetsBase);
        (await service.TryResolveAsync("cycle:4")).Should().BeNull();

        service = new CalendarPdfAssetService(
            new HttpClient(new StubHandler(_ =>
                Json(ManifestJson.Replace("\"version\": 1", "\"version\": 2")))),
            AssetsBase);
        (await service.TryResolveAsync("cycle:4")).Should().BeNull();

        service = new CalendarPdfAssetService(
            new HttpClient(new StubHandler(_ =>
                Task.FromException<HttpResponseMessage>(new HttpRequestException("offline")))),
            AssetsBase);
        (await service.TryResolveAsync("cycle:4")).Should().BeNull();
    }

    [Fact]
    public async Task TryResolve_CachesManifestForTtl_OneFetchServesManyKeys()
    {
        var handler = new StubHandler(_ => Json(ManifestJson));
        using var http = new HttpClient(handler);
        var service = new CalendarPdfAssetService(http, AssetsBase);

        await service.TryResolveAsync("month:578512");
        await service.TryResolveAsync("cycle:4");
        await service.TryResolveAsync("cycle:99");

        handler.Requested.Should().HaveCount(1);
    }

    [Fact]
    public async Task TryResolve_AfterTtl_RefetchesManifest()
    {
        var handler = new StubHandler(_ => Json(ManifestJson));
        using var http = new HttpClient(handler);
        var service = new CalendarPdfAssetService(http, AssetsBase, TimeSpan.Zero);

        await service.TryResolveAsync("cycle:4");
        await service.TryResolveAsync("cycle:4");

        handler.Requested.Should().HaveCount(2);
    }

    [Fact]
    public async Task TryResolve_DedupesConcurrentLookupsOntoOneFetch()
    {
        var gate = new TaskCompletionSource<HttpResponseMessage>();
        var handler = new StubHandler(_ => gate.Task);
        using var http = new HttpClient(handler);
        var service = new CalendarPdfAssetService(http, AssetsBase);

        var pending = new[]
        {
            service.TryResolveAsync("cycle:4"),
            service.TryResolveAsync("month:578512"),
            service.TryResolveAsync("cycle:4"),
        };
        handler.Requested.Should().HaveCount(1);
        gate.SetResult(Json(ManifestJson));
        var results = await Task.WhenAll(pending);

        handler.Requested.Should().HaveCount(1);
        results[0].Should().Be(new Uri($"{AssetsBase}/generated/calendar-pdf/objects/cycle4.pdf"));
        results[1].Should().Be(new Uri($"{AssetsBase}/generated/calendar-pdf/objects/x.pdf"));
        results[2].Should().Be(results[0]);
    }

    [Fact]
    public async Task TryResolve_FailedFetch_IsNotCached_SoRetryHitsTheNetwork()
    {
        var attempts = 0;
        var handler = new StubHandler(_ =>
        {
            attempts++;
            return attempts == 1
                ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
                : Json(ManifestJson);
        });
        using var http = new HttpClient(handler);
        var service = new CalendarPdfAssetService(http, AssetsBase);

        (await service.TryResolveAsync("cycle:4")).Should().BeNull();
        var retried = await service.TryResolveAsync("cycle:4");

        retried.Should().Be(new Uri($"{AssetsBase}/generated/calendar-pdf/objects/cycle4.pdf"));
        handler.Requested.Should().HaveCount(2);
    }
}
