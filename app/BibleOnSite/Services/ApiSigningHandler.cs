using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using BibleOnSite.Config;

namespace BibleOnSite.Services;

/// <summary>
/// Signs outgoing API requests for the access gate (#3066) with
/// HMAC-SHA256 over the canonical string
/// <c>v1\n&lt;key-id&gt;\n&lt;METHOD&gt;\n&lt;path&gt;\n&lt;unix-timestamp&gt;\n&lt;nonce&gt;\n&lt;hex-sha256(body)&gt;</c>,
/// sent as <c>x-api-key-id</c>/<c>x-api-timestamp</c>/<c>x-api-nonce</c>/<c>x-api-signature</c>.
/// Without a packaged/env credential the handler is a pass-through — unsigned
/// builds (dev, DEBUG packages) keep working while the API gate observes.
/// The credential is resolved once: a packaged asset cannot appear mid-run.
/// </summary>
public sealed class ApiSigningHandler : DelegatingHandler
{
    /// <summary>Header names shared with the API's signature verification.</summary>
    public static string KeyIdHeader { get; } = "x-api-key-id";
    public static string TimestampHeader { get; } = "x-api-timestamp";
    public static string NonceHeader { get; } = "x-api-nonce";
    public static string SignatureHeader { get; } = "x-api-signature";

    private const string SigningVersion = "v1";

    private readonly Func<CancellationToken, Task<ApiSigningCredential?>> _credentialResolver;
    private readonly Func<long> _unixSeconds;
    private readonly Func<string> _nonceFactory;
    private ApiSigningCredential? _credential;
    private bool _credentialResolved;

    /// <summary>Production constructor: resolves the packaged/env credential lazily per send.</summary>
    public ApiSigningHandler(Func<CancellationToken, Task<ApiSigningCredential?>> credentialResolver)
        : this(credentialResolver, () => DateTimeOffset.UtcNow.ToUnixTimeSeconds(), () => Guid.NewGuid().ToString("N"))
    {
    }

    /// <summary>Test constructor: injectable clock and nonce for deterministic signatures.</summary>
    internal ApiSigningHandler(
        Func<CancellationToken, Task<ApiSigningCredential?>> credentialResolver,
        Func<long> unixSeconds,
        Func<string> nonceFactory,
        HttpMessageHandler? innerHandler = null)
    {
        _credentialResolver = credentialResolver;
        _unixSeconds = unixSeconds;
        _nonceFactory = nonceFactory;
        InnerHandler = innerHandler ?? new HttpClientHandler();
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var credential = await ResolveCredentialAsync(cancellationToken);
        if (credential is null)
        {
            return await base.SendAsync(request, cancellationToken);
        }

        var body = request.Content is null
            ? Array.Empty<byte>()
            : await request.Content.ReadAsByteArrayAsync(cancellationToken);
        var timestamp = _unixSeconds();
        var nonce = _nonceFactory();
        var canonical = string.Join('\n',
            SigningVersion,
            credential.KeyId,
            request.Method.Method,
            request.RequestUri?.AbsolutePath ?? "/",
            timestamp.ToString(CultureInfo.InvariantCulture),
            nonce,
            Convert.ToHexString(SHA256.HashData(body)).ToLowerInvariant());
        var signature = Convert.ToHexString(HMACSHA256.HashData(credential.Secret, Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();

        request.Headers.TryAddWithoutValidation(KeyIdHeader, credential.KeyId);
        request.Headers.TryAddWithoutValidation(TimestampHeader, timestamp.ToString(CultureInfo.InvariantCulture));
        request.Headers.TryAddWithoutValidation(NonceHeader, nonce);
        request.Headers.TryAddWithoutValidation(SignatureHeader, signature);
        return await base.SendAsync(request, cancellationToken);
    }

    /// <summary>
    /// Resolves the credential once — a missing packaged asset means this
    /// build stays unsigned for its whole lifetime, so absence is cached too.
    /// </summary>
    private async Task<ApiSigningCredential?> ResolveCredentialAsync(CancellationToken cancellationToken)
    {
        if (!_credentialResolved)
        {
            _credential = await _credentialResolver(cancellationToken);
            _credentialResolved = true;
        }
        return _credential;
    }
}
