using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

/// <summary>
/// Read/write access to the local Firebase Emulator Suite (#3185). The suite
/// runs beside the test runner — never inside the app — so every scenario
/// observes the same Firestore/Auth state the native adapters produce.
///
/// Enabled only when <c>FIREBASE_EMULATOR=1</c>; the host defaults to
/// localhost because the suite is a host process, while the app under test
/// resolves its own endpoint (10.0.2.2 on the Android emulator, localhost on
/// the iOS simulator) inside <c>FirebaseEmulatorConfig</c>.
/// </summary>
internal static class FirebaseEmulatorProbe
{
    public const string EnabledVariable = "FIREBASE_EMULATOR";
    public const string HostVariable = "FIREBASE_EMULATOR_HOST";
    public const string AuthPortVariable = "FIREBASE_EMULATOR_AUTH_PORT";
    public const string FirestorePortVariable = "FIREBASE_EMULATOR_FIRESTORE_PORT";
    public const string ProjectVariable = "FIREBASE_EMULATOR_PROJECT_ID";

    // The app ships the production Firebase project id; the emulator serves
    // any project path, so tests must address the same one the app writes to.
    private const string DefaultProjectId = "tanah-al-haperek";

    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(20) };

    public static bool Enabled => IsFlag(Environment.GetEnvironmentVariable(EnabledVariable));

    public static string Host =>
        Environment.GetEnvironmentVariable(HostVariable) is { Length: > 0 } host ? host : "localhost";

    public static int AuthPort => ParsePort(Environment.GetEnvironmentVariable(AuthPortVariable), 9099);
    public static int FirestorePort => ParsePort(Environment.GetEnvironmentVariable(FirestorePortVariable), 8080);
    public static string ProjectId =>
        Environment.GetEnvironmentVariable(ProjectVariable) is { Length: > 0 } project ? project : DefaultProjectId;

    private static Uri AuthBase => new($"http://{Host}:{AuthPort}");
    private static Uri FirestoreBase => new($"http://{Host}:{FirestorePort}");
    private static string DocumentsPath => $"v1/projects/{ProjectId}/databases/(default)/documents";

    private static bool IsFlag(string? value) =>
        string.Equals(value, "1", StringComparison.OrdinalIgnoreCase)
        || string.Equals(value, "true", StringComparison.OrdinalIgnoreCase);

    private static int ParsePort(string? value, int fallback) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var port)
        && port is > 0 and <= 65535
            ? port
            : fallback;

    /// <summary>
    /// Blocks until the Auth emulator answers; fails the scenario when the
    /// suite is down. The liveness endpoint is the emulator's own config
    /// route — the account-listing admin API lives under identitytoolkit.
    /// </summary>
    public static async Task RequireAliveAsync(CancellationToken cancellationToken = default)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        Exception? last = null;
        while (true)
        {
            try
            {
                using var response = await Client.GetAsync(
                    $"{AuthBase}emulator/v1/projects/{ProjectId}/config", timeout.Token);
                if (response.IsSuccessStatusCode)
                {
                    return;
                }
                last = new HttpRequestException($"Auth emulator answered {(int)response.StatusCode}.");
            }
            catch (Exception exception) when (exception is HttpRequestException or TaskCanceledException or OperationCanceledException)
            {
                last = exception;
            }
            if (timeout.IsCancellationRequested)
            {
                throw new InvalidOperationException(
                    $"Firebase Emulator Suite is not reachable at {AuthBase} — start it (see app/firebase/README.md) or unset FIREBASE_EMULATOR. Last error: {last?.Message}", last);
            }
            await Task.Delay(500, cancellationToken);
        }
    }

    /// <summary>
    /// Every Auth-emulator account as (localId, createdAtMs) pairs. The admin
    /// download endpoint is identitytoolkit's accounts:batchGet — it requires
    /// an OAuth2 bearer, and like the Firestore emulator the Auth emulator
    /// treats the literal token "owner" as a full-access bypass. Anonymous
    /// accounts carry no providerUserInfo in this payload, but every account
    /// this suite ever holds is anonymous by construction (the app only
    /// signs in anonymously; probe identities use accounts:signUp too).
    /// </summary>
    public static async Task<IReadOnlyList<(string LocalId, long CreatedAtMs)>> ListAccountsAsync(
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get,
            $"{AuthBase}identitytoolkit.googleapis.com/v1/projects/{ProjectId}/accounts:batchGet");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "owner");
        using var response = await Client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var accounts = new List<(string, long)>();
        if (document.RootElement.TryGetProperty("users", out var users))
        {
            foreach (var user in users.EnumerateArray())
            {
                var localId = user.TryGetProperty("localId", out var id) ? id.GetString() ?? string.Empty : string.Empty;
                var createdAt = user.TryGetProperty("createdAt", out var created)
                    && long.TryParse(created.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
                        ? parsed
                        : 0;
                accounts.Add((localId, createdAt));
            }
        }
        return accounts;
    }

    /// <summary>
    /// The uid the app owns: the users/{uid} document id that is also a live
    /// Auth-emulator account. When more than one candidate exists (a leaked
    /// probe identity from an earlier failed run), the earliest-created
    /// account wins — the app's anonymous user is always the first account
    /// the suite ever minted. Throws when no app document exists — proof the
    /// silent sign-in + first sync never ran.
    /// </summary>
    public static async Task<string> AppUserIdAsync(CancellationToken cancellationToken = default)
    {
        var docIds = await ListUserIdsAsync(cancellationToken);
        var accounts = await ListAccountsAsync(cancellationToken);
        var accountCreatedAt = accounts.ToDictionary(account => account.LocalId, account => account.CreatedAtMs);
        var candidates = docIds
            .Where(accountCreatedAt.ContainsKey)
            .OrderBy(uid => accountCreatedAt[uid])
            .ToArray();
        return candidates.Length > 0
            ? candidates[0]
            : throw new InvalidOperationException(
                $"No users/* document backed by an Auth-emulator account (docs: {docIds.Count}, accounts: {accounts.Count}).");
    }

    /// <summary>Creates a second anonymous account for isolation checks; returns (localId, idToken).</summary>
    public static async Task<(string LocalId, string IdToken)> SignUpAnonymousAsync(CancellationToken cancellationToken = default)
    {
        using var response = await Client.PostAsync(
            $"{AuthBase}identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key",
            new StringContent("{}", Encoding.UTF8, "application/json"), cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var root = document.RootElement;
        return (
            root.GetProperty("localId").GetString() ?? string.Empty,
            root.GetProperty("idToken").GetString() ?? string.Empty);
    }

    /// <summary>
    /// Deletes an Auth-emulator account via the client accounts:delete endpoint
    /// — the emulator's /emulator/v1 account routes only support bulk delete,
    /// so per-account cleanup goes through the identity the probe created.
    /// </summary>
    public static async Task DeleteAccountAsync(string idToken, CancellationToken cancellationToken = default)
    {
        using var response = await Client.PostAsync(
            $"{AuthBase}identitytoolkit.googleapis.com/v1/accounts:delete?key=fake-api-key",
            new StringContent(JsonSerializer.Serialize(new { idToken }), Encoding.UTF8, "application/json"),
            cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Wipes the whole suite — every Auth account and every Firestore document —
    /// so each run starts from the single anonymous identity the app is about
    /// to mint. The suite is disposable by design (CI discards it with the
    /// job); a long-lived local suite otherwise accumulates stale users/*
    /// documents whose accounts would corrupt AppUserIdAsync's pick.
    /// </summary>
    public static async Task ResetSuiteAsync(CancellationToken cancellationToken = default)
    {
        using var authRequest = new HttpRequestMessage(
            HttpMethod.Delete, $"{AuthBase}emulator/v1/projects/{ProjectId}/accounts");
        authRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "owner");
        using var authResponse = await Client.SendAsync(authRequest, cancellationToken);
        authResponse.EnsureSuccessStatusCode();

        using var documentsRequest = new HttpRequestMessage(
            HttpMethod.Delete, $"{FirestoreBase}emulator/v1/projects/{ProjectId}/databases/(default)/documents");
        documentsRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "owner");
        using var documentsResponse = await Client.SendAsync(documentsRequest, cancellationToken);
        documentsResponse.EnsureSuccessStatusCode();
    }

    /// <summary>Raw users/{uid} document JSON as the REST API returns it; null on 404.</summary>
    public static async Task<string?> GetUserDocumentJsonAsync(
        string uid, string? bearer = null, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{FirestoreBase}{DocumentsPath}/users/{uid}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer ?? "owner");
        using var response = await Client.SendAsync(request, cancellationToken);
        if (response.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(cancellationToken);
    }

    /// <summary>uids of every users/* document (admin view).</summary>
    public static async Task<IReadOnlyList<string>> ListUserIdsAsync(CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{FirestoreBase}{DocumentsPath}/users");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "owner");
        using var response = await Client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var ids = new List<string>();
        if (document.RootElement.TryGetProperty("documents", out var documents))
        {
            foreach (var entry in documents.EnumerateArray())
            {
                if (entry.TryGetProperty("name", out var name))
                {
                    var text = name.GetString() ?? string.Empty;
                    var index = text.LastIndexOf('/');
                    if (index >= 0 && index + 1 < text.Length)
                    {
                        ids.Add(text[(index + 1)..]);
                    }
                }
            }
        }
        return ids;
    }

    /// <summary>Snapshot of one entries.* value decoded from Firestore REST types.</summary>
    public readonly record struct EntrySnapshot(bool Present, bool Tombstone, object? Value, long UpdatedAtMs);

    /// <summary>Reads entries.{key} from users/{uid}; Present=false when absent or the doc is missing.</summary>
    public static async Task<EntrySnapshot> GetEntryAsync(
        string uid, string key, CancellationToken cancellationToken = default)
    {
        var json = await GetUserDocumentJsonAsync(uid, cancellationToken: cancellationToken);
        if (json == null)
        {
            return new EntrySnapshot(false, false, null, 0);
        }
        using var document = JsonDocument.Parse(json);
        var fields = document.RootElement.GetProperty("fields");
        if (!fields.TryGetProperty("entries", out var entries)
            || !entries.TryGetProperty("mapValue", out var entriesMap)
            || !entriesMap.TryGetProperty("fields", out var entryFields)
            || !entryFields.TryGetProperty(key, out var entry))
        {
            return new EntrySnapshot(false, false, null, 0);
        }
        if (!entry.TryGetProperty("mapValue", out var entryMap)
            || !entryMap.TryGetProperty("fields", out var values))
        {
            return new EntrySnapshot(false, false, null, 0);
        }
        var tombstone = values.TryGetProperty("tombstone", out var tombstoneValue)
            && tombstoneValue.ValueKind == JsonValueKind.True;
        var updatedAt = values.TryGetProperty("updatedAt", out var updated)
            && updated.TryGetProperty("integerValue", out var updatedText)
            && long.TryParse(updatedText.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : 0;
        object? value = null;
        if (!tombstone && values.TryGetProperty("value", out var valueElement))
        {
            value = DecodeValue(valueElement);
        }
        return new EntrySnapshot(true, tombstone, value, updatedAt);
    }

    /// <summary>
    /// Polls entries.{key} until its decoded value equals <paramref name="expected"/>
    /// — the assertion every sync scenario shares. Tombstones and absent entries
    /// never satisfy the wait.
    /// </summary>
    public static async Task<EntrySnapshot> WaitForEntryValueAsync(
        string uid, string key, object? expected, TimeSpan timeout, CancellationToken cancellationToken = default)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        EntrySnapshot last = default;
        while (DateTime.UtcNow < deadline)
        {
            last = await GetEntryAsync(uid, key, cancellationToken);
            if (last.Present && !last.Tombstone && EntryValueEquals(last.Value, expected))
            {
                return last;
            }
            await Task.Delay(1000, cancellationToken);
        }
        throw new TimeoutException(
            $"users/{uid} entries.{key} did not become {Format(expected)} within {timeout.TotalSeconds}s " +
            $"(last: {(last.Present ? last.Tombstone ? "tombstone" : Format(last.Value) : "absent")}).");
    }

    /// <summary>
    /// Writes fields the app must never produce — an unknown entries.* key and
    /// an unrelated top-level field — so merge/preserve semantics are exercised
    /// against real Firestore writes, not fakes.
    /// </summary>
    public static async Task InjectUnrelatedFieldsAsync(string uid, string marker, CancellationToken cancellationToken = default)
    {
        var updatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture);
        var body = $$"""
        {
          "fields": {
            "entries": {
              "mapValue": {
                "fields": {
                  "emulatorProbeKey": {
                    "mapValue": {
                      "fields": {
                        "value": { "stringValue": "{{marker}}" },
                        "updatedAt": { "integerValue": "{{updatedAt}}" },
                        "deviceId": { "stringValue": "emulator-probe" }
                      }
                    }
                  }
                }
              }
            },
            "unrelatedField": { "stringValue": "{{marker}}" }
          }
        }
        """;
        using var request = new HttpRequestMessage(
            HttpMethod.Patch,
            $"{FirestoreBase}{DocumentsPath}/users/{uid}" +
            "?updateMask.fieldPaths=entries.emulatorProbeKey&updateMask.fieldPaths=unrelatedField")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "owner");
        using var response = await Client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>Creates users/{uid} for a second identity using its own Auth-emulator token — the rules allow a user to write only their own document.</summary>
    public static async Task CreateUserDocumentAsync(
        string uid, string idToken, string marker, CancellationToken cancellationToken = default)
    {
        var body = $$"""
        {
          "fields": {
            "schemaVersion": { "integerValue": "1" },
            "entries": {
              "mapValue": {
                "fields": {
                  "emulatorIsolationProbe": {
                    "mapValue": {
                      "fields": {
                        "value": { "stringValue": "{{marker}}" },
                        "updatedAt": { "integerValue": "1" },
                        "deviceId": { "stringValue": "isolation-probe" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
        """;
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"{FirestoreBase}{DocumentsPath}/users?documentId={Uri.EscapeDataString(uid)}")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", idToken);
        using var response = await Client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>Raw status of a users/{uid} GET under the given bearer — used for security-rule denial checks.</summary>
    public static async Task<HttpStatusCode> GetUserDocumentStatusAsync(
        string uid, string? bearer, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{FirestoreBase}{DocumentsPath}/users/{uid}");
        if (bearer != null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        }
        using var response = await Client.SendAsync(request, cancellationToken);
        return response.StatusCode;
    }

    /// <summary>
    /// Writes entries.{key} directly (admin) with an explicit updatedAt — used
    /// to simulate another device's newer write so the app's next merge must
    /// apply the remote winner locally.
    /// </summary>
    public static async Task WriteEntryAsync(
        string uid, string key, object? value, long updatedAtMs, CancellationToken cancellationToken = default)
    {
        var valueElement = value switch
        {
            null => (object)new { nullValue = "NULL_VALUE" },
            bool boolean => new { booleanValue = boolean },
            string text => new { stringValue = text },
            long integer => new { integerValue = integer.ToString(CultureInfo.InvariantCulture) },
            int integer => new { integerValue = ((long)integer).ToString(CultureInfo.InvariantCulture) },
            double number => new { doubleValue = number },
            _ => throw new ArgumentException($"Unsupported probe value type {value.GetType()}.", nameof(value)),
        };
        var body = JsonSerializer.Serialize(new
        {
            fields = new Dictionary<string, object>
            {
                ["entries"] = new
                {
                    mapValue = new
                    {
                        fields = new Dictionary<string, object>
                        {
                            [key] = new
                            {
                                mapValue = new
                                {
                                    fields = new Dictionary<string, object>
                                    {
                                        ["value"] = valueElement,
                                        ["updatedAt"] = new { integerValue = updatedAtMs.ToString(CultureInfo.InvariantCulture) },
                                        ["deviceId"] = new { stringValue = "emulator-probe" },
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        using var request = new HttpRequestMessage(
            HttpMethod.Patch,
            $"{FirestoreBase}{DocumentsPath}/users/{uid}?updateMask.fieldPaths=entries.{Uri.EscapeDataString(key)}")
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "owner");
        using var response = await Client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>Deletes a users/{uid} document (admin).</summary>
    public static async Task DeleteUserDocumentAsync(string uid, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Delete, $"{FirestoreBase}{DocumentsPath}/users/{uid}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "owner");
        using var response = await Client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
    }

    /// <summary>
    /// Numeric-tolerant equality: Firestore REST may surface a whole number as
    /// integerValue or doubleValue depending on the writer, while callers pass
    /// the logical value (0L, 1.5, true, "text").
    /// </summary>
    private static bool EntryValueEquals(object? actual, object? expected)
    {
        if (actual is null || expected is null)
        {
            return actual is null && expected is null;
        }
        if (actual is bool actualBool && expected is bool expectedBool)
        {
            return actualBool == expectedBool;
        }
        if (IsNumeric(actual) && IsNumeric(expected))
        {
            return Math.Abs(Convert.ToDouble(actual, CultureInfo.InvariantCulture)
                - Convert.ToDouble(expected, CultureInfo.InvariantCulture)) < 0.000001;
        }
        return Equals(actual, expected);
    }

    private static bool IsNumeric(object value) =>
        value is sbyte or byte or short or ushort or int or uint or long or ulong or float or double;

    private static object? DecodeValue(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            return null;
        }
        if (value.TryGetProperty("booleanValue", out var boolean))
        {
            return boolean.GetBoolean();
        }
        if (value.TryGetProperty("integerValue", out var integer))
        {
            return long.Parse(integer.GetString() ?? "0", NumberStyles.Integer, CultureInfo.InvariantCulture);
        }
        if (value.TryGetProperty("doubleValue", out var dbl))
        {
            return dbl.GetDouble();
        }
        if (value.TryGetProperty("stringValue", out var text))
        {
            return text.GetString();
        }
        return null;
    }

    private static string Format(object? value) => value switch
    {
        null => "null",
        bool b => b ? "true" : "false",
        long l => l.ToString(CultureInfo.InvariantCulture),
        double d => d.ToString(CultureInfo.InvariantCulture),
        string s => $"'{s}'",
        _ => value.ToString() ?? "?",
    };
}
