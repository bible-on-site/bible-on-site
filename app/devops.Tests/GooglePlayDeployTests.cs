using System.Diagnostics;
using System.Net;
using System.Text;
using Google;
using Google.Apis.AndroidPublisher.v3;
using Google.Apis.Http;
using Google.Apis.Services;
using Google.Apis.Upload;
using Xunit;

/// <summary>
/// #3609: CD run 44034434746 canceled two AAB upload requests at the client
/// deadline, the resumed session's status query returned the terminal bundle
/// (the store had already completed it), and the edit commit still failed
/// 400 "Some of the Android App Bundle uploads are not completed yet" while
/// Play processed the bundle. These tests drive the real Google client over
/// a scripted transport so the cancel/resume/commit sequence is replayed
/// deterministically.
/// </summary>
public sealed class GooglePlayDeployTests
{
    const long VersionCode = 50100023;
    const string ProcessingRejection = "Some of the Android App Bundle uploads are not completed yet.";
    static readonly byte[] AabBytes = new byte[300_000];

    // --- CommitPlayEdit ---

    [Fact]
    public void CommitPlayEditCommitsAnAcceptedEdit()
    {
        var handler = new PlayStubHandler();
        handler.Respond(Json("""{"id":"edit-1","expiryTimeSeconds":"3600"}"""));
        Build.CommitPlayEdit(PlayService(handler), "edit-1", "internal", VersionCode, NoSleep);
        Assert.Equal(1, handler.Requests.Count(r => r.Contains(":commit")));
    }

    [Fact]
    public void CommitPlayEditRetriesWhilePlayProcessesTheBundle()
    {
        var handler = new PlayStubHandler();
        handler.Respond(ApiError(HttpStatusCode.BadRequest, ProcessingRejection));
        handler.Respond(ApiError(HttpStatusCode.BadRequest, ProcessingRejection));
        handler.Respond(Json("""{"id":"edit-1"}"""));
        var delays = new List<TimeSpan>();
        Build.CommitPlayEdit(PlayService(handler), "edit-1", "internal", VersionCode, delays.Add);
        Assert.Equal(3, handler.Requests.Count(r => r.Contains(":commit")));
        Assert.Equal(Build.PlayCommitRetryDelays.Take(2), delays);
    }

