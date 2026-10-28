using System.Diagnostics;
using System.Text.Json;

namespace BibleOnSite.Tests.MobileE2E.Configuration;

/// <summary>Keeps a failed scenario alive while the supervisor samples its current app process.</summary>
internal static class FailureDiagnostics
{
    internal const string DirectoryVariable = "MOBILE_E2E_FAILURE_DIAGNOSTICS";
    private static readonly TimeSpan CaptureBudget = TimeSpan.FromSeconds(15);

    internal static void BeforeFailure(string test, string? sessionId, Action<string> log) =>
        WaitForCapture(Environment.GetEnvironmentVariable(DirectoryVariable), test, sessionId, log, CaptureBudget);

    internal static void WaitForCapture(string? directory, string test, string? sessionId,
        Action<string> log, TimeSpan budget, Action<string>? published = null)
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
            var completed = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using var watcher = new FileSystemWatcher(directory, Path.GetFileName(ack));
            Exception? watchError = null;
            void Observe(object sender, FileSystemEventArgs args)
            {
                if (File.Exists(ack))
                {
                    completed.TrySetResult(true);
                }
            }
            watcher.Created += Observe;
            watcher.Renamed += Observe;
            watcher.Error += (_, args) =>
            {
                watchError = args.GetException();
                completed.TrySetResult(true);
            };
            // Observe before publication: even an immediate acknowledgement cannot be lost.
            watcher.EnableRaisingEvents = true;
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

            var remaining = budget - started.Elapsed;
            if (!File.Exists(ack) && remaining > TimeSpan.Zero)
            {
                // One bounded OS event wait, with no polling or scenario retry.
                completed.Task.Wait(remaining);
            }
            if (watchError != null)
            {
                throw new IOException("Failure diagnostics acknowledgement watcher failed.", watchError);
            }
            if (!File.Exists(ack))
            {
                Log(log, $"Failure diagnostics acknowledgement was not received within {budget.TotalSeconds:0.###} seconds; request {id} retained.");
            }
        }, log, "Failure diagnostics handshake", exception =>
            File.WriteAllText(Path.Join(directory, $"{id}.error.txt"), exception.ToString()));
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
