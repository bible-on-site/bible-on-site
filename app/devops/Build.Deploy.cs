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

            using var service = CreatePlayService(keyFile);

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

    Target SyncGooglePlayListing => _ => _
        .Description("Sync app/store-listing text and screenshots to Google Play without shipping a build")
        .Requires(() => GooglePlayKeyFile)
        .Executes(() =>
        {
            var keyFile = (AbsolutePath)GooglePlayKeyFile!;
            Assert.FileExists(keyFile, $"Service account key file not found: {keyFile}");

            using var service = CreatePlayService(keyFile);
            var edit = service.Edits.Insert(new AppEdit(), GooglePlayPackageName).Execute();
            Serilog.Log.Information($"Created edit: {edit.Id}");
            SyncStoreListing(service, edit.Id);
            service.Edits.Commit(GooglePlayPackageName, edit.Id).Execute();
            Serilog.Log.Information("Google Play listing sync complete");
        });

    static AndroidPublisherService CreatePlayService(AbsolutePath keyFile)
    {
        var credential = CredentialFactory.FromFile<ServiceAccountCredential>(keyFile)
            .ToGoogleCredential()
            .CreateScoped(AndroidPublisherService.Scope.Androidpublisher);

        return new AndroidPublisherService(new BaseClientService.Initializer
        {
            HttpClientInitializer = credential,
            ApplicationName = "NUKE Build"
        });
    }

    // Pushes app/store-listing onto the app's own Hebrew listing inside an open
    // edit. Play resolves Hebrew under the legacy "iw" tag, so the tag is read
    // back from the edit rather than hardcoded.
    void SyncStoreListing(AndroidPublisherService service, string editId)
    {
        var listingDir = RootDirectory / "store-listing";
        var description = ReadListingFile(listingDir / "he" / "description.txt", 4000);
        var shortDescription = ReadListingFile(listingDir / "he" / "short-description.txt", 80);
        var screenshotsDir = listingDir / "screenshots" / "android";
        var screenshots = screenshotsDir.DirectoryExists()
            ? screenshotsDir.GlobFiles("*.png").OrderBy(p => p.Name).ToList()
            : [];
        if (description is null && shortDescription is null && screenshots.Count == 0)
        {
            Serilog.Log.Information("No store-listing content found under app/store-listing - skipping listing sync");
            return;
        }

        var listings = service.Edits.Listings.List(GooglePlayPackageName, editId).Execute().Listings ?? [];
        var language = listings.FirstOrDefault(l => l.Language.StartsWith("iw") || l.Language.StartsWith("he"))?.Language ?? "iw";

        if (description is not null || shortDescription is not null)
        {
            var listing = listings.FirstOrDefault(l => l.Language == language) ?? new Listing { Language = language };
            listing.ShortDescription = shortDescription ?? listing.ShortDescription;
            listing.FullDescription = description ?? listing.FullDescription;
            service.Edits.Listings.Update(listing, GooglePlayPackageName, editId, language).Execute();
            Serilog.Log.Information($"Updated {language} listing text");
        }

        if (screenshots.Count > 0)
        {
            service.Edits.Images.Deleteall(GooglePlayPackageName, editId, language,
                EditsResource.ImagesResource.DeleteallRequest.ImageTypeEnum.PhoneScreenshots).Execute();
            foreach (var screenshot in screenshots)
            {
                using var stream = File.OpenRead(screenshot);
                var uploadProgress = service.Edits.Images.Upload(GooglePlayPackageName, editId, language,
                    EditsResource.ImagesResource.UploadMediaUpload.ImageTypeEnum.PhoneScreenshots, stream, "image/png").Upload();
                if (uploadProgress.Status != UploadStatus.Completed)
                {
                    Assert.Fail($"Screenshot upload failed for {screenshot.Name}: {uploadProgress.Exception?.Message}");
                }
            }

            Serilog.Log.Information($"Replaced {language} phone screenshots ({screenshots.Count} files)");
        }
    }

    static string? ReadListingFile(AbsolutePath path, int maxChars)
    {
        if (!path.FileExists())
        {
            return null;
        }

        var text = File.ReadAllText(path).Trim();
        Assert.True(text.Length <= maxChars, $"{path.Name} is {text.Length} chars, over the {maxChars} store limit");
        return text;
    }

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
        // CI-created flight IDs harvested from this workflow's own job logs.
        // Loaded lazily — only when Partner Center reports the flight cap and
        // `flights list` cannot enumerate what to delete.
        Queue<string>? harvestQueue = null;
        var capHit = false;
        string lastFailure = "";

        var attempt = 0;
        while (attempt < maxAttempts)
        {
            attempt++;
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

            // A printed FlightId means Partner Center committed the create
            // even if the process exited non-zero afterwards; verify the
            // anomaly and reuse the flight instead of stacking duplicates
            // (CD run 168 created three real flights through this path).
            if (TryParseFlightId(output, out var flightId)
                && (process.ExitCode == 0 || ConfirmFlightExists(flightId)))
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

            // The 25-flight cap is a persistent account state, not a
            // transient error — retrying frees nothing until old flights are
            // deleted. `flights list` (the listflights endpoint) has answered
            // "no Flights" while flights existed since 2026-10-08, so the
            // cleanup in this target cannot see them; delete the CI-created
            // flight IDs still recorded in this workflow's own job logs
            // instead (#2221).
            if (IsFlightCapError(output))
            {
                capHit = true;
                harvestQueue ??= new Queue<string>(HarvestDeployedFlights());
                // The queue bounds recovery: each entry is a flight this
                // workflow created, deleted oldest-first until Partner Center
                // accepts a create. Already-deleted ids make their delete
                // fail fast and cheap — they consume a dequeue, not budget.
                if (harvestQueue.Count > 0)
                {
                    var staleFlight = harvestQueue.Dequeue();
                    Serilog.Log.Warning(
                        $"Partner Center reports the flight cap; deleting oldest CI-created flight {staleFlight} and retrying");
                    TryDeleteFlight(staleFlight);
                    attempt--; // freed a slot — replay the attempt budget
                    continue;
                }
                break;
            }

            if (attempt < maxAttempts)
            {
                Thread.Sleep(TimeSpan.FromSeconds(15));
            }
        }

        if (capHit)
        {
            Serilog.Log.Error(
                "Partner Center still reports the 25-flight cap after deleting " +
                "every recoverable CI-created flight. The remaining flights were " +
                "created outside this workflow (Partner Center UI or runs whose " +
                "logs expired) — delete a package flight for app " +
                $"{MsStoreAppId} under https://partner.microsoft.com/dashboard " +
                "(Apps and games → select the app → Package flights) and " +
                "re-dispatch the deploy. See " +
                "https://github.com/bible-on-site/bible-on-site/issues/2221");
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

    /// <summary>
    /// Partner Center's definitive "no room for another flight" answer —
    /// observed as HTTP 400 `InvalidOperation` in CD run 116585562753.
    /// Persistent account state, never retried blindly.
    /// </summary>
    static bool IsFlightCapError(string output) =>
        FlightCapPattern.IsMatch(output);

    static readonly System.Text.RegularExpressions.Regex FlightCapPattern =
        new(@"maximum number of (?:package )?flights",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);

    static bool TryParseFlightId(string output, out string flightId)
    {
        // `flights create --verbose` prints the created flight as a JSON
        // object framed by log lines before and after it, so JSON-parsing the
        // text from the first '{' to the end throws on the trailing log text
        // and misreports a successful create as failure (CD run 168 leaked
        // three real flights that way). Extract the id directly instead.
        var match = FlightIdPattern.Match(output);
        flightId = match.Success ? match.Groups[1].Value : "";
        return match.Success;
    }

    static readonly System.Text.RegularExpressions.Regex FlightIdPattern =
        new(@"""FlightId""\s*:\s*""([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})""");

    /// <summary>
    /// Reads the flight IDs this workflow created in earlier runs, oldest
    /// first, from devops/github/release/ms-store-flights.mjs. check-deployment
    /// copies the helper beside the runner temp dir before the artifact-source
    /// checkout replaces the tree; fall back to the repo copy for local runs.
    /// </summary>
    List<string> HarvestDeployedFlights()
    {
        var runnerTemp = Environment.GetEnvironmentVariable("RUNNER_TEMP");
        var helper = !string.IsNullOrEmpty(runnerTemp)
            ? $"{runnerTemp.Replace('\\', '/')}/ms-store-flights.mjs"
            : null;
        if (helper == null || !File.Exists(helper))
        {
            helper = (RootDirectory.Parent / "devops" / "github" / "release" / "ms-store-flights.mjs").ToString();
        }
        if (!File.Exists(helper))
        {
            Serilog.Log.Warning("Flight history harvest helper is missing; cannot free flights automatically");
            return [];
        }
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GH_TOKEN")) &&
            string.IsNullOrEmpty(Environment.GetEnvironmentVariable("GITHUB_TOKEN")))
        {
            Serilog.Log.Warning("GH_TOKEN is not set; cannot read CD job logs to recover flight IDs");
            return [];
        }
        var harvest = ProcessTasks.StartProcess(
            "node",
            $"\"{helper}\"",
            logOutput: false,
            logInvocation: true
        );
        harvest.WaitForExit();
        if (harvest.ExitCode != 0)
        {
            Serilog.Log.Warning(
                $"Flight history harvest failed: {TrimForLog(string.Join("\n", harvest.Output.Select(o => o.Text)))}");
            return [];
        }
        var stdout = string.Join(
            "\n",
            harvest.Output.Where(o => o.Type == Nuke.Common.Tooling.OutputType.Std).Select(o => o.Text));
        try
        {
            var ids = JsonDocument.Parse(stdout).RootElement.GetProperty("flightIds");
            return ids.EnumerateArray()
                .Select(e => e.GetString() ?? "")
                .Where(s => s.Length > 0)
                .ToList();
        }
        catch (Exception ex) when (ex is JsonException or InvalidOperationException or KeyNotFoundException)
        {
            Serilog.Log.Warning($"Flight history harvest returned unexpected output: {TrimForLog(stdout)}");
            return [];
        }
    }

    bool ConfirmFlightExists(string flightId)
    {
        var verify = ProcessTasks.StartProcess(
            "msstore",
            $"flights get \"{MsStoreAppId}\" \"{flightId}\"",
            logOutput: false,
            logInvocation: true
        );
        verify.WaitForExit();
        if (verify.ExitCode != 0)
        {
            Serilog.Log.Warning(
                $"Flight {flightId} was reported created but cannot be retrieved; treating as failed creation");
            return false;
        }
        return true;
    }

    bool TryDeleteFlight(string flightId)
    {
        var deleteProcess = ProcessTasks.StartProcess(
            "msstore",
            $"flights delete \"{MsStoreAppId}\" \"{flightId}\"",
            logInvocation: true
        );
        deleteProcess.WaitForExit();
        if (deleteProcess.ExitCode != 0)
        {
            Serilog.Log.Warning($"Could not delete flight {flightId}");
            return false;
        }
        return true;
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
        // --verbose surfaces the real Dev Center answer when listing fails —
        // since 2026-10-08 the listflights endpoint has answered empty while
        // flights still existed, which hid the 25-flight-cap blocker (#2221).
        var listProcess = ProcessTasks.StartProcess(
            "msstore",
            $"flights list \"{MsStoreAppId}\" --verbose",
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

        // Column 0 is empty (before first │), column 1 is row number, column 2 is FlightId
        foreach (var flightIdPart in lines
            .Select(line => line.Split('│'))
            .Where(columns => columns.Length >= 3)
            .Select(columns => columns[2].Trim())
            .Where(part => !string.IsNullOrEmpty(part) && !part.Contains("FlightId") && !part.Contains("─")))
        {
            flightIdColumnParts.Append(flightIdPart);
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
            TryDeleteFlight(flightId);
        }

        if (flightsToDelete.Count > 0)
        {
            Serilog.Log.Information($"Cleaned up {flightsToDelete.Count} old flight(s)");
        }
    }
}
