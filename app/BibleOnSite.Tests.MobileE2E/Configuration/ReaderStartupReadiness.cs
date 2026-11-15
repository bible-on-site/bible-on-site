using System.Diagnostics;
using System.Text.Json;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

// The recorder answers without an accessibility snapshot. Match the current
// process launch before spending the rest of the existing reader wait on UI.
internal static class ReaderStartupReadiness
{
    internal const string LaunchIdEnvironmentVariable = "BIBLE_E2E_LAUNCH_ID";
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(200);
    private static readonly HttpClient Client = new() { Timeout = Timeout.InfiniteTimeSpan };

    internal static string CreateLaunchId() => Guid.NewGuid().ToString("D");

    internal static TimeSpan WaitForReady(string launchId, TimeSpan budget)
    {
        var clock = Stopwatch.StartNew();
        return WaitForReady(launchId, budget,
            timeout => ReadStatus(Client, new Uri($"http://127.0.0.1:{AppCoverage.Port}/coverage/startup"), timeout),
            () => clock.Elapsed, Thread.Sleep);
    }

    internal static TimeSpan WaitForReady(string launchId, TimeSpan budget,
        Func<TimeSpan, string> readStatus, Func<TimeSpan> elapsed, Action<TimeSpan> pause)
    {
        if (!Guid.TryParseExact(launchId, "D", out var parsed) || parsed.ToString("D") != launchId)
        {
            throw new ArgumentException("Reader startup requires a canonical launch UUID.", nameof(launchId));
        }
        var lastObservation = "The startup endpoint has not answered.";
        while (budget - elapsed() is var remaining && remaining > TimeSpan.Zero)
        {
            try
            {
                var body = readStatus(remaining < RequestTimeout ? remaining : RequestTimeout);
                using var status = JsonDocument.Parse(body);
                var root = status.RootElement;
                if (root.ValueKind == JsonValueKind.Object
                    && root.TryGetProperty("ok", out var ok) && ok.ValueKind == JsonValueKind.True
                    && root.TryGetProperty("ready", out var ready) && ready.ValueKind == JsonValueKind.True
                    && root.TryGetProperty("launchId", out var identity) && identity.ValueKind == JsonValueKind.String
                    && identity.GetString() == launchId)
                {
                    remaining = budget - elapsed();
                    if (remaining > TimeSpan.Zero)
                    {
                        return remaining;
                    }
                }
                lastObservation = "No ready response matched the current process launch.";
            }
            catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException or JsonException)
            {
                lastObservation = exception.Message;
            }
            remaining = budget - elapsed();
            if (remaining > TimeSpan.Zero)
            {
                pause(remaining < PollInterval ? remaining : PollInterval);
            }
        }
        // Endpoint availability does not establish Appium session health. Its
        // error text must never enter the driver's death/transport classifiers.
        throw new TimeoutException(
            $"Reader startup did not settle within {budget.TotalSeconds} seconds. {lastObservation}");
    }

    internal static string ReadStatus(HttpClient client, Uri endpoint, TimeSpan timeout)
    {
        using var cancellation = new CancellationTokenSource(timeout);
        using var request = new HttpRequestMessage(HttpMethod.Get, endpoint);
        request.Headers.TryAddWithoutValidation("X-Bible-Coverage-Token", AppCoverage.Token);
        using var response = client.SendAsync(request, cancellation.Token).GetAwaiter().GetResult();
        response.EnsureSuccessStatusCode();
        return response.Content.ReadAsStringAsync(cancellation.Token).GetAwaiter().GetResult();
    }
}
