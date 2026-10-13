using Google.Apis.AndroidPublisher.v3;
using Google.Apis.AndroidPublisher.v3.Data;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Services;
using Google.Apis.Upload;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tooling;
using System.Text.Json;

partial class Build
{
    const string MsStoreAppId = "9NBLGGH6B55K";
    const string GooglePlayPackageName = "com.tanah.daily929";

    // ============ Deploy Parameters ============
    [Parameter("Path to MSIX file for Microsoft Store upload")]
    readonly string? MsixPath;

    [Parameter("Path to AAB file for Google Play upload")]
    readonly string? AabPath;

    [Parameter("Path to Google Play service account JSON file")]
    readonly string? GooglePlayKeyFile;

    [Parameter("Microsoft Store flight ID for internal testing (if not provided, a new flight will be created)")]
    readonly string? MsStoreFlightId;

    [Parameter("Microsoft Store flight group ID (required when creating a new flight)")]
    readonly string? MsStoreFlightGroupId;

    [Parameter("Google Play track (internal, alpha, beta, production). Default: internal")]
    readonly string GooglePlayTrack = "internal";

    [Parameter("Deploy to production instead of flight/internal (requires store review)")]
    readonly bool Production;

    [Parameter("Maximum number of flights to keep (older flights will be deleted). Default: 5")]
    readonly int MaxFlightsToKeep = 5;

    Target DeployGooglePlay => _ => _
        .Description("Deploy AAB to Google Play")
        .Requires(() => AabPath)
        .Requires(() => GooglePlayKeyFile)
        .Executes(() =>
        {
            var aabFile = (AbsolutePath)AabPath!;
            var keyFile = (AbsolutePath)GooglePlayKeyFile!;
            Assert.FileExists(aabFile, $"AAB file not found: {aabFile}");
            Assert.FileExists(keyFile, $"Service account key file not found: {keyFile}");

            var track = Production ? "production" : GooglePlayTrack;
            Serilog.Log.Information($"Uploading {aabFile.Name} to Google Play ({track} track)...");

            if (track == "production")
            {
                Serilog.Log.Warning("Deploying to PRODUCTION - will require Google review for new apps");
            }

#pragma warning disable CS0618 // GoogleCredential.FromFile is obsolete but replacement API is unclear
            var credential = GoogleCredential.FromFile(keyFile)
                .CreateScoped(AndroidPublisherService.Scope.Androidpublisher);
#pragma warning restore CS0618

            using var service = new AndroidPublisherService(new BaseClientService.Initializer
            {
                HttpClientInitializer = credential,
                ApplicationName = "NUKE Build"
            });

            // Create edit
            var edit = service.Edits.Insert(new AppEdit(), GooglePlayPackageName).Execute();
            Serilog.Log.Information($"Created edit: {edit.Id}");

            // Upload AAB
            using var aabStream = File.OpenRead(aabFile);
            var uploadRequest = service.Edits.Bundles.Upload(GooglePlayPackageName, edit.Id, aabStream, "application/octet-stream");
            var uploadProgress = uploadRequest.Upload();

            if (uploadProgress.Status != UploadStatus.Completed)
            {
                Assert.Fail($"Upload failed: {uploadProgress.Exception?.Message}");
            }

            var bundle = uploadRequest.ResponseBody;
            Serilog.Log.Information($"Uploaded bundle with version code: {bundle.VersionCode}");

            // Assign to track
            var trackUpdate = new Track
            {
                Releases = new List<TrackRelease>
                {
                    new()
                    {
                        Status = "completed",
                        VersionCodes = new List<long?> { bundle.VersionCode }
                    }
                }
            };
            service.Edits.Tracks.Update(trackUpdate, GooglePlayPackageName, edit.Id, track).Execute();
            Serilog.Log.Information($"Assigned to {track} track");

            // Commit edit
            var commitRequest = service.Edits.Commit(GooglePlayPackageName, edit.Id);
            commitRequest.Execute();
            Serilog.Log.Information("Google Play upload complete");
        });

