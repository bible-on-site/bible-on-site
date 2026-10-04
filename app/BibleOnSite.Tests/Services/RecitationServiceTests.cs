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
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var path = request.RequestUri!.AbsolutePath;
            Requests.Add(path);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = path == "/api/recitation"
                ? new StringContent(JsonSerializer.Serialize(Package, RecitationPackage.JsonOptions), Encoding.UTF8, "application/json")
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
        await service.InitializeAsync();
        service.IsInstalled.Should().BeFalse();
        await service.UpdateAsync();
        await service.DownloadAsync([1]);
        await service.DownloadAsync([1]);
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeFalse();
        server.Requests.Count(p => p == "/recordings/1_record.mp3").Should().Be(1);
        server.Requests.Should().NotContain("/recordings/2_record.mp3");
        var restored = new RecitationService(storage.FileSystem.Object, http);
        await restored.InitializeAsync();
        restored.IsInstalled.Should().BeTrue();
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
        decoder.Verify(d => d.CreateClipAsync(It.IsAny<string>(), It.Is<IReadOnlyList<(double Start, double End)>>(r => r.Count == 1 && r[0].Start == 100 && r[0].End == 800), It.IsAny<CancellationToken>()), Times.Once);
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
}
