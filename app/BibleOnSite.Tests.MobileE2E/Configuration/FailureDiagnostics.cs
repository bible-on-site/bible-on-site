using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

/// <summary>Keeps a failed scenario alive while the supervisor samples its current app process.</summary>
internal static class FailureDiagnostics
{
    internal const string DirectoryVariable = "MOBILE_E2E_FAILURE_DIAGNOSTICS";
    internal const string PortVariable = "MOBILE_E2E_FAILURE_DIAGNOSTICS_PORT";
    private static readonly TimeSpan CaptureBudget = TimeSpan.FromSeconds(15);

    internal static void BeforeFailure(string test, string? sessionId, Action<string> log) =>
        WaitForCapture(Environment.GetEnvironmentVariable(DirectoryVariable), test, sessionId, log, CaptureBudget,
            notificationPort: Environment.GetEnvironmentVariable(PortVariable));

    internal static void WaitForCapture(string? directory, string test, string? sessionId,
        Action<string> log, TimeSpan budget, Action<string>? published = null, string? notificationPort = null)
    {
        if (string.IsNullOrEmpty(directory))
        {
            return;
        }

        var id = Guid.NewGuid().ToString("N");
        var started = Stopwatch.StartNew();
        var failedAtUtc = DateTimeOffset.UtcNow;
        PreserveFailure(() =>
        {
            if (budget <= TimeSpan.Zero || budget > CaptureBudget)
            {
                throw new ArgumentOutOfRangeException(nameof(budget));
            }
            if (!Directory.Exists(directory))
            {
                throw new DirectoryNotFoundException("The supervisor's failure diagnostics directory does not exist.");
            }

            var ack = Path.Join(directory, $"{id}.ack.json");
            var request = Path.Join(directory, $"{id}.request.json");
            var temporary = request + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(new
            {
                id,
                test,
                sessionId,
                failedAtUtc,
                deadlineUtc = failedAtUtc + budget,
            }));
            File.Move(temporary, request);
            published?.Invoke(request);

            if (!int.TryParse(notificationPort, NumberStyles.None, CultureInfo.InvariantCulture, out var port)
                || port is < 1 or > 65535)
            {
                throw new InvalidDataException("The supervisor's loopback notification port is missing or invalid.");
            }
            var remaining = budget - started.Elapsed;
            // The listening supervisor is ready before the harness starts. One socket exchange,
            // rather than a filesystem subscription race, carries notification and completion.
            if (remaining <= TimeSpan.Zero || !NotifyCaptureAsync(port, id, ack, remaining).GetAwaiter().GetResult())
            {
                Log(log, $"Failure diagnostics acknowledgement was not received within {budget.TotalSeconds:0.###} seconds; request {id} retained.");
            }
        }, log, "Failure diagnostics handshake", exception =>
            File.WriteAllText(Path.Join(directory, $"{id}.error.txt"), exception.ToString()));
    }

    private static async Task<bool> NotifyCaptureAsync(int port, string id, string acknowledgement, TimeSpan remaining)
    {
        using var deadline = new CancellationTokenSource(remaining);
        using var client = new TcpClient(AddressFamily.InterNetwork);
        try
        {
            await client.ConnectAsync(IPAddress.Loopback, port, deadline.Token).ConfigureAwait(false);
            using var stream = client.GetStream();
            var notification = Encoding.ASCII.GetBytes(id + "\n");
            await stream.WriteAsync(notification, deadline.Token).ConfigureAwait(false);
            var response = new byte[notification.Length];
            var received = 0;
            while (received < response.Length)
            {
                var count = await stream.ReadAsync(response.AsMemory(received), deadline.Token).ConfigureAwait(false);
                if (count == 0)
                {
                    throw new EndOfStreamException("Failure diagnostics supervisor closed before acknowledgement.");
                }
                received += count;
            }
            if (!response.AsSpan().SequenceEqual(notification))
            {
                throw new InvalidDataException("Failure diagnostics supervisor acknowledged a different request.");
            }
            if (await stream.ReadAsync(new byte[1], deadline.Token).ConfigureAwait(false) != 0)
            {
                throw new InvalidDataException("Failure diagnostics supervisor sent extra acknowledgement data.");
            }
            if (!File.Exists(acknowledgement))
            {
                throw new InvalidDataException("Failure diagnostics supervisor did not retain its acknowledgement.");
            }
            return true;
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested)
        {
            return false;
        }
    }

    /// <summary>After a scenario fails, secondary diagnostic faults must not replace its exception.</summary>
    internal static void PreserveFailure(Action operation, Action<string> writeOutput,
        string description = "Failure diagnostics", Action<Exception>? retainError = null)
    {
        try
        {
            operation();
        }
        catch (Exception exception) //NOSONAR Diagnostic failures must preserve the scenario's original exception.
        {
            Log(writeOutput, $"{description} failed: {exception}");
            if (retainError == null)
            {
                return;
            }
            try
            {
                retainError(exception);
            }
            catch (Exception retentionError) //NOSONAR A diagnostic retention failure must not replace the scenario failure.
            {
                Log(writeOutput, $"Failure diagnostics error could not be retained: {retentionError.Message}");
            }
        }
    }

    private static void Log(Action<string> writeOutput, string message)
    {
        try
        {
            writeOutput(message);
        }
        catch (Exception exception) //NOSONAR Test output may already be unavailable; preserve the original scenario failure.
        {
            try
            {
                Console.Error.WriteLine($"{message} (test output unavailable: {exception.Message})");
            }
            catch (Exception) //NOSONAR Both output sinks may be closed; the private error file remains best-effort evidence.
            {
                // The scenario's original exception still decides the outcome.
            }
        }
    }
}