    [Fact]
    public void CommitPlayEditFailsFastOnPermanentRejection()
    {
        var handler = new PlayStubHandler();
        handler.Respond(ApiError(HttpStatusCode.BadRequest, "Version code 50100023 has already been used."));
        var failure = Assert.Throws<GoogleApiException>(() => Build.CommitPlayEdit(
            PlayService(handler), "edit-1", "internal", VersionCode,
            _ => Assert.Fail("no sleep is allowed on a permanent rejection")));
        Assert.Equal(HttpStatusCode.BadRequest, failure.HttpStatusCode);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public void CommitPlayEditExhaustsTheBoundedProcessingBudget()
    {
        var handler = new PlayStubHandler();
        for (var i = 0; i < Build.PlayCommitMaxAttempts; i++)
        {
            handler.Respond(ApiError(HttpStatusCode.BadRequest, ProcessingRejection));
        }
        var delays = new List<TimeSpan>();
        var failure = Assert.Throws<GoogleApiException>(() => Build.CommitPlayEdit(
            PlayService(handler), "edit-1", "internal", VersionCode, delays.Add));
        Assert.Equal(HttpStatusCode.BadRequest, failure.HttpStatusCode);
        Assert.Equal(Build.PlayCommitMaxAttempts, handler.Requests.Count(r => r.Contains(":commit")));
        Assert.Equal(Build.PlayCommitMaxAttempts - 1, delays.Count);
        Assert.Equal(Build.PlayCommitRetryDelays, delays);
    }

    [Fact]
    public void CommitPlayEditRetriesServerErrorsWithinTheSameBudget()
    {
        var handler = new PlayStubHandler();
        handler.Respond(ApiError(HttpStatusCode.InternalServerError, "backend error"));
        handler.Respond(Json("""{"id":"edit-1"}"""));
        Build.CommitPlayEdit(PlayService(handler), "edit-1", "internal", VersionCode, NoSleep);
        Assert.Equal(2, handler.Requests.Count(r => r.Contains(":commit")));
    }

    [Fact]
    public void CommitPlayEditVerifiesALandedCommitWhenTheResponseIsLost()
    {
        var handler = new PlayStubHandler();
        handler.Respond((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("connection reset")));
        // The original edit is already consumed — only then may a probe
        // edit read the live track without invalidating a pending commit.
        handler.Respond(ApiError(HttpStatusCode.NotFound, "Edit not found"));
        handler.Respond(Json("""{"id":"probe"}"""));
        handler.Respond(Json(TrackJson(VersionCode)));
        handler.Respond(Json("{}"));
        Build.CommitPlayEdit(PlayService(handler), "edit-1", "internal", VersionCode, NoSleep);
        Assert.Equal(1, handler.Requests.Count(r => r.Contains(":commit")));
        Assert.Contains(handler.Requests, r => r.StartsWith("GET") && r.Contains("edits/edit-1"));
        Assert.Contains(handler.Requests, r => r.StartsWith("GET") && r.Contains("tracks/internal"));
        Assert.Contains(handler.Requests, r => r.StartsWith("DELETE") && r.Contains("probe"));
    }

    [Fact]
    public void CommitPlayEditRetriesAStillOpenEditInsteadOfProbing()
    {
        var handler = new PlayStubHandler();
        handler.Respond((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("connection reset")));
        // The edit is still open — the commit provably did not land, so the
        // same edit retries and no new edit may be created.
        handler.Respond(Json("""{"id":"edit-1"}"""));
        handler.Respond(Json("""{"id":"edit-1"}"""));
        var delays = new List<TimeSpan>();
        Build.CommitPlayEdit(PlayService(handler), "edit-1", "internal", VersionCode, delays.Add);
        Assert.Equal(2, handler.Requests.Count(r => r.Contains(":commit")));
        Assert.Contains(handler.Requests, r => r.StartsWith("GET") && r.Contains("edits/edit-1"));
        // No new edit may be created while the original is still open —
        // Play would invalidate the pending edit.
        Assert.DoesNotContain(handler.Requests, r => r.StartsWith("POST") && r.EndsWith("/edits"));
        Assert.DoesNotContain(handler.Requests, r => r.Contains("tracks/internal"));
        Assert.Single(delays);
    }

    [Fact]
    public void CommitPlayEditKeepsAStillOpenEditUnprobedUntilTheBudgetEnds()
    {
        var handler = new PlayStubHandler();
        for (var i = 0; i < Build.PlayCommitMaxAttempts; i++)
        {
            handler.Respond((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("connection reset")));
            handler.Respond(Json("""{"id":"edit-1"}"""));
        }
        Assert.Throws<HttpRequestException>(() => Build.CommitPlayEdit(
            PlayService(handler), "edit-1", "internal", VersionCode, NoSleep));
        Assert.Equal(Build.PlayCommitMaxAttempts, handler.Requests.Count(r => r.Contains(":commit")));
        Assert.Equal(Build.PlayCommitMaxAttempts,
            handler.Requests.Count(r => r.StartsWith("GET") && r.Contains("edits/edit-1")));
        // A probe edit would have inserted an edit and asked the live
        // track — neither may happen while the original stays open.
        Assert.DoesNotContain(handler.Requests, r => r.StartsWith("POST") && r.EndsWith("/edits"));
        Assert.DoesNotContain(handler.Requests, r => r.Contains("tracks/internal"));
    }

    [Fact]
    public void CommitPlayEditRethrowsWhenTheLostCommitProvablyDidNotLand()
    {
        var handler = new PlayStubHandler();
        handler.Respond((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("connection reset")));
        handler.Respond(ApiError(HttpStatusCode.NotFound, "Edit not found"));
        handler.Respond(Json("""{"id":"probe"}"""));
        handler.Respond(Json(TrackJson(50100022)));
        handler.Respond(Json("{}"));
        Assert.Throws<HttpRequestException>(() => Build.CommitPlayEdit(
            PlayService(handler), "edit-1", "internal", VersionCode, NoSleep));
        Assert.Contains(handler.Requests, r => r.StartsWith("DELETE") && r.Contains("probe"));
    }

    [Fact]
    public void CommitPlayEditKeepsTheOriginalFailureWhenRemoteStateIsUnreadable()
    {
        var handler = new PlayStubHandler();
        handler.Respond((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("connection reset")));
        handler.Respond((_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("still down")));
        Assert.Throws<HttpRequestException>(() => Build.CommitPlayEdit(
            PlayService(handler), "edit-1", "internal", VersionCode, NoSleep));
    }

    [Fact]
    public void CommitPlayEditTreatsAConsumedEditAsEvidenceNotFailure()
    {
        var handler = new PlayStubHandler();
        handler.Respond(ApiError(HttpStatusCode.BadRequest, ProcessingRejection));
        handler.Respond(ApiError(HttpStatusCode.NotFound, "Edit not found"));
        handler.Respond(Json("""{"id":"probe"}"""));
        handler.Respond(Json(TrackJson(VersionCode)));
        handler.Respond(Json("{}"));
        Build.CommitPlayEdit(PlayService(handler), "edit-1", "internal", VersionCode, NoSleep);
        Assert.Equal(2, handler.Requests.Count(r => r.Contains(":commit")));
    }

    // --- UploadWithResume ---

    [Fact]
    public void UploadWithResumeCompletesAnUninterruptedUpload()
    {
        var handler = new PlayStubHandler();
        handler.Respond(SessionInitiated("https://uploads.example/session-1"));
        handler.Respond(Json("""{"versionCode":"50100023"}"""));
        var upload = BundleUpload(PlayService(handler));
        var progress = Build.UploadWithResume(upload);
        Assert.Equal(UploadStatus.Completed, progress.Status);
        Assert.Equal<long?>(VersionCode, upload.ResponseBody?.VersionCode);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Contains(handler.Requests, r => r.StartsWith("POST") && r.Contains("bundles"));
        Assert.Contains(handler.Requests, r => r.StartsWith("PUT") && r.Contains("range:bytes 0-299999/300000"));
    }

    [Fact]
    public void UploadWithResumeCompletesWhenResumeFindsTheUploadAlreadyAccepted()
    {
        // The exact 5.1.23 sequence: the deadline canceled the chunk PUT, the
        // store had already finished the bundle, and the resumed status query
        // returned the terminal response instead of a byte offset.
        var handler = new PlayStubHandler();
        handler.Respond(SessionInitiated("https://uploads.example/session-1"));
        handler.Respond(Stall());
        handler.Respond(Json("""{"versionCode":"50100023","sha1":"abc"}"""));
        var upload = BundleUpload(PlayService(handler, TimeSpan.FromMilliseconds(50)));
        var progress = Build.UploadWithResume(upload);
        Assert.Equal(UploadStatus.Completed, progress.Status);
        Assert.Equal<long?>(VersionCode, upload.ResponseBody?.VersionCode);
        Assert.Equal(3, handler.Requests.Count);
        Assert.Contains(handler.Requests, r => r.StartsWith("PUT") && r.Contains("range:bytes */300000"));
    }

    [Fact]
    public void UploadWithResumeContinuesFromTheConfirmedByteOffset()
    {
        var handler = new PlayStubHandler();
        handler.Respond(SessionInitiated("https://uploads.example/session-1"));
        handler.Respond(Stall());
        var resumed = new HttpResponseMessage((HttpStatusCode)308);
        resumed.Headers.TryAddWithoutValidation("Range", "bytes=0-99999");
        handler.Respond(resumed);
        handler.Respond(Json("""{"versionCode":"50100023"}"""));
        var upload = BundleUpload(PlayService(handler, TimeSpan.FromMilliseconds(50)));
        var progress = Build.UploadWithResume(upload);
        Assert.Equal(UploadStatus.Completed, progress.Status);
        Assert.Equal(4, handler.Requests.Count);
        Assert.Contains(handler.Requests, r => r.StartsWith("PUT") && r.Contains("range:bytes 100000-299999/300000"));
    }

    [Fact]
    public void UploadWithResumeStopsOnADefinitiveStoreRejection()
    {
        var handler = new PlayStubHandler();
        handler.Respond(SessionInitiated("https://uploads.example/session-1"));
        handler.Respond(Stall());
        handler.Respond(ApiError(HttpStatusCode.NotFound, "The resumable session does not exist"));
        var upload = BundleUpload(PlayService(handler, TimeSpan.FromMilliseconds(50)));
        var progress = Build.UploadWithResume(upload);
        Assert.Equal(UploadStatus.Failed, progress.Status);
        Assert.IsType<GoogleApiException>(progress.Exception);
        // Initiate + stalled chunk + one status query — a dead session is
        // never resumed a second time.
        Assert.Equal(3, handler.Requests.Count);
    }

    [Fact]
    public void UploadWithResumeReportsFailureWhenEveryAttemptIsInterrupted()
    {
        var handler = new PlayStubHandler();
        handler.Respond(SessionInitiated("https://uploads.example/session-1"));
        handler.Respond(Stall());
        handler.Respond(Stall());
        handler.Respond(Stall());
        var upload = BundleUpload(PlayService(handler, TimeSpan.FromMilliseconds(50)));
        var progress = Build.UploadWithResume(upload);
        Assert.Equal(UploadStatus.Failed, progress.Status);
        Assert.IsType<TaskCanceledException>(progress.Exception);
        Assert.Equal(4, handler.Requests.Count);
    }

    static void NoSleep(TimeSpan _)
    {
        // Deliberately no pause — tests record the delay, never wait on it.
    }

    static EditsResource.BundlesResource.UploadMediaUpload BundleUpload(AndroidPublisherService service) =>
        service.Edits.Bundles.Upload("com.tanah.daily929", "edit-1", new MemoryStream(AabBytes), "application/octet-stream");

    static AndroidPublisherService PlayService(PlayStubHandler handler, TimeSpan? timeout = null) =>
        new(new BaseClientService.Initializer
        {
            ApplicationName = "devops.Tests",
            HttpClientFactory = new StubHttpClientFactory(handler, timeout ?? TimeSpan.FromMinutes(5)),
        });

    static HttpResponseMessage Json(string body, HttpStatusCode status = HttpStatusCode.OK) =>
        new(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    static HttpResponseMessage ApiError(HttpStatusCode status, string message) =>
        Json($$$"""{"error":{"code":{{{(int)status}}},"message":"{{{message}}}","errors":[{"message":"{{{message}}}","domain":"global","reason":"badRequest"}]}}""", status);

    static HttpResponseMessage SessionInitiated(string sessionUri)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK);
        response.Headers.Location = new Uri(sessionUri);
        return response;
    }