    Target DeployMsStore => _ => _
        .Description("Deploy MSIX to Microsoft Store")
        .Requires(() => MsixPath)
        .Executes(() =>
        {
            var msixFile = (AbsolutePath)MsixPath!;
            Assert.FileExists(msixFile, $"MSIX file not found: {msixFile}");

            // Require either flight ID, flight group ID (to create new flight), or explicit production flag
            if (string.IsNullOrEmpty(MsStoreFlightId) && string.IsNullOrEmpty(MsStoreFlightGroupId) && !Production)
            {
                Serilog.Log.Error("Must specify one of:");
                Serilog.Log.Error("  --ms-store-flight-id: Use existing flight");
                Serilog.Log.Error("  --ms-store-flight-group-id: Create new flight (recommended for CI/CD)");
                Serilog.Log.Error("  --production: Deploy to production (requires store review)");
                Assert.Fail("Missing deployment target");
            }

            // Verify environment variables are set (msstore CLI reads these automatically)
            var tenantId = Environment.GetEnvironmentVariable("PARTNER_CENTER_TENANT_ID");
            var clientId = Environment.GetEnvironmentVariable("PARTNER_CENTER_CLIENT_ID");
            var clientSecret = Environment.GetEnvironmentVariable("PARTNER_CENTER_CLIENT_SECRET");

            if (string.IsNullOrEmpty(tenantId) || string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(clientSecret))
            {
                Serilog.Log.Warning("Microsoft Store credentials not configured. Set PARTNER_CENTER_TENANT_ID, PARTNER_CENTER_CLIENT_ID, PARTNER_CENTER_CLIENT_SECRET");
                return;
            }

            Serilog.Log.Information($"Uploading {msixFile.Name} to Microsoft Store...");

            string? flightId = MsStoreFlightId;

            // Create a new flight if no flight ID is provided
            if (string.IsNullOrEmpty(flightId) && !Production)
            {
                // Clean up old flights BEFORE creating new one to avoid hitting 25 flight limit
                if (!string.IsNullOrEmpty(MsStoreFlightGroupId) && MaxFlightsToKeep > 0)
                {
                    CleanupOldFlights();
                }
                flightId = CreateMsStoreFlight();
            }

            // Delete any pending flight submission if using existing flight
            if (!string.IsNullOrEmpty(flightId) && !string.IsNullOrEmpty(MsStoreFlightId))
            {
                DeletePendingFlightSubmission(flightId);
            }

            var arguments = $"publish \"{msixFile}\" --appId \"{MsStoreAppId}\"";

            if (!string.IsNullOrEmpty(flightId))
            {
                arguments += $" --flightId \"{flightId}\"";
                Serilog.Log.Information($"Deploying to flight: {flightId} (internal testing)");
            }
            else
            {
                Serilog.Log.Warning("Deploying to PRODUCTION - will require Microsoft review");
            }

            // msstore CLI is installed via: microsoft/setup-msstore-cli GitHub Action
            ProcessTasks.StartProcess("msstore", arguments)
                .AssertZeroExitCode();

            Serilog.Log.Information("Microsoft Store upload complete");
        });

