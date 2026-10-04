using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.Services;

public class RecitationServiceTests
{
    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));
    private static List<Pasuk> Canonical() => [new() { PasukNum = 1, Text = "ברא אור", Segments = [
        new() { Type = SegmentType.Qri, Value = "ברא" }, new() { Type = SegmentType.Qri, Value = "אור" }] }];
    private static RecitationTrack Track(int id, byte[] audio, string status = "ready") => new(id,
        $"https://example.com/recordings/{id}_record.mp3", Hash(audio), Hash(Encoding.UTF8.GetBytes("1:1:ברא\n1:2:אור")),
        3000, status, status == "ready" ? [new(1, 1, "ברא", 100, 800), new(1, 2, "אור", 900, 1800)] : []);

    private sealed class Server : HttpMessageHandler
    {
        public RecitationPackage Package { get; set; } = new(1, []);
        public Dictionary<string, byte[]> Audio { get; } = [];
        public List<string> Requests { get; } = [];
        public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>? Handler { get; set; }
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var path = request.RequestUri!.AbsolutePath;
            Requests.Add(path);
            if (Handler != null)
            {
                return Handler(request, cancellationToken);
            }
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = path == "/api/recitation"
                ? new StringContent(JsonSerializer.Serialize(Package, RecitationJsonContext.Default.RecitationPackage), Encoding.UTF8, "application/json")
                : new ByteArrayContent(Audio[path]) });
        }
    }

    [Fact]
    public async Task Preferences_DownloadsWholeSelectedBooks_AndAllBooksCanBeAddedLater()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,2),(2,'שמות','Exodus',3,3)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL),(2,2,NULL),(3,1,NULL)");
        using var server = new Server(); using var http = new HttpClient(server);
        var tracks = Enumerable.Range(1, 3).Select(id => Track(id, Encoding.UTF8.GetBytes($"audio {id}"))).ToList();
        server.Package = new(1, tracks);
        foreach (var track in tracks)
        {
            server.Audio[$"/recordings/{track.PerekId}_record.mp3"] = Encoding.UTF8.GetBytes($"audio {track.PerekId}");
        }

        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var model = new RecitationPreferencesViewModel(service, preferences, new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        model.Enabled = true;
        model.Enabled.Should().BeFalse("the extension must first be installed");
        await model.LoadAsync();
        model.Books.Select(b => b.Name).Should().Equal("בראשית", "שמות");
        model.Books[0].IsSelected = true;
        await model.DownloadSelectedAsync();
        model.Enabled.Should().BeTrue();
        model.Enabled = false;
        model.Enabled.Should().BeFalse();
        model.Enabled = true;
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeTrue();
        service.HasAudio(3).Should().BeFalse();
        model.Books[0].Status.Should().Be("2 מתוך 2 הקלטות מותקנות");
        model.SelectAllCommand.Execute(null);
        await model.DownloadSelectedAsync();
        service.HasAudio(3).Should().BeTrue();
        foreach (var id in Enumerable.Range(1, 3))
        {
            server.Requests.Count(p => p == $"/recordings/{id}_record.mp3").Should().Be(1, "completed books are reused");
        }
    }

    [Fact]
    public async Task SeparateExtension_DownloadsOnlyChosenChapters_Resumes_AndWorksOffline()
    {
        await using var storage = new TestStorage();
        using var server = new Server();
        var audio = "original MP3"u8.ToArray();
        server.Package = new(1, [Track(1, audio), Track(2, "other MP3"u8.ToArray())]);
        server.Audio["/recordings/1_record.mp3"] = audio;
        using var http = new HttpClient(server);
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        var changes = 0;
        service.Changed += (_, _) => changes++;
        service.RequestPlaybackStop();
        await service.InitializeAsync();
        service.IsInstalled.Should().BeFalse();
        await service.UpdateAsync();
        await service.DownloadAsync([1]);
        await service.DownloadAsync([1]);
        changes.Should().Be(3, "catalog refresh and completed downloads notify the reader");
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeFalse();
        server.Requests.Count(p => p == "/recordings/1_record.mp3").Should().Be(1);
        server.Requests.Should().NotContain("/recordings/2_record.mp3");
        var restored = new RecitationService(storage.FileSystem.Object, http);
        await restored.InitializeAsync();
        restored.IsInstalled.Should().BeTrue();
        restored.Tracks.Select(t => t.PerekId).Should().BeEquivalentTo([1, 2],
            "the offline catalog retains chapters whose audio has not been downloaded");
        var path = await restored.PrepareAudioAsync(1, Canonical());
        (await File.ReadAllBytesAsync(path)).Should().Equal(audio);
        Directory.Exists(Path.Combine(storage.Root, "extensions", "recitation")).Should().BeTrue();
        File.Exists(Path.Combine(storage.Root, "sefaria-dump-5784-sivan-4.perushim_notes.sqlite")).Should().BeFalse();
    }

    [Fact]
    public async Task UpdateRejectsUnapprovedIntervals_AndKeepsInstalledDatabase()
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "original MP3"u8.ToArray();
        var original = Track(1, audio);
        server.Package = new(1, [original]);
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await service.UpdateAsync();
        server.Package = new(1, [original with { AlignmentStatus = "pending" }]);
        await service.Invoking(s => s.UpdateAsync()).Should().ThrowAsync<InvalidDataException>();
        var restored = new RecitationService(storage.FileSystem.Object, http);
        await restored.InitializeAsync();
        restored.GetTrack(1).Should().BeEquivalentTo(original);
    }

    [Fact]
    public async Task ChecksumFailureCannotInstallRecording_AndCanBeRetried()
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "approved audio"u8.ToArray();
        server.Package = new(1, [Track(1, audio)]);
        server.Audio["/recordings/1_record.mp3"] = "corrupt audio"u8.ToArray();
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await service.UpdateAsync();
        await service.Invoking(s => s.DownloadAsync([1])).Should().ThrowAsync<InvalidDataException>();
        service.HasAudio(1).Should().BeFalse();
        Directory.EnumerateFiles(Path.Combine(storage.Root, "extensions", "recitation"), "*.download").Should().BeEmpty();
        server.Audio["/recordings/1_record.mp3"] = audio;
        await service.DownloadAsync([1]);
        service.HasAudio(1).Should().BeTrue();
    }

    [Fact]
    public async Task WordPlaybackRequiresExactCanonicalText_AndUnmodifiedApprovedIntervals()
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "approved audio"u8.ToArray();
        server.Package = new(1, [Track(1, audio)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await service.UpdateAsync(); await service.DownloadAsync([1]);
        var decoder = new Mock<IRecitationAudioDecoder>();
        decoder.Setup(d => d.CreateClipAsync(It.IsAny<string>(), It.IsAny<IReadOnlyList<(double Start, double End)>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("PCM WAV"u8.ToArray());
        var word = await service.PrepareAudioAsync(1, Canonical(), 100, 800, decoder: decoder.Object);
        (await File.ReadAllBytesAsync(word)).Should().Equal("PCM WAV"u8.ToArray());
        (double Start, double End)[] approved = [(100, 800)];
        decoder.Verify(d => d.CreateClipAsync(It.IsAny<string>(), It.Is<IReadOnlyList<(double Start, double End)>>(r => r.SequenceEqual(approved)), It.IsAny<CancellationToken>()), Times.Once);
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), 0, 800, decoder: decoder.Object)).Should().ThrowAsync<InvalidDataException>();
        var changed = Canonical(); changed[0].Segments[0].Value = "בדא";
        await service.Invoking(s => s.PrepareAudioAsync(1, changed, 100, 800, decoder: decoder.Object)).Should().ThrowAsync<InvalidDataException>();
        var verse = await service.PrepareAudioAsync(1, Canonical(), ranges: [(100, 1800)], decoder: decoder.Object);
        File.Exists(verse).Should().BeTrue();
    }

    [Theory]
    [InlineData("pending")] [InlineData("needs_review")]
    public async Task PendingChapterAllowsFullPlayback_ButCannotPlayWords(string status)
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "approved audio"u8.ToArray();
        server.Package = new(1, [Track(1, audio, status)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await service.UpdateAsync(); await service.DownloadAsync([1]);
        File.Exists(await service.PrepareAudioAsync(1, Canonical())).Should().BeTrue();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), 100, 800)).Should().ThrowAsync<InvalidDataException>();
    }

    private static async Task<RecitationPreferencesViewModel> PreferencesAsync(TestStorage storage, RecitationService service)
    {
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,1),(2,'שמות','Exodus',2,2)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL),(2,1,NULL)");
        var model = new RecitationPreferencesViewModel(service, PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()),
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        await model.LoadAsync();
        return model;
    }

    [Theory]
    [InlineData("metadata")]
    [InlineData("audio")]
    public async Task Preferences_CancellationReleasesDownload_AndAllowsRetry(string stage)
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "original MP3"u8.ToArray();
        server.Package = new(1, [Track(1, audio)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        var model = await PreferencesAsync(storage, service);
        await model.DownloadSelectedAsync(); model.Status.Should().Contain("בחרו");
        model.Books[0].IsSelected = true;
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        server.Handler = async (request, cancellation) =>
        {
            if (stage == "audio" && request.RequestUri!.AbsolutePath == "/api/recitation")
            {
                return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(
                    JsonSerializer.Serialize(server.Package, RecitationJsonContext.Default.RecitationPackage), Encoding.UTF8, "application/json") };
            }
            entered.SetResult();
            await Task.Delay(Timeout.Infinite, cancellation);
            throw new InvalidOperationException("Cancelled request unexpectedly continued");
        };
        var downloading = model.DownloadSelectedAsync();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        model.IsDownloading.Should().BeTrue(); model.IsIdle.Should().BeFalse();
        await model.DownloadSelectedAsync(); await model.UpdateTimingsAsync();
        server.Requests.Should().HaveCount(stage == "audio" ? 2 : 1, "busy commands must not start duplicate requests");
        model.CancelDownloadCommand.Execute(null); await downloading;
        model.IsIdle.Should().BeTrue(); service.HasAudio(1).Should().BeFalse();
        model.CancelDownloadCommand.Execute(null);
        model.Status.Should().Contain("הופסקה");
        Directory.EnumerateFiles(storage.Root, "*.download", SearchOption.AllDirectories).Should().BeEmpty();
        server.Handler = null;
        await model.DownloadSelectedAsync();
        service.HasAudio(1).Should().BeTrue(); model.Enabled.Should().BeTrue();
    }

    [Fact]
    public async Task Preferences_TimingRefreshPreservesAudio_OnFailureAndCancellation()
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "original MP3"u8.ToArray();
        server.Package = new(1, [Track(1, audio, "pending")]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await service.UpdateAsync(); await service.DownloadAsync([1]);
        var model = await PreferencesAsync(storage, service);
        await model.LoadAsync(); model.Books.Should().HaveCount(2); model.Books[0].IsSelected.Should().BeTrue();
        model.Books[1].Status.Should().Be("אין הקלטות זמינות");
        server.Package = new(1, [Track(1, audio)]);
        await model.UpdateTimingsAsync();
        service.GetTrack(1)!.AlignmentStatus.Should().Be("ready"); model.Status.Should().Contain("מעודכנת");
        server.Handler = (_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("offline"));
        await model.UpdateTimingsAsync(); model.Status.Should().Contain("לא הצליח");
        await model.DownloadSelectedAsync(); model.Status.Should().Contain("לא ניתן להשלים");
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        server.Handler = async (_, cancellation) =>
        {
            entered.SetResult(); await Task.Delay(Timeout.Infinite, cancellation);
            throw new InvalidOperationException("Cancelled request unexpectedly continued");
        };
        var refresh = model.UpdateTimingsAsync();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10));
        model.CancelDownloadCommand.Execute(null); await refresh;
        model.Status.Should().Contain("העדכון הופסק");
        service.HasAudio(1).Should().BeTrue(); service.GetTrack(1)!.AlignmentStatus.Should().Be("ready");
    }

    [Fact]
    public async Task Preferences_DamagedExtensionCanBeReinstalled()
    {
        await using var storage = new TestStorage();
        var directory = Path.Combine(storage.Root, "extensions", "recitation");
        Directory.CreateDirectory(directory);
        await File.WriteAllTextAsync(Path.Combine(directory, "recitation.sqlite"), "not SQLite");
        using var server = new Server(); using var http = new HttpClient(server);
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        var model = await PreferencesAsync(storage, service);
        model.Status.Should().Contain("לא ניתן לטעון");
        server.Package = new(1, [Track(1, "audio"u8.ToArray())]);
        await model.UpdateTimingsAsync();
        service.IsInstalled.Should().BeTrue(); model.Books.Should().HaveCount(2);
        await service.InitializeAsync(); await service.InitializeAsync();
    }

    [Fact]
    public async Task StaleExtensionRefreshesDaily_WithOfflineBackoff_WithoutTouchingAudio()
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "original MP3"u8.ToArray();
        server.Package = new(1, [Track(1, audio, "pending")]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await service.RefreshIfStaleAsync(); server.Requests.Should().BeEmpty();
        await service.UpdateAsync(); await service.DownloadAsync([1]);
        await service.RefreshIfStaleAsync(); server.Requests.Should().HaveCount(2);
        var path = Path.Combine(storage.Root, "extensions", "recitation", "recitation.sqlite");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddDays(-2));
        server.Package = new(1, [Track(1, audio)]);
        await service.RefreshIfStaleAsync(); service.GetTrack(1)!.AlignmentStatus.Should().Be("ready");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddDays(-2));
        await service.RefreshIfStaleAsync(); server.Requests.Should().HaveCount(3, "refresh attempts are throttled");
        var restored = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await restored.InitializeAsync();
        server.Handler = (_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("offline"));
        await restored.RefreshIfStaleAsync(); await restored.RefreshIfStaleAsync();
        server.Requests.Should().HaveCount(4); restored.HasAudio(1).Should().BeTrue();
        var stops = 0; restored.PlaybackStopRequested += (_, _) => stops++;
        restored.RequestPlaybackStop(); stops.Should().Be(1);
    }

    [Fact]
    public async Task PlaybackRejectsMissingDecoder_Download_OrIncompleteIntervals()
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        var audio = "original MP3"u8.ToArray();
        server.Package = new(1, [Track(1, audio)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        await service.UpdateAsync();
        await service.Invoking(s => s.DownloadAsync([929])).Should().ThrowAsync<InvalidOperationException>();
        await service.Invoking(s => s.PrepareAudioAsync(929, Canonical())).Should().ThrowAsync<InvalidOperationException>();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical())).Should().ThrowAsync<InvalidDataException>();
        await service.DownloadAsync([1]);
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), 100, null, CancellationToken.None, null, null))
            .Should().ThrowAsync<InvalidDataException>();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), null, 800, CancellationToken.None, null, null))
            .Should().ThrowAsync<InvalidDataException>();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), 100, 800)).Should().ThrowAsync<InvalidOperationException>();
    }

    [Fact]
    public async Task MissingServerCatalogRetainsInstalledExtension_WithoutNotifyingAChange()
    {
        await using var storage = new TestStorage();
        using var server = new Server(); using var http = new HttpClient(server);
        server.Package = new(1, [Track(1, "audio"u8.ToArray())]);
        var service = new RecitationService(storage.FileSystem.Object, http, new("https://example.com/api/recitation"));
        var changes = 0; service.Changed += (_, _) => changes++;
        await service.UpdateAsync();
        server.Handler = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("null", Encoding.UTF8, "application/json") });
        await service.Invoking(s => s.UpdateAsync()).Should().ThrowAsync<InvalidDataException>();
        changes.Should().Be(1); service.IsInstalled.Should().BeTrue();
        var restored = new RecitationService(storage.FileSystem.Object, http);
        await restored.InitializeAsync(); restored.GetTrack(1).Should().BeEquivalentTo(server.Package.Tracks[0]);
    }
}
