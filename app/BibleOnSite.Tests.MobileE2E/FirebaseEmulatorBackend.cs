using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using BibleOnSite.Services;
using BibleOnSite.Tests.MobileE2E.Configuration;

namespace BibleOnSite.Tests.MobileE2E;

/// <summary>
/// Host-side client for the Firebase Emulator Suite that verifies what the
/// app's native adapters produced (#3185). The suite never points the app at
/// production: the same <c>MOBILE_FIREBASE_EMULATOR</c> endpoint that gated
/// the scenario in also addresses every assertion here.
///
/// Emulator REST conventions used below:
/// - Firestore documents: <c>…/v1/projects/{p}/databases/(default)/documents/…</c>.
///   <c>Authorization: Bearer owner</c> is the emulator's documented
///   rules-bypass token, so owner reads observe the committed truth while
///   security rules still gate the app's own traffic.
/// - Auth administration: <c>…/identitytoolkit.googleapis.com/v1/…</c>, with
///   <c>Bearer owner</c> for the batchGet listing.
/// - Disposable-data cleanup: <c>DELETE /emulator/v1/projects/{p}/…</c> wipes
///   the Firestore database and every Auth account without a restart.
/// </summary>
internal sealed class FirebaseEmulatorBackend : IDisposable
{
    public const string ProjectId = "tanah-al-haperek";

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };

    // Public on an internal class: callers still go through Create, which is
    // the configuration-parsing gate — this only satisfies the analyzer.
    public FirebaseEmulatorBackend(string host, int authPort, int firestorePort)
    {
        Host = host;
        AuthBase = new Uri($"http://{host}:{authPort}");
        FirestoreBase = new Uri($"http://{host}:{firestorePort}");
    }

    public string Host { get; }
    public Uri AuthBase { get; }
    public Uri FirestoreBase { get; }

    /// <summary>The host the device under test must dial. An Android
    /// emulator's host loopback is 10.0.2.2; an iOS simulator shares the
    /// runner's loopback, so the host value applies unchanged.</summary>
#pragma warning disable S1313 // AVD's host-loopback alias — the endpoint is the local Emulator Suite, never a routable address.
    public string DeviceHost(MobilePlatform platform) =>
        platform == MobilePlatform.Android && IsLoopback(Host) ? "10.0.2.2" : Host;
