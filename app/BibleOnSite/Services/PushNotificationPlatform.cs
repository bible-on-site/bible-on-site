#if MAUI
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BibleOnSite.Services;

/// <summary>DELETE body for the device-registration route — a named record so
/// source-gen serialization works in trimmed builds and tests.</summary>
public sealed record PushDeviceUnregistration(string UserId);

/// <summary>Source-gen context for the push device-registration contract —
/// reflection-based serialization is unavailable in trimmed release builds
/// (and disabled in the test host to catch exactly this).</summary>
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(PushDeviceRegistration))]
[JsonSerializable(typeof(PushDeviceUnregistration))]
internal partial class PushJsonContext : JsonSerializerContext;

/// <summary>
/// Durable push-state store honoring the #1097 no-Advertising-ID design: on
/// iOS the notification user id lives in Keychain (<see cref="ISecureStorage"/>)
/// and survives reinstall; on Android and other MAUI platforms it lives in
/// preferences (<see cref="IPreferences"/>), which Auto Backup restores.
/// </summary>
public sealed class MauiPushStateStore : IPushStateStore
{
    private readonly ISecureStorage _secure;
    private readonly IPreferences _preferences;
    private readonly bool _useSecure;

    public MauiPushStateStore() : this(
        SecureStorage.Default,
        Preferences.Default,
#if IOS
        useSecure: true)
#else
        useSecure: false)
#endif
    {
    }

    /// <summary>Test seam — injects the platform stores and the iOS/Android choice.</summary>
    internal MauiPushStateStore(ISecureStorage secure, IPreferences preferences, bool useSecure)
    {
        _secure = secure;
        _preferences = preferences;
        _useSecure = useSecure;
    }

    public async Task<string?> GetAsync(string key, CancellationToken ct)
    {
        if (_useSecure)
        {
            try
            {
                return await _secure.GetAsync(key).WaitAsync(ct);
            }
            #pragma warning disable S2221 // Deliberate failure boundary: a corrupt Keychain entry reads as absent
            catch (Exception ex) when (ex is not OperationCanceledException) //NOSONAR — a corrupt Keychain entry reads as absent.
            {
                #pragma warning restore S2221
                // A Keychain entry written by an older build can fail to decode —
                // treat as absent so identity resolution re-seeds it.
                Console.Error.WriteLine($"[Push] keychain read failed: {ex.Message}");
                return null;
            }
        }
        return _preferences.Get<string?>(key, null);
    }

    public async Task SetAsync(string key, string value, CancellationToken ct)
    {
        if (_useSecure)
        {
            await _secure.SetAsync(key, value).WaitAsync(ct);
            return;
        }
        _preferences.Set(key, value);
    }

#pragma warning disable S1172 // Interface contract keeps ct; preferences/Keychain remove is synchronous.
    public Task RemoveAsync(string key, CancellationToken ct)
    {
        if (_useSecure)
        {
            _secure.Remove(key);
        }
        else
        {
            _preferences.Remove(key);
        }
        return Task.CompletedTask;
    }
#pragma warning restore S1172
}

/// <summary>
/// HTTP client for the documented device-registration contract — see
/// docs/app/push-notifications.md. <c>POST /api/push/device</c> upserts the
/// (user, installation, token) row; <c>DELETE</c> with <c>{userId}</c> removes
/// it (same body convention as the web-push subscription route).
/// </summary>
public sealed class HttpPushDeviceRegistry : IPushDeviceRegistry
{
    private readonly HttpClient _http;
    private readonly Func<string> _baseUrl;

    public HttpPushDeviceRegistry(Func<string> baseUrl) : this(new HttpClient(), baseUrl) { }

    /// <summary>Test seam — injects the transport.</summary>
    internal HttpPushDeviceRegistry(HttpClient http, Func<string> baseUrl)
    {
        _http = http;
        _baseUrl = baseUrl;
    }

    public async Task RegisterAsync(PushDeviceRegistration registration, CancellationToken ct)
    {
        using var response = await _http.PostAsJsonAsync(
            $"{_baseUrl()}/api/push/device",
            registration,
            PushJsonContext.Default.PushDeviceRegistration,
            ct);
        response.EnsureSuccessStatusCode();
    }

    public async Task UnregisterAsync(string userId, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"{_baseUrl()}/api/push/device")
        {
            Content = JsonContent.Create(
                new PushDeviceUnregistration(userId),
                PushJsonContext.Default.PushDeviceUnregistration),
        };
        using var response = await _http.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
    }
}
#endif
