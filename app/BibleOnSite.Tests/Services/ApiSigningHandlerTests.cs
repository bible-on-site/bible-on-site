using System.Net;
using System.Text;
using BibleOnSite.Config;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// The signing side of the API access-gate contract (#3066): canonicalization
/// must match the API's verifier byte for byte — asserted via a shared golden
/// vector computed independently of both implementations.
/// </summary>
public class ApiSigningHandlerTests
{
    private const string GoldenKeyId = "poc-key-1";
    // Test-only golden vector for the byte-exact HMAC assertion — never a real credential.
    private const string GoldenSecret = "poc-secret-do-not-use-in-prod"; // nosemgrep
    private const long GoldenTimestamp = 1_770_000_000;
    private const string GoldenNonce = "01ab23cd45ef";
    private const string GoldenBody = "{\"query\":\"{ starter { generatedAt } }\"}";
    private const string GoldenSignature = "2aa0b630b4708872da3f898c176abf9bc577ac0e351565443816cd7a37fd2201";

    private sealed class CaptureHandler : HttpMessageHandler
    {
        public HttpRequestMessage? Request;
        public string? Body;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            Request = request;
            return new HttpResponseMessage(HttpStatusCode.OK);
        }
    }

    private static ApiSigningCredential Credential => new(GoldenKeyId, Encoding.UTF8.GetBytes(GoldenSecret));

    private static (ApiSigningHandler Signing, CaptureHandler Capture) HandlersFor(
        Func<CancellationToken, Task<ApiSigningCredential?>> resolver,
        Func<long>? clock = null,
        Func<string>? nonce = null)
    {
        var capture = new CaptureHandler();
        var signing = new ApiSigningHandler(
            resolver,
            clock ?? (() => GoldenTimestamp),
            nonce ?? (() => GoldenNonce),
            capture);
        return (signing, capture);
    }

    [Fact]
    public async Task Send_ProducesTheSharedCanonicalSignature()
    {
        var (signing, capture) = HandlersFor(_ => Task.FromResult<ApiSigningCredential?>(Credential));
        using var client = new HttpClient(signing);
        using var content = new StringContent(GoldenBody, Encoding.UTF8, "application/json");
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.test/")
        {
            Content = content
        };

        await client.SendAsync(request, TestContext.Current.CancellationToken);

        var signed = capture.Request!;
        signed.Headers.GetValues(ApiSigningHandler.KeyIdHeader).Should().Equal(GoldenKeyId);
        signed.Headers.GetValues(ApiSigningHandler.TimestampHeader).Should().Equal(GoldenTimestamp.ToString());
        signed.Headers.GetValues(ApiSigningHandler.NonceHeader).Should().Equal(GoldenNonce);
        // Must equal the API verifier's golden vector byte for byte.
        signed.Headers.GetValues(ApiSigningHandler.SignatureHeader).Should().Equal(GoldenSignature);
    }

    [Fact]
    public async Task Send_WithoutCredential_IsAnUnsignedPassThrough()
    {
        var (signing, capture) = HandlersFor(_ => Task.FromResult<ApiSigningCredential?>(null));
        using var client = new HttpClient(signing);
        using var content = new StringContent("{}", Encoding.UTF8, "application/json");
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.example.test/")
        {
            Content = content
        };

        await client.SendAsync(request, TestContext.Current.CancellationToken);

        var sent = capture.Request!;
        sent.Headers.Contains(ApiSigningHandler.SignatureHeader).Should().BeFalse();
        sent.Headers.Contains(ApiSigningHandler.KeyIdHeader).Should().BeFalse();
        capture.Body.Should().Be("{}");
    }

    [Fact]
    public async Task Send_ResolvesTheCredentialOnce()
    {
        var probes = 0;
        var (signing, _) = HandlersFor(_ =>
        {
            probes++;
            return Task.FromResult<ApiSigningCredential?>(Credential);
        });
        using var client = new HttpClient(signing);
        using var first = new StringContent("{}");
        using var second = new StringContent("{}");

        await client.PostAsync("https://api.example.test/", first, TestContext.Current.CancellationToken);
        await client.PostAsync("https://api.example.test/", second, TestContext.Current.CancellationToken);

        probes.Should().Be(1);
    }
}