#pragma warning restore S1313

    /// <summary>The endpoint as the device under test must dial it.</summary>
    public string DeviceEndpoint(MobilePlatform platform) =>
        $"{DeviceHost(platform)}:{AuthBase.Port}:{FirestoreBase.Port}";

    private static bool IsLoopback(string host) =>
        host is "127.0.0.1" or "localhost" or "::1" or "[::1]";

    /// <summary>Parses <see cref="MobileTestConfiguration.FirebaseEmulator"/>;
    /// returns null when unset or malformed — callers skip on null.</summary>
    public static FirebaseEmulatorBackend? Create(MobileTestConfiguration configuration)
    {
        if (FirebaseEmulatorEndpoint.Parse(configuration.FirebaseEmulator) is not { } endpoint)
        {
            return null;
        }
        return new FirebaseEmulatorBackend(endpoint.Host, endpoint.AuthPort, endpoint.FirestorePort);
    }

    // ---------- Firestore document surface ----------

    private string DocumentsPath => $"/v1/projects/{ProjectId}/databases/(default)/documents";

    /// <summary>Owner read of <c>users/{uid}</c>: the committed document the
    /// rules would never hand to a stranger. Null while absent.</summary>
    public async Task<JsonDocument?> UserDocumentAsync(string userId)
    {
        using var request = OwnerRequest(HttpMethod.Get, $"{FirestoreBase}{DocumentsPath}/users/{userId}");
        using var response = await _http.SendAsync(request);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonDocument>();
    }

    /// <summary>The <c>entries</c> map of the committed document.</summary>
    public static bool TryGetEntry(JsonDocument? document, string key, out JsonElement entry)
    {
        entry = default;
        return document != null
            && document.RootElement.TryGetProperty("fields", out var fields)
            && fields.TryGetProperty("entries", out var entries)
            && entries.TryGetProperty("mapValue", out var map)
            && map.TryGetProperty("fields", out var mapFields)
            && mapFields.TryGetProperty(key, out entry);
    }

    /// <summary>Reads the primitive <c>value</c> field of a stored entry.</summary>
    public static bool TryReadValue(JsonElement entry, out JsonElement value)
    {
        value = default;
        return entry.TryGetProperty("mapValue", out var map)
            && map.TryGetProperty("fields", out var fields)
            && fields.TryGetProperty("value", out value);
    }

    /// <summary>Polls the committed document until <paramref name="satisfied"/>
    /// holds — same bounded-poll discipline the page objects apply to native
    /// lookups, so a sync landing mid-poll is observed, not awaited blindly.</summary>
    public async Task<JsonDocument> WaitForUserDocumentAsync(
        string userId, Func<JsonDocument, bool> satisfied, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow.Add(timeout ?? TimeSpan.FromSeconds(45));
        JsonDocument? document;
        while (true)
        {
            document = await UserDocumentAsync(userId);
            if (document != null && satisfied(document))
            {
                return document;
            }
            if (DateTime.UtcNow >= deadline)
            {
                throw new TimeoutException(
                    $"users/{userId} did not reach the expected state within the poll budget; " +
                    $"last document: {document?.RootElement.GetRawText() ?? "<absent>"}");
            }
            await Task.Delay(400);
        }
    }

    /// <summary>Uid of every committed <c>users/*</c> document (owner read).</summary>
    public async Task<IReadOnlyList<string>> UserDocumentIdsAsync()
    {
        using var request = OwnerRequest(HttpMethod.Get, $"{FirestoreBase}{DocumentsPath}/users");
        using var response = await _http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var ids = new List<string>();
        if (json != null && json.RootElement.TryGetProperty("documents", out var documents))
        {
            foreach (var document in documents.EnumerateArray())
            {
                var name = document.GetProperty("name").GetString()!;
                ids.Add(name[(name.LastIndexOf('/') + 1)..]);
            }
        }
        return ids;
    }

    /// <summary>Injects an entry the running app cannot know (owner write on a
    /// single field path), so the merge must carry it through untouched.</summary>
    public async Task InjectEntryAsync(string userId, string key, string deviceId = "rest-injection")
    {
        // The values placed here are suite constants; JsonEncodedText keeps a
        // future caller honest if a non-literal key ever arrives.
        var body = """
        {"fields":{"entries":{"mapValue":{"fields":{
            "@key":{"mapValue":{"fields":{
                "value":{"stringValue":"future-key-payload"},
                "updatedAt":{"integerValue":"9999999999999"},
                "deviceId":{"stringValue":"@deviceId"}}}}}}}}}
        """
            .Replace("@key", JsonEncodedText.Encode(key).Value)
            .Replace("@deviceId", JsonEncodedText.Encode(deviceId).Value);
        using var request = OwnerRequest(HttpMethod.Patch,
            $"{FirestoreBase}{DocumentsPath}/users/{userId}?updateMask.fieldPaths=entries.{key}");
        request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        using var response = await _http.SendAsync(request);
        response.EnsureSuccessStatusCode();
    }

    // ---------- Anonymous-identity surface ----------

    /// <summary>Creates a second anonymous identity against the same emulator
    /// Auth surface the app uses; its idToken is the cross-user probe.</summary>
    public async Task<string> SignUpAnonymousAsync()
    {
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"{AuthBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=e2e-suite");
        request.Content = JsonContent.Create(new { returnSecureToken = true });
        using var response = await _http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        return json!.RootElement.GetProperty("idToken").GetString()!;
    }

    /// <summary>Lists every Auth account the emulator knows (owner read).
    /// Anonymous sessions carry no providerUserInfo, so the caller can tell a
    /// silent anonymous identity from any real login.</summary>
    public async Task<IReadOnlyList<JsonElement>> AccountsAsync()
    {
        using var request = OwnerRequest(HttpMethod.Get,
            $"{AuthBase}/identitytoolkit.googleapis.com/v1/projects/{ProjectId}/accounts:batchGet?maxResults=100");
        using var response = await _http.SendAsync(request);
        response.EnsureSuccessStatusCode();
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var accounts = new List<JsonElement>();
        if (json != null && json.RootElement.TryGetProperty("users", out var users))
        {
            foreach (var user in users.EnumerateArray())
            {
                // Clone outlives the JsonDocument scope.
                accounts.Add(user.Clone());
            }
        }
        return accounts;
    }

    /// <summary>Attempts <c>users/{userId}</c> under a caller-supplied token
    /// (or no token) and returns the HTTP status — the security-rule verdict.
    /// </summary>
    public async Task<HttpStatusCode> ReadStatusAsync(string userId, string? bearerToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{FirestoreBase}{DocumentsPath}/users/{userId}");
        if (bearerToken != null)
        {
            request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
        }
        using var response = await _http.SendAsync(request);
        return response.StatusCode;
    }

    // ---------- Disposable-data cleanup ----------

    /// <summary>Wipes the emulated database and every Auth account so the run
    /// leaves no preference or identity residue on the disposable backend.</summary>
    public async Task WipeAsync()
    {
        using var documents = await _http.SendAsync(new HttpRequestMessage(HttpMethod.Delete,
            $"{FirestoreBase}/emulator/v1/projects/{ProjectId}/databases/(default)/documents"));
        documents.EnsureSuccessStatusCode();
        using var accounts = await _http.SendAsync(new HttpRequestMessage(HttpMethod.Delete,
            $"{AuthBase}/emulator/v1/projects/{ProjectId}/accounts"));
        accounts.EnsureSuccessStatusCode();
    }

    private static HttpRequestMessage OwnerRequest(HttpMethod method, string uri)
    {
        var request = new HttpRequestMessage(method, uri);
        // The emulator's documented rules-bypass token for admin verification.
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", "owner");
        return request;
    }

    public void Dispose() => _http.Dispose();
}