    static string TrackJson(long versionCode) =>
        $$"""{"track":"internal","releases":[{"status":"completed","versionCodes":["{{versionCode}}"]}]}""";

    /// <summary>The upload request that stalls past the client deadline.</summary>
    static Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Stall() =>
        async (_, ct) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, ct);
            throw new UnreachableException();
        };

    sealed class StubHttpClientFactory(PlayStubHandler handler, TimeSpan timeout) : IHttpClientFactory
    {
        public ConfigurableHttpClient CreateHttpClient(CreateHttpClientArgs _) =>
            new(new ConfigurableMessageHandler(handler)) { Timeout = timeout };
    }

    /// <summary>
    /// Scripted transport: every request the service or the resumable upload
    /// makes lands here in order — each entry decides the response, including
    /// stalls that let the real client deadline cancel the send.
    /// </summary>
    sealed class PlayStubHandler : HttpMessageHandler
    {
        readonly Queue<Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>> _script = new();
        public readonly List<string> Requests = [];

        public void Respond(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> responder) =>
            _script.Enqueue(responder);

        public void Respond(HttpResponseMessage response) =>
            _script.Enqueue((_, _) => Task.FromResult(response));

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var range = request.Content?.Headers.TryGetValues("Content-Range", out var ranges) == true
                ? ranges.FirstOrDefault()
                : null;
            Requests.Add($"{request.Method} {request.RequestUri?.PathAndQuery} range:{range ?? "-"}");
            if (_script.Count == 0)
            {
                return Task.FromException<HttpResponseMessage>(
                    new InvalidOperationException($"Unscripted request: {request.Method} {request.RequestUri}"));
            }
            return _script.Dequeue()(request, cancellationToken);
        }
    }
}
