using System.Text.Json;
using System.Text.Json.Serialization;
using BibleOnSite.Config;

namespace BibleOnSite.Services;

/// <summary>
/// Resolves published calendar-PDF artifacts from the static manifest the
/// generator publishes to the shared assets bucket (#2622).
/// </summary>
public interface ICalendarPdfAssetResolver
{
    /// <summary>
    /// Returns the published object URL for a canonical artifact key
    /// ("cycle:4", "year:5785", "month:578512"), or null when the manifest is
    /// unreachable, malformed or lacks the key — callers then take the legacy
    /// /api/calendar-pdf compatibility path, which re-checks a fresh manifest
    /// server-side.
    /// </summary>
    Task<Uri?> TryResolveAsync(string artifactKey);
}

/// <summary>
/// Reads the published calendar-PDF manifest straight from the assets bucket
/// and maps canonical artifact keys onto their object URLs. The manifest is
/// fetched lazily — only when the user activates Download — cached briefly,
/// and concurrent lookups share a single in-flight GET. Nothing is fetched
/// while the calendar is browsed, and no per-download resolver/API call is
/// made for artifacts the manifest already publishes.
/// </summary>
public sealed class CalendarPdfAssetService : ICalendarPdfAssetResolver
{
    /// <summary>Bucket key of the publish-switch manifest (see calendar-pdf-plan.ts).</summary>
    public static string ManifestObjectPath => "generated/calendar-pdf/manifest.json";

    /// <summary>How long a fetched manifest stays hot before a lookup refetches it.</summary>
    private static readonly TimeSpan _manifestTtl = TimeSpan.FromSeconds(60);

    /// <summary>Bounded wait for the manifest — a slow fetch never stalls the download tap.</summary>
    private static readonly TimeSpan _manifestFetchTimeout = TimeSpan.FromSeconds(5);

    private static readonly Lazy<CalendarPdfAssetService> _instance = new(() =>
        new CalendarPdfAssetService(new HttpClient(), AppConfig.Instance.GetAssetsBaseUrl()));

    /// <summary>Singleton used by the XAML-created view model.</summary>
    public static CalendarPdfAssetService Instance => _instance.Value;

    private readonly HttpClient _http;
    private readonly string _assetsBaseUrl;
    private readonly TimeSpan _ttl;
    private readonly object _gate = new();
    private (DateTimeOffset FetchedAt, CalendarPdfManifestDocument Manifest)? _cached;
    private Task<CalendarPdfManifestDocument?>? _inFlight;

    internal CalendarPdfAssetService(HttpClient http, string assetsBaseUrl, TimeSpan? manifestTtl = null)
    {
        _http = http;
        _assetsBaseUrl = assetsBaseUrl.TrimEnd('/');
        _ttl = manifestTtl ?? _manifestTtl;
    }

    /// <inheritdoc />
    public async Task<Uri?> TryResolveAsync(string artifactKey)
    {
        var manifest = await GetManifestAsync();
        if (manifest?.Artifacts is null
            || !manifest.Artifacts.TryGetValue(artifactKey, out var artifact)
            || string.IsNullOrEmpty(artifact?.Object))
        {
            return null;
        }
        return new Uri($"{_assetsBaseUrl}/{artifact.Object}");
    }

    /// <summary>
    /// Returns the published manifest, or null when it is unreachable or
    /// malformed. Successful fetches are cached for the TTL; failures are not
    /// cached so the next tap retries a recovered connection, while concurrent
    /// lookups still share one request.
    /// </summary>
    private async Task<CalendarPdfManifestDocument?> GetManifestAsync()
    {
        Task<CalendarPdfManifestDocument?> task;
        lock (_gate)
        {
            if (_cached is { } hit && DateTimeOffset.UtcNow - hit.FetchedAt < _ttl)
            {
                return hit.Manifest;
            }
            task = _inFlight ??= FetchAndCacheAsync();
        }
        try
        {
            return await task;
        }
        finally
        {
            // Clear after awaiting rather than inside the fetch: a handler that
            // completes synchronously would otherwise leave _inFlight pointing
            // at the finished task forever.
            lock (_gate)
            {
                if (ReferenceEquals(_inFlight, task))
                {
                    _inFlight = null;
                }
            }
        }
    }

    private async Task<CalendarPdfManifestDocument?> FetchAndCacheAsync()
    {
        var manifest = await FetchManifestAsync();
        if (manifest is not null)
        {
            lock (_gate)
            {
                _cached = (DateTimeOffset.UtcNow, manifest);
            }
        }
        return manifest;
    }

    private async Task<CalendarPdfManifestDocument?> FetchManifestAsync()
    {
        try
        {
            using var timeout = new CancellationTokenSource(_manifestFetchTimeout);
            // The manifest is the publish switch — bypass shared HTTP caches.
            using var request = new HttpRequestMessage(
                HttpMethod.Get, $"{_assetsBaseUrl}/{ManifestObjectPath}");
            request.Headers.CacheControl = new System.Net.Http.Headers.CacheControlHeaderValue
            {
                NoCache = true,
                NoStore = true,
            };
            using var response = await _http.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }
            var json = await response.Content.ReadAsStringAsync(timeout.Token);
            var manifest = JsonSerializer.Deserialize(
                json, CalendarPdfManifestJsonContext.Default.CalendarPdfManifestDocument);
            return manifest?.Version == 1 ? manifest : null;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: manifest failure degrades to the legacy URL
        catch (Exception ex) //NOSONAR — manifest failure degrades to the legacy URL.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Calendar PDF manifest fetch failed: {ex.Message}");
            return null;
        }
    }
}

/// <summary>Wire shape of the published manifest (see calendar-pdf-manifest-model.ts).</summary>
internal sealed class CalendarPdfManifestDocument
{
    [JsonPropertyName("version")]
    public int Version { get; init; }

    [JsonPropertyName("artifacts")]
    public Dictionary<string, CalendarPdfManifestArtifactDocument>? Artifacts { get; init; }
}

internal sealed class CalendarPdfManifestArtifactDocument
{
    /// <summary>Bucket-relative object key the artifact body is published at.</summary>
    [JsonPropertyName("object")]
    public string? Object { get; init; }
}

[JsonSerializable(typeof(CalendarPdfManifestDocument))]
#pragma warning disable S2333 // System.Text.Json source generation supplies this partial implementation.
internal partial class CalendarPdfManifestJsonContext : JsonSerializerContext;
#pragma warning restore S2333