    string CreateMsStoreFlight()
    {
        const int maxAttempts = 3;
        var version = GetCurrentVersion();
        var flightName = $"v{version}-{DateTime.UtcNow:yyyyMMdd-HHmmss}";
        var baselineKnown = TryListMsStoreFlights(out var baselineFlights);
        string lastFailure = "";

        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            Serilog.Log.Information(
                $"Creating new flight: {flightName} (attempt {attempt}/{maxAttempts})");

            // --verbose makes the msstore CLI log the underlying Partner Center
            // API error. Without it the CLI only prints "Error while creating
            // flight. Please try again." and the actionable reason is lost.
            var process = ProcessTasks.StartProcess(
                "msstore",
                $"flights create \"{MsStoreAppId}\" \"{flightName}\" --group-ids \"{MsStoreFlightGroupId}\" --verbose",
                logOutput: false,
                logInvocation: true
            );
            process.WaitForExit();
            var output = string.Join("\n", process.Output.Select(o => o.Text));

            if (process.ExitCode == 0 && TryParseFlightId(output, out var flightId))
            {
                Serilog.Log.Information($"Created flight with ID: {flightId}");
                return flightId;
            }

            // The flight may exist even though the command reported failure
            // (Partner Center can commit the create and still lose the
            // response). Reuse it instead of stacking duplicate flights. This
            // requires a trustworthy baseline: if either listing failed, the
            // difference would misidentify pre-existing flights as new.
            var leakedFlights = baselineKnown && TryListMsStoreFlights(out var currentFlights)
                ? currentFlights.Except(baselineFlights).ToList()
                : [];
            if (leakedFlights.Count > 0)
            {
                var recovered = leakedFlights.Last();
                Serilog.Log.Warning(
                    $"Flight creation reported failure but flight {recovered} now exists; deploying to it");
                return recovered;
            }

            lastFailure = TrimForLog(output);
            Serilog.Log.Warning(
                $"Flight creation attempt {attempt}/{maxAttempts} failed (exit {process.ExitCode}): {lastFailure}");
            if (attempt < maxAttempts)
            {
                Thread.Sleep(TimeSpan.FromSeconds(15));
            }
        }

