using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using BibleOnSite.Tests.MobileE2E.Configuration;

namespace BibleOnSite.Tests.MobileE2E;

internal sealed record VerifiedIosApp(string DeviceId, string AppPath, string Nonce, string BundleSha256)
{
    internal void VerifyIdentity(MobileTestConfiguration configuration)
    {
        if (configuration.Platform != MobilePlatform.IOS || DeviceId != configuration.DeviceId ||
            AppPath != configuration.AppPath || !Guid.TryParseExact(Nonce, "N", out _) ||
            BundleSha256.Length != 64 || BundleSha256.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new InvalidOperationException("Verified iOS installation does not belong to this session's app/device.");
        }
    }
}

internal static class IosAppInstallation
{
    internal static VerifiedIosApp Prepare(MobileTestConfiguration configuration, TimeSpan budget) =>
        Prepare(configuration, budget, Environment.GetEnvironmentVariable,
            remaining => new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
            { Timeout = remaining, MaxResponseContentBufferSize = 64 * 1024 });

    internal static VerifiedIosApp Prepare(MobileTestConfiguration configuration, TimeSpan budget,
        Func<string, string?> environment, Func<TimeSpan, HttpClient> createClient)
    {
        if (budget <= TimeSpan.Zero || budget > TimeSpan.FromMinutes(5))
        {
            throw new ArgumentOutOfRangeException(nameof(budget));
        }
        var started = Stopwatch.StartNew();
        var expiresAt = DateTimeOffset.UtcNow.Add(budget);
        var nonce = Guid.NewGuid().ToString("N");
        void Milestone(string phase) => FailureDiagnostics.PreserveFailure(() =>
        {
            var json = JsonSerializer.Serialize(new
            {
                kind = "ios-install-client/1", phase, nonce, udid = configuration.DeviceId,
                at = DateTimeOffset.UtcNow, elapsedMs = started.ElapsedMilliseconds,
                remainingMs = (budget - started.Elapsed).TotalMilliseconds
            });
            File.AppendAllText(Path.Combine(configuration.ArtifactDirectory, "ios-preparation-process.jsonl"), json + "\n");
            Console.Error.WriteLine("iOS preparation process: " + json);
        }, Console.Error.WriteLine, "iOS preparation milestone");
        var portValue = environment("MOBILE_IOS_PREPARATION_PORT");
        var token = environment("MOBILE_IOS_PREPARATION_TOKEN");
        if (!int.TryParse(portValue, System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture, out var port) || port is < 1 or > 65535 ||
            token is not { Length: 64 } || token.Any(character =>
                character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
        {
            throw new InvalidOperationException("A live authenticated parent iOS observer is required.");
        }
        var deadlineValue = expiresAt.ToUnixTimeMilliseconds();
        using var request = new HttpRequestMessage(HttpMethod.Post,
            new UriBuilder(Uri.UriSchemeHttp, "127.0.0.1", port, "prepare").Uri);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        request.Headers.Add("X-Ios-Preparation-Deadline", deadlineValue.ToString(System.Globalization.CultureInfo.InvariantCulture));
        // Paths and commands belong to the Node parent's fixed closure. The
        // client can request only this device, nonce, mode and original budget.
        request.Content = new StringContent(JsonSerializer.Serialize(new
        {
            kind = "ios-install-request/1", phase = "install", udid = configuration.DeviceId,
            nonce, deadlineMs = deadlineValue, keepData = configuration.KeepAppForReview
        }), Encoding.UTF8, "application/json");
        Milestone("request-starting");
        var remaining = budget - started.Elapsed;
        if (remaining <= TimeSpan.Zero)
        {
            throw new TimeoutException("Preparing iOS request diagnostics exhausted the existing 300 second session deadline.");
        }
        using var client = createClient(remaining);
        remaining = budget - started.Elapsed;
        if (remaining <= TimeSpan.Zero)
        {
            throw new TimeoutException("iOS installation exhausted its original startup deadline.");
        }
        using var deadline = new CancellationTokenSource(remaining);
        string json;
        try
        {
            using var response = client.SendAsync(request, deadline.Token).GetAwaiter().GetResult();
            json = response.Content.ReadAsStringAsync(deadline.Token).GetAwaiter().GetResult();
            Milestone("response-returned");
            if (response.StatusCode != System.Net.HttpStatusCode.OK)
            {
                throw new InvalidOperationException($"Parent iOS installation rejected ({(int)response.StatusCode}): {json}");
            }
        }
        catch (OperationCanceledException exception) when (deadline.IsCancellationRequested || started.Elapsed >= budget)
        {
            Milestone("cancellation-observed");
            throw new TimeoutException("iOS preparation exhausted the existing 300 second session deadline.", exception);
        }
        if (started.Elapsed >= budget)
        {
            throw new TimeoutException("iOS installation exhausted its original startup deadline.");
        }
        var proof = ParseReceipt(json, configuration, nonce);
        File.AppendAllText(Path.Combine(configuration.ArtifactDirectory, "ios-installations.jsonl"), json.TrimEnd() + "\n");
        return proof;
    }

    internal static VerifiedIosApp ParseReceipt(string json, MobileTestConfiguration configuration, string nonce)
    {
        using var document = JsonDocument.Parse(json);
        var receipt = document.RootElement;
        if (receipt.GetProperty("kind").GetString() != "ios-verified-install/1" ||
            !receipt.TryGetProperty("observerAcknowledged", out var acknowledged) || acknowledged.ValueKind != JsonValueKind.True ||
            receipt.GetProperty("nonce").GetString() != nonce ||
            receipt.GetProperty("bundleId").GetString() != "com.tanah.daily929" ||
            receipt.GetProperty("keepData").GetBoolean() != configuration.KeepAppForReview)
        {
            throw new InvalidOperationException("iOS installation receipt is stale or belongs to another operation.");
        }
        var proof = new VerifiedIosApp(receipt.GetProperty("udid").GetString() ?? "",
            receipt.GetProperty("appPath").GetString() ?? "", nonce,
            receipt.GetProperty("bundleSha256").GetString() ?? "");
        proof.VerifyIdentity(configuration);
        return proof;
    }
}
