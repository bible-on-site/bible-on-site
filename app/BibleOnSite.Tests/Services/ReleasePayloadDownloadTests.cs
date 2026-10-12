using System.Net;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using Microsoft.Maui.ApplicationModel;

namespace BibleOnSite.Tests.Services;

public class ReleasePayloadDownloadTests
{
    private const string Notes = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string Index = "sefaria-dump-5784-sivan-4.hebrew_search.sqlite";

    private static Mock<IAppInfo> App() => App("5.0.156");

    private static Mock<IAppInfo> App(string version)
    {
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns(version);
        return app;
    }

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
        : HttpMessageHandler
    {
        public List<Uri?> Requested { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Requested.Add(request.RequestUri);
            return Task.FromResult(respond(request));
        }
    }

    private sealed class CollectProgress(List<double> target) : IProgress<double>
    {
        public void Report(double value) => target.Add(value);
    }

    [Fact]
    public void ReleasePayloadFiles_NotesPackCarriesIndex_OtherPacksJustTheZip()
    {
        PadDeliveryService.ReleasePayloadFiles("perushim_notes")
            .Should().Equal(Notes, Index);
        PadDeliveryService.ReleasePayloadFiles("recitation_5")
            .Should().Equal("recitation_5.zip");
    }

    [Fact]
    public void ReleasePayloadUri_PointsAtTheVersionedReleaseAsset()
    {
        PadDeliveryService.ReleasePayloadUri(App("5.0.156").Object, "recitation_5.zip")
            .Should().Be(new Uri(
                "https://github.com/bible-on-site/bible-on-site/releases/download/app-v5.0.156/recitation_5.zip"));
    }

    [Fact]
    public async Task Download_WritesRequiredPayload_AndReportsOrderedFractions()
    {
        await using var storage = new TestStorage();
        var bytes = Enumerable.Range(0, 200_000).Select(i => (byte)(i % 251)).ToArray();
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(bytes),
        });
        var progress = new List<double>();
        var cacheDir = Path.Join(storage.Root, "pack");

        var failure = await PadDeliveryService.DownloadReleasePayloadsAsync(
            new HttpClient(handler), App().Object, "recitation_5", cacheDir,
            new CollectProgress(progress), TestContext.Current.CancellationToken);

        failure.Should().BeNull();
        (await File.ReadAllBytesAsync(Path.Join(cacheDir, "recitation_5.zip"),
            TestContext.Current.CancellationToken)).Should().Equal(bytes);
        handler.Requested.Should().Equal(
            new Uri("https://github.com/bible-on-site/bible-on-site/releases/download/app-v5.0.156/recitation_5.zip"));
        progress.Should().NotBeEmpty().And.OnlyContain(f => f > 0 && f <= 1)
            .And.BeInAscendingOrder();
        progress.Should().EndWith(1d);
        Directory.GetFiles(cacheDir, "*.download").Should().BeEmpty();
    }

    [Fact]
    public async Task Download_NotesPack_AlsoFetchesTheOptionalSearchIndex()
    {
        await using var storage = new TestStorage();
        var notes = new byte[] { 1, 2, 3 };
        var index = new byte[] { 4, 5, 6, 7 };
        var handler = new StubHandler(request => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(request.RequestUri!.AbsolutePath.EndsWith(Index) ? index : notes),
        });
        var cacheDir = Path.Join(storage.Root, "pack");

        var failure = await PadDeliveryService.DownloadReleasePayloadsAsync(
            new HttpClient(handler), App().Object, "perushim_notes", cacheDir,
            progress: null, TestContext.Current.CancellationToken);

        failure.Should().BeNull();
        (await File.ReadAllBytesAsync(Path.Join(cacheDir, Notes),
            TestContext.Current.CancellationToken)).Should().Equal(notes);
        (await File.ReadAllBytesAsync(Path.Join(cacheDir, Index),
            TestContext.Current.CancellationToken)).Should().Equal(index);
        handler.Requested.Should().HaveCount(2);
    }

    [Fact]
    public async Task Download_RequiredPayloadMissing_ReturnsError_AndLeavesNoPartialFile()
    {
        await using var storage = new TestStorage();
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        var cacheDir = Path.Join(storage.Root, "pack");

        var failure = await PadDeliveryService.DownloadReleasePayloadsAsync(
            new HttpClient(handler), App().Object, "recitation_5", cacheDir,
            progress: null, TestContext.Current.CancellationToken);

        failure.Should().NotBeNull().And.Contain("404");
        File.Exists(Path.Join(cacheDir, "recitation_5.zip")).Should().BeFalse();
        Directory.GetFiles(cacheDir).Should().BeEmpty("a failed download must leave no payload or temp files");
    }

    [Fact]
    public async Task Download_OptionalIndexMissing_StillSucceeds()
    {
        await using var storage = new TestStorage();
        var notes = new byte[] { 9, 8, 7 };
        var handler = new StubHandler(request => request.RequestUri!.AbsolutePath.EndsWith(Index)
            ? new HttpResponseMessage(HttpStatusCode.NotFound)
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(notes) });
        var cacheDir = Path.Join(storage.Root, "pack");
        Directory.CreateDirectory(cacheDir);

        var failure = await PadDeliveryService.DownloadReleasePayloadsAsync(
            new HttpClient(handler), App().Object, "perushim_notes", cacheDir,
            progress: null, TestContext.Current.CancellationToken);

        failure.Should().BeNull();
        File.Exists(Path.Join(cacheDir, Notes)).Should().BeTrue();
        File.Exists(Path.Join(cacheDir, Index)).Should().BeFalse();
        File.Exists(Path.Join(cacheDir, Index + ".download")).Should().BeFalse();
    }

    [Fact]
    public async Task Download_TruncatedBody_LeavesNoPayloadBehind()
    {
        await using var storage = new TestStorage();
        var bytes = new byte[] { 1, 2, 3 };
        var handler = new StubHandler(_ =>
        {
            var content = new ByteArrayContent(bytes);
            // Lie about the length: the body ends early, as a dropped connection would.
            content.Headers.ContentLength = bytes.Length + 100;
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        });
        var cacheDir = Path.Join(storage.Root, "pack");

        var failure = await PadDeliveryService.DownloadReleasePayloadsAsync(
            new HttpClient(handler), App().Object, "recitation_5", cacheDir,
            progress: null, TestContext.Current.CancellationToken);

        failure.Should().NotBeNull().And.Contain("Truncated");
        File.Exists(Path.Join(cacheDir, "recitation_5.zip")).Should().BeFalse();
        File.Exists(Path.Join(cacheDir, "recitation_5.zip.download")).Should().BeFalse();
    }

    [Fact]
    public async Task Download_Cancellation_Propagates()
    {
        await using var storage = new TestStorage();
        using var cancelled = new CancellationTokenSource();
        await cancelled.CancelAsync();
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([1]),
        });
        var cacheDir = Path.Join(storage.Root, "pack");

        await FluentActions.Awaiting(() => PadDeliveryService.DownloadReleasePayloadsAsync(
                new HttpClient(handler), App().Object, "recitation_5", cacheDir,
                progress: null, cancelled.Token))
            .Should().ThrowAsync<OperationCanceledException>();
    }
}