        Serilog.Log.Error(
            "Partner Center rejected flight creation after every attempt. This is a " +
            "store-side blocker, not a build problem. Verify the flight group " +
            "(MS_STORE_FLIGHT_GROUP_ID) still exists in Partner Center and that no " +
            "Partner Center submission is blocking API writes. See " +
            "https://github.com/bible-on-site/bible-on-site/issues/2221");
        Assert.Fail($"Microsoft Store flight creation failed: {lastFailure}");
        return null!;
    }

    static bool TryParseFlightId(string output, out string flightId)
    {
        flightId = "";
        var startIndex = output.IndexOf('{');
        if (startIndex < 0)
        {
            return false;
        }
        try
        {
            using var doc = JsonDocument.Parse(output.Substring(startIndex));
            if (doc.RootElement.TryGetProperty("FlightId", out var flightIdProp))
            {
                flightId = flightIdProp.GetString() ?? "";
            }
        }
        catch (JsonException)
        {
            return false;
        }
        return !string.IsNullOrEmpty(flightId);
    }

    static string TrimForLog(string text, int maxLength = 2000)
    {
        var clean = AnsiPattern.Replace(text, "").Trim();
        return clean.Length <= maxLength ? clean : $"{clean.Substring(0, maxLength)}...";
    }

    static readonly System.Text.RegularExpressions.Regex AnsiPattern =
        new(@"\x1b\[[0-9;]*m");

    void DeletePendingFlightSubmission(string flightId)
    {
        Serilog.Log.Information($"Checking for pending flight submission...");
        var deleteProcess = ProcessTasks.StartProcess("msstore", $"flights submission delete \"{MsStoreAppId}\" \"{flightId}\"");
        deleteProcess.WaitForExit();
        // Ignore exit code - deletion may fail if no pending submission exists or if it was created in Partner Center
        if (deleteProcess.ExitCode != 0)
        {
            Serilog.Log.Warning("Could not delete pending submission (may not exist or was created in Partner Center)");
        }
    }

    /// <summary>
    /// Lists the app's current flight IDs, oldest first. The msstore CLI exits
    /// non-zero both for real API errors and for an empty flight list — the
    /// latter is the normal state once every flight is published, so it is
    /// reported at information level instead of polluting the log with
    /// ##[error] entries. Real failures surface as warnings with the captured
    /// CLI output and return false.
    /// </summary>
    bool TryListMsStoreFlights(out List<string> flightIds)
    {
        flightIds = [];
        var listProcess = ProcessTasks.StartProcess(
            "msstore",
            $"flights list \"{MsStoreAppId}\"",
            logOutput: false,
            logInvocation: true
        );
        listProcess.WaitForExit();
        var rawOutput = string.Join("\n", listProcess.Output.Select(o => o.Text));

        if (listProcess.ExitCode != 0)
        {
            if (AnsiPattern.Replace(rawOutput, "").Contains("no Flights"))
            {
                Serilog.Log.Information("No existing flights");
                return true;
            }
            Serilog.Log.Warning($"Could not list flights: {TrimForLog(rawOutput)}");
            return false;
        }

        // The CLI wraps long content across multiple lines in a table format.
        // Each column is wrapped separately. We need to extract the FlightId column (2nd column)
        // and concatenate the partial UUIDs from consecutive rows.
        //
        // Example table output:
        // │ 1  │ 67df6395-6 │ v3         │ ...
        // │    │ 07a-4da7-b │            │ ...
        // │    │ 718-80c949 │            │ ...
        // │    │ c69e73     │            │ ...
        // │ 2  │ c30667c3-9 │ v4.0.29-20 │ ...

        // Split into lines and extract the FlightId column (2nd column after splitting by │)
        var lines = rawOutput.Split('\n');
        var flightIdColumnParts = new System.Text.StringBuilder();

        foreach (var line in lines)
        {
            var columns = line.Split('│');
            if (columns.Length >= 3)
            {
                // Column 0 is empty (before first │), column 1 is row number, column 2 is FlightId
                var flightIdPart = columns[2].Trim();
                if (!string.IsNullOrEmpty(flightIdPart) && !flightIdPart.Contains("FlightId") && !flightIdPart.Contains("─"))
                {
                    flightIdColumnParts.Append(flightIdPart);
                }
            }
        }

        var flightIdColumn = AnsiPattern.Replace(flightIdColumnParts.ToString(), "");

        // Now extract complete UUIDs from the concatenated FlightId column
        // Microsoft Store has a hard limit of 25 flights per app
        var uuidPattern = new System.Text.RegularExpressions.Regex(
            @"([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var matches = uuidPattern.Matches(flightIdColumn);
        flightIds = matches.Cast<System.Text.RegularExpressions.Match>()
            .Select(m => m.Value.ToLowerInvariant())
            .Distinct()
            .ToList();

        return true;
    }

    void CleanupOldFlights()
    {
        Serilog.Log.Information($"Cleaning up old flights (keeping {MaxFlightsToKeep} most recent)...");

        if (!TryListMsStoreFlights(out var flightIds))
        {
            // The failure was already logged with the captured CLI output.
            return;
        }
        Serilog.Log.Information($"Found {flightIds.Count} flights");
        if (flightIds.Count > 0)
        {
            Serilog.Log.Information($"First flight ID: {flightIds.First()}");
            Serilog.Log.Information($"Last flight ID: {flightIds.Last()}");
        }

        // Delete oldest flights (first in list), keep the most recent ones (last in list)
        var countToDelete = Math.Max(0, flightIds.Count - MaxFlightsToKeep);
        var flightsToDelete = flightIds.Take(countToDelete).ToList();

        Serilog.Log.Information($"Will delete {flightsToDelete.Count} oldest flight(s)");

        foreach (var flightId in flightsToDelete)
        {
            Serilog.Log.Information($"Deleting flight: {flightId}");
            var deleteProcess = ProcessTasks.StartProcess("msstore", $"flights delete \"{MsStoreAppId}\" \"{flightId}\"");
            deleteProcess.WaitForExit();
            if (deleteProcess.ExitCode != 0)
            {
                Serilog.Log.Warning($"Could not delete flight {flightId}");
            }
        }

        if (flightsToDelete.Count > 0)
        {
            Serilog.Log.Information($"Cleaned up {flightsToDelete.Count} old flight(s)");
        }
    }
}
