using Google.Apis.AndroidPublisher.v3;
using Google.Apis.AndroidPublisher.v3.Data;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Services;
using Google.Apis.Upload;
using Nuke.Common;
using Nuke.Common.IO;
using Nuke.Common.Tooling;

partial class Build
{
    const string MsStoreAppId = "54181DoradSoft.929-";
    const string GooglePlayPackageName = "com.tanah.daily929";

    // ============ Deploy Parameters ============
    [Parameter("Path to MSIX file for Microsoft Store upload")]
    readonly string? MsixPath;

    [Parameter("Path to AAB file for Google Play upload")]
    readonly string? AabPath;

    [Parameter("Path to Google Play service account JSON file")]
    readonly string? GooglePlayKeyFile;

    [Parameter("Microsoft Store flight ID for internal testing (required unless --production is set)")]
    readonly string? MsStoreFlightId;

    [Parameter("Google Play track (internal, alpha, beta, production). Default: internal")]
    readonly string GooglePlayTrack = "internal";

    [Parameter("Deploy to production instead of flight/internal (requires store review)")]
    readonly bool Production;

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
            service.Edits.Commit(GooglePlayPackageName, edit.Id).Execute();
            Serilog.Log.Information("Google Play upload complete");
        });

    Target DeployMsStore => _ => _
        .Description("Deploy MSIX to Microsoft Store")
        .Requires(() => MsixPath)
        .Executes(() =>
        {
            var msixFile = (AbsolutePath)MsixPath!;
            Assert.FileExists(msixFile, $"MSIX file not found: {msixFile}");

            // Require either flight ID or explicit production flag
            if (string.IsNullOrEmpty(MsStoreFlightId) && !Production)
            {
                Serilog.Log.Error("Must specify either --ms-store-flight-id for internal testing or --production for production deployment");
                Serilog.Log.Information("To create a flight: Partner Center → Your app → Package flights → New flight");
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

            var arguments = $"publish \"{msixFile}\" --app-id \"{MsStoreAppId}\"";

            if (!string.IsNullOrEmpty(MsStoreFlightId))
            {
                arguments += $" --flight-id \"{MsStoreFlightId}\"";
                Serilog.Log.Information($"Deploying to flight: {MsStoreFlightId} (internal testing)");
            }
            else
            {
                Serilog.Log.Warning("Deploying to PRODUCTION - will require Microsoft review");
            }

            // msstore CLI is installed globally via: dotnet tool install -g MSStoreCLI
            ProcessTasks.StartProcess("msstore", arguments)
                .AssertZeroExitCode();

            Serilog.Log.Information("Microsoft Store upload complete");
        });
}
