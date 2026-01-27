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
        var version = GetCurrentVersion();
        var flightName = $"v{version}-{DateTime.UtcNow:yyyyMMdd-HHmmss}";
        Serilog.Log.Information($"Creating new flight: {flightName}");

        var output = new List<Nuke.Common.Tooling.Output>();
        var process = ProcessTasks.StartProcess(
            "msstore",
            $"flights create \"{MsStoreAppId}\" \"{flightName}\" --group-ids \"{MsStoreFlightGroupId}\"",
            logOutput: true,
            logInvocation: true
        );
        process.WaitForExit();
        output.AddRange(process.Output);
        process.AssertZeroExitCode();

        // Parse the flight ID from the JSON output
        var jsonOutput = string.Join("", output.Select(o => o.Text));
        var startIndex = jsonOutput.IndexOf('{');
        if (startIndex >= 0)
        {
            var jsonPart = jsonOutput.Substring(startIndex);
            using var doc = JsonDocument.Parse(jsonPart);
            if (doc.RootElement.TryGetProperty("FlightId", out var flightIdProp))
            {
                var flightId = flightIdProp.GetString();
                Serilog.Log.Information($"Created flight with ID: {flightId}");
                return flightId!;
            }
        }

        Assert.Fail("Failed to parse flight ID from msstore output");
        return null!;
    }

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

    void CleanupOldFlights()
    {
        Serilog.Log.Information($"Cleaning up old flights (keeping {MaxFlightsToKeep} most recent)...");

        var listProcess = ProcessTasks.StartProcess(
            "msstore",
            $"flights list \"{MsStoreAppId}\"",
            logOutput: true,
            logInvocation: true
        );
        listProcess.WaitForExit();

        if (listProcess.ExitCode != 0)
        {
            Serilog.Log.Warning("Could not list flights for cleanup");
            return;
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
        
        var rawOutput = string.Join("\n", listProcess.Output.Select(o => o.Text));
        Serilog.Log.Information($"Raw output length: {rawOutput.Length} chars");
        
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
        
        var flightIdColumn = flightIdColumnParts.ToString();
        
        // Strip ANSI escape codes (the CLI adds formatting like [1;4m for underline/bold)
        var ansiPattern = new System.Text.RegularExpressions.Regex(@"\x1b\[[0-9;]*m");
        flightIdColumn = ansiPattern.Replace(flightIdColumn, "");
        
        Serilog.Log.Information($"FlightId column content (first 200): {flightIdColumn.Substring(0, Math.Min(200, flightIdColumn.Length))}");
        
        // Now extract complete UUIDs from the concatenated FlightId column
        // Microsoft Store has a hard limit of 25 flights per app
        var uuidPattern = new System.Text.RegularExpressions.Regex(
            @"([a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var matches = uuidPattern.Matches(flightIdColumn);
        var flightIds = matches.Cast<System.Text.RegularExpressions.Match>()
            .Select(m => m.Value.ToLowerInvariant())
            .Distinct()
            .ToList();

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
