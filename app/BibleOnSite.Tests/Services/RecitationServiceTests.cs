using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.Services;

public class RecitationServiceTests
{
    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));
    private static byte[] Wav(byte[] pcm)
    {
        var wav = new byte[44 + pcm.Length];
        "RIFF"u8.ToArray().CopyTo(wav, 0);
        BitConverter.GetBytes(36 + pcm.Length).CopyTo(wav, 4);
        "WAVE"u8.ToArray().CopyTo(wav, 8);
        "fmt "u8.ToArray().CopyTo(wav, 12);
        BitConverter.GetBytes(16).CopyTo(wav, 16);
        BitConverter.GetBytes((short)1).CopyTo(wav, 20);
        BitConverter.GetBytes((short)1).CopyTo(wav, 22);
        BitConverter.GetBytes(48000).CopyTo(wav, 24);
        BitConverter.GetBytes(96000).CopyTo(wav, 28);
        BitConverter.GetBytes((short)2).CopyTo(wav, 32);
        BitConverter.GetBytes((short)16).CopyTo(wav, 34);
        "data"u8.ToArray().CopyTo(wav, 36);
        BitConverter.GetBytes(pcm.Length).CopyTo(wav, 40);
        pcm.CopyTo(wav, 44);
        return wav;
    }
    private static List<Pasuk> Canonical() => [new() { PasukNum = 1, Text = "ברא אור", Segments = [
        new() { Type = SegmentType.Qri, Value = "ברא" }, new() { Type = SegmentType.Qri, Value = "אור" }] }];
    private static RecitationTrack Track(int id, byte[] audio, string status = "ready") => new(id,
        $"https://example.com/recordings/{id}_record.mp3", Hash(audio), Hash(Encoding.UTF8.GetBytes("1:1:ברא\n1:2:אור")),
        3000, status, status == "ready" ? [new(1, 1, "ברא", 100, 800), new(1, 2, "אור", 900, 1800)] : []);

    // There is no HTTP transport in this fixture or in the service under test.
    private sealed class Extension(TestStorage storage)
    {
        public RecitationPackage Package { get; set; } = new(1, []);
        public Dictionary<string, byte[]> Audio { get; } = [];
        public Dictionary<int, int> BookIds { get; } = [];
        public Mock<IPadDeliveryService> Delivery { get; } = new();
        public List<string> Requests { get; } = [];
        public RecitationService Service => new(storage.FileSystem.Object, Delivery.Object);
        public RecitationExtensionCatalog? Catalog { get; set; }

        public void SaveCatalog() => storage.PackageFiles[RecitationExtensionCatalog.FileName] =
            JsonSerializer.SerializeToUtf8Bytes(Catalog, RecitationJsonContext.Default.RecitationExtensionCatalog);

        // Convenience-overload downloads carry no test cancellation token.
        public Task DownloadAsync(RecitationService service, int[] perekIds, IProgress<double>? progress) =>
            service.DownloadAsync(perekIds, progress);

        public void Bundle(bool store = true)
        {
            var books = new List<RecitationBookPack>();
            foreach (var group in Package.Tracks.GroupBy(t => BookIds.GetValueOrDefault(t.PerekId, t.PerekId)))
            {
                using var output = new MemoryStream();
                using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
                {
                    foreach (var track in group.DistinctBy(t => t.PlaybackFileName))
                    {
                        using var entry = zip.CreateEntry(track.PlaybackFileName).Open();
                        entry.Write(Audio.GetValueOrDefault($"/recordings/{track.PerekId}_record.mp3", "audio"u8.ToArray()));
                    }
                }
                var bytes = output.ToArray();
                var book = new RecitationBookPack(group.Key, Hash(bytes), bytes.Length, group.Select(t => t.PerekId).ToList());
                books.Add(book);
                if (store)
                {
                    var directory = Path.Join(storage.Root, "store", book.PackName);
                    Directory.CreateDirectory(directory);
                    File.WriteAllBytes(Path.Join(directory, book.FileName), bytes);
                    var fetched = false;
                    Delivery.Setup(d => d.TryGetAssetPathAsync(book.PackName, It.IsAny<CancellationToken>()))
                        .Returns(() => Task.FromResult(fetched ? directory : null));
                    Delivery.Setup(d => d.FetchAsync(book.PackName, It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
                        .Returns((string name, IProgress<double>? progress, CancellationToken ct) =>
                        {
                            ct.ThrowIfCancellationRequested(); Requests.Add(name); fetched = true;
                            progress?.Report(1); return Task.FromResult(true);
                        });
                }
                else
                {
                    storage.PackageFiles[book.FileName] = bytes;
                }
            }
            Catalog = new(1, Package, books); SaveCatalog();
        }
    }

    [Fact]
    public async Task OpusBookUsesDerivedHashAndFilename_WithoutChangingMp3IdentityOrTimings()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var source = "original alignment MP3"u8.ToArray();
        var opus = "OggS derived playback"u8.ToArray();
        var track = Track(1, source) with { Playback = new("ogg-opus", Hash(opus), opus.Length, 24000, Hash(source)) };
        extension.Package = new(1, [track]);
        extension.Audio["/recordings/1_record.mp3"] = opus;
        extension.Bundle(); var service = extension.Service;
        await service.DownloadAsync([1]);
        var ogg = Directory.EnumerateFiles(Path.Join(storage.Root, "extensions", "recitation"), "*.ogg").Should().ContainSingle().Subject;
        Path.GetFileName(ogg).Should().Be(Hash(opus) + ".ogg");
        (await File.ReadAllBytesAsync(ogg, TestContext.Current.CancellationToken)).Should().Equal(opus);
        service.GetTrack(1)!.AudioSha256.Should().Be(Hash(source));
        service.GetTrack(1)!.Words.Should().Equal(track.Words);
        await File.WriteAllBytesAsync(ogg, source, TestContext.Current.CancellationToken);
        var corrupted = () => service.PrepareAudioAsync(1, Canonical(), null, null, TestContext.Current.CancellationToken,
            null, new Mock<IRecitationAudioDecoder>().Object);
        await corrupted.Should().ThrowAsync<InvalidDataException>();
    }

    [Fact]
    public async Task OpusChapterNeedsDecoderOnce_AndReplaysTheDecodedWav()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var source = "original alignment MP3"u8.ToArray();
        var opus = "OggS derived playback"u8.ToArray();
        var track = Track(1, source) with { Playback = new("ogg-opus", Hash(opus), opus.Length, 24000, Hash(source)) };
        extension.Package = new(1, [track]);
        extension.Audio["/recordings/1_record.mp3"] = opus;
        extension.Bundle(); var service = extension.Service;
        await service.DownloadAsync([1]);
        // AVPlayer has no Ogg demuxer; Android keeps native Ogg and never reaches this.
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical())).Should().ThrowAsync<InvalidOperationException>();
        var decoder = new Mock<IRecitationAudioDecoder>();
        var decodedWav = Wav("decoded chapter PCM"u8.ToArray());
        decoder.Setup(d => d.CreateChapterAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(decodedWav);
        var chapter = await service.PrepareAudioAsync(1, Canonical(), null, null, TestContext.Current.CancellationToken, null, decoder.Object);
        Path.GetFileName(chapter).Should().Be("chapter-" + Hash(opus) + ".wav");
        (await File.ReadAllBytesAsync(chapter, TestContext.Current.CancellationToken)).Should().Equal(decodedWav);
        var restored = extension.Service;
        await restored.InitializeAsync();
        var replay = await restored.PrepareAudioAsync(1, Canonical(), null, null, TestContext.Current.CancellationToken, null, decoder.Object);
        replay.Should().Be(chapter, "a verified decoded chapter is replayed without decoding again");
        decoder.Verify(d => d.CreateChapterAsync(It.Is<string>(p => p.EndsWith(".ogg")), It.IsAny<CancellationToken>()), Times.Once);
        decoder.Verify(d => d.CreateClipAsync(It.IsAny<string>(), It.IsAny<IReadOnlyList<(double Start, double End)>>(),
            It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task AndroidKeepsNativeOggPlayback_WithoutDecoder()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var source = "original alignment MP3"u8.ToArray();
        var opus = "OggS derived playback"u8.ToArray();
        var track = Track(1, source) with { Playback = new("ogg-opus", Hash(opus), opus.Length, 24000, Hash(source)) };
        extension.Package = new(1, [track]);
        extension.Audio["/recordings/1_record.mp3"] = opus;
        extension.Bundle();
        // ExoPlayer demuxes Ogg natively, so no WAV chapter is produced for it.
        var service = new RecitationService(storage.FileSystem.Object, extension.Delivery.Object, () => true);
        await service.DownloadAsync([1]);
        var audio = await service.PrepareAudioAsync(1, Canonical());
        audio.Should().EndWith(".ogg");
        (await File.ReadAllBytesAsync(audio, TestContext.Current.CancellationToken)).Should().Equal(opus);
        Directory.EnumerateFiles(storage.Root, "*.wav", SearchOption.AllDirectories).Should().BeEmpty();
    }

    private static byte[] Corrupt(byte[] wav, int offset)
    {
        var copy = wav.ToArray();
        copy[offset] = 0;
        return copy;
    }

    [Theory]
    [InlineData("garbage")] [InlineData("magic")] [InlineData("wave")] [InlineData("truncated")]
    [InlineData("payload")] [InlineData("missingDigest")] [InlineData("badDigest")]
    public async Task OpusChapterCacheDamageDecodesAgain(string damage)
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var source = "original alignment MP3"u8.ToArray();
        var opus = "OggS derived playback"u8.ToArray();
        var track = Track(1, source) with { Playback = new("ogg-opus", Hash(opus), opus.Length, 24000, Hash(source)) };
        extension.Package = new(1, [track]);
        extension.Audio["/recordings/1_record.mp3"] = opus;
        extension.Bundle(); var service = extension.Service;
        await service.DownloadAsync([1]);
        var decoder = new Mock<IRecitationAudioDecoder>();
        var decodedWav = Wav("decoded chapter PCM"u8.ToArray());
        decoder.Setup(d => d.CreateChapterAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(decodedWav);
        var chapter = await service.PrepareAudioAsync(1, Canonical(), null, null, TestContext.Current.CancellationToken, null, decoder.Object);
        var damaged = damage switch
        {
            "truncated" => decodedWav[..^5],
            "magic" => Corrupt(decodedWav, 0),
            "wave" => Corrupt(decodedWav, 8),
            "payload" => Corrupt(decodedWav, decodedWav.Length - 1),
            "missingDigest" or "badDigest" => decodedWav,
            _ => "damaged"u8.ToArray(),
        };
        await File.WriteAllBytesAsync(chapter, damaged, TestContext.Current.CancellationToken);
        if (damage == "missingDigest")
        {
            File.Delete(chapter + ".sha256");
        }
        if (damage == "badDigest")
        {
            await File.WriteAllTextAsync(chapter + ".sha256", "invalid", TestContext.Current.CancellationToken);
        }
        var rebuilt = await service.PrepareAudioAsync(1, Canonical(), null, null, TestContext.Current.CancellationToken, null, decoder.Object);
        rebuilt.Should().Be(chapter);
        (await File.ReadAllBytesAsync(rebuilt, TestContext.Current.CancellationToken)).Should().Equal(decodedWav);
        decoder.Verify(d => d.CreateChapterAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    public async Task OpusClipsStillUseApprovedRanges_NotTheChapterFallback()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var source = "original alignment MP3"u8.ToArray();
        var opus = "OggS derived playback"u8.ToArray();
        var track = Track(1, source) with { Playback = new("ogg-opus", Hash(opus), opus.Length, 24000, Hash(source)) };
        extension.Package = new(1, [track]);
        extension.Audio["/recordings/1_record.mp3"] = opus;
        extension.Bundle(); var service = extension.Service;
        await service.DownloadAsync([1]);
        var decoder = new Mock<IRecitationAudioDecoder>();
        decoder.Setup(d => d.CreateClipAsync(It.IsAny<string>(), It.IsAny<IReadOnlyList<(double Start, double End)>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("clip WAV"u8.ToArray());
        var clip = await service.PrepareAudioAsync(1, Canonical(), 100, 800, decoder: decoder.Object);
        Path.GetFileName(clip).Should().StartWith("clip-");
        (await File.ReadAllBytesAsync(clip, TestContext.Current.CancellationToken)).Should().Equal("clip WAV"u8.ToArray());
        (double Start, double End)[] approved = [(100, 800)];
        decoder.Verify(d => d.CreateClipAsync(It.Is<string>(p => p.EndsWith(".ogg")),
            It.Is<IReadOnlyList<(double Start, double End)>>(r => r.SequenceEqual(approved)),
            It.IsAny<CancellationToken>()), Times.Once);
        decoder.Verify(d => d.CreateChapterAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData(false)] [InlineData(true)]
    public async Task Mp3UpgradeDeletesOnlyReplacedDownloads_AndKeepsThemOnFailure(bool stillRequired)
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var source = "original MP3"u8.ToArray(); var opus = "OggS playback"u8.ToArray();
        extension.Package = new(1, [Track(1, source)]);
        extension.Audio["/recordings/1_record.mp3"] = source;
        extension.Bundle(); var service = extension.Service;
        await service.DownloadAsync([1]);
        var original = await service.PrepareAudioAsync(1, Canonical());
        var upgraded = Track(1, source) with { Playback = new("ogg-opus", Hash(opus), opus.Length, 24000, Hash(source)) };
        extension.Package = new(1, stillRequired ? [upgraded, Track(2, source)] : [upgraded]);
        extension.Audio["/recordings/1_record.mp3"] = "corrupt"u8.ToArray();
        extension.Bundle(); await service.UpdateAsync(TestContext.Current.CancellationToken);
        await service.Invoking(s => s.DownloadAsync([1])).Should().ThrowAsync<InvalidDataException>();
        File.Exists(original).Should().BeTrue();
        extension.Audio["/recordings/1_record.mp3"] = opus;
        extension.Bundle(); await service.UpdateAsync(TestContext.Current.CancellationToken);
        await service.DownloadAsync([1]);
        File.Exists(original).Should().Be(stillRequired);
        var ogg = Directory.EnumerateFiles(Path.Join(storage.Root, "extensions", "recitation"), "*.ogg").Should().ContainSingle().Subject;
        (await File.ReadAllBytesAsync(ogg, TestContext.Current.CancellationToken)).Should().Equal(opus);
    }

    [Fact]
    public async Task StoreDeliveryDownloadsWholeSelectedBook_ResumesAndPlaysOffline()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var audio = "original MP3"u8.ToArray();
        extension.Package = new(1, [Track(1, audio), Track(2, "second"u8.ToArray()), Track(3, "third"u8.ToArray())]);
        extension.Audio["/recordings/1_record.mp3"] = audio;
        extension.Audio["/recordings/2_record.mp3"] = "second"u8.ToArray();
        extension.Audio["/recordings/3_record.mp3"] = "third"u8.ToArray();
        extension.BookIds[1] = 1; extension.BookIds[2] = 1; extension.BookIds[3] = 2;
        extension.Bundle(); var service = extension.Service;
        await service.InitializeAsync(); service.HasAudio(1).Should().BeFalse();
        await service.DownloadAsync([1]);
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeTrue(); service.HasAudio(3).Should().BeFalse();
        await service.DownloadAsync([1, 2]); extension.Requests.Should().Equal("recitation_1");
        var restored = extension.Service; await restored.InitializeAsync();
        (await File.ReadAllBytesAsync(await restored.PrepareAudioAsync(1, Canonical()), TestContext.Current.CancellationToken)).Should().Equal(audio);
        await restored.DownloadAsync([3]); extension.Requests.Should().Equal("recitation_1", "recitation_2");
        extension.Delivery.Verify(d => d.FetchAsync("perushim_notes", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task DesktopOrDebugUsesSamePackagedArchive_WithoutNetworkFallback()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle(store: false); var service = extension.Service;
        await service.DownloadAsync([1]);
        (await File.ReadAllBytesAsync(await service.PrepareAudioAsync(1, Canonical()), TestContext.Current.CancellationToken)).Should().Equal("audio"u8.ToArray());
        Directory.EnumerateFiles(storage.Root, "*.download", SearchOption.AllDirectories).Should().BeEmpty();
    }

    [Theory]
    [InlineData("archive")] [InlineData("archiveHash")] [InlineData("audio")]
    [InlineData("inventory")] [InlineData("wrongInventory")]
    public async Task CorruptOrWrongReleasePackIsRejected_AndExistingAudioSurvives(string fault)
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle(); var service = extension.Service; await service.DownloadAsync([1]);
        var originalPath = await service.PrepareAudioAsync(1, Canonical());
        var replacement = "replacement"u8.ToArray(); extension.Package = new(1, [Track(1, replacement)]);
        extension.Audio["/recordings/1_record.mp3"] = fault == "audio" ? "corrupt"u8.ToArray() : replacement;
        extension.Bundle(); var pack = extension.Catalog!.Books[0];
        var path = Path.Join(storage.Root, "store", pack.PackName, pack.FileName);
        if (fault == "archive")
        {
            await File.AppendAllTextAsync(path, "damage", TestContext.Current.CancellationToken);
        }
        if (fault == "archiveHash")
        {
            var bytes = await File.ReadAllBytesAsync(path, TestContext.Current.CancellationToken); bytes[0] ^= 1;
            await File.WriteAllBytesAsync(path, bytes, TestContext.Current.CancellationToken);
        }
        if (fault is "inventory" or "wrongInventory")
        {
            using (var archive = ZipFile.Open(path, ZipArchiveMode.Update))
            {
                if (fault == "wrongInventory")
                {
                    archive.Entries[0].Delete();
                }
                archive.CreateEntry("../escape.mp3");
            }
            var bytes = await File.ReadAllBytesAsync(path, TestContext.Current.CancellationToken);
            extension.Catalog = extension.Catalog with { Books = [pack with { Sha256 = Hash(bytes), SizeBytes = bytes.Length }] };
            extension.SaveCatalog();
        }
        await service.UpdateAsync(TestContext.Current.CancellationToken);
        await service.Invoking(s => s.DownloadAsync([1])).Should().ThrowAsync<InvalidDataException>();
        service.HasAudio(1).Should().BeFalse();
        File.Exists(originalPath).Should().BeFalse(
            "the rotated catalog orphaned the old audioSha256, so UpdateAsync swept it");
        Directory.EnumerateFiles(Path.Join(storage.Root, "extensions", "recitation")).Should().BeEmpty(
            "a rejected pack lands nothing: no new audio, no orphaned MP3, no fragments");
        Directory.EnumerateFiles(storage.Root, "*.download", SearchOption.AllDirectories).Should().BeEmpty();
    }

    [Fact]
    public async Task CachedBookRepairsCorruptLocalAudio_AndDoesNotFetchDuplicateRecordings()
    {
        await using var storage = new TestStorage();
        var audio = "original MP3"u8.ToArray();
        var extension = new Extension(storage) { Package = new(1, [Track(1, audio), Track(2, audio)]) };
        extension.Audio["/recordings/1_record.mp3"] = audio;
        extension.BookIds[1] = 1; extension.BookIds[2] = 1; extension.Bundle();
        var pack = extension.Catalog!.Books[0];
        var directory = Path.Join(storage.Root, "store", pack.PackName);
        Directory.CreateDirectory(Path.Join(directory, "assets"));
        File.Move(Path.Join(directory, pack.FileName), Path.Join(directory, "assets", pack.FileName));
        extension.Delivery.Setup(d => d.TryGetAssetPathAsync(pack.PackName, It.IsAny<CancellationToken>())).ReturnsAsync(directory);
        var service = extension.Service; var changes = 0;
        service.Changed += (_, _) => changes++;
        service.RequestPlaybackStop();
        await service.InitializeAsync(); service.Tracks.Should().BeEquivalentTo(extension.Package.Tracks);
        var progress = new List<double>();
        await extension.DownloadAsync(service, [1], new ImmediateProgress(progress.Add));
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeTrue();
        var path = await service.PrepareAudioAsync(1, Canonical());
        await File.WriteAllBytesAsync(path, "damaged"u8.ToArray(), TestContext.Current.CancellationToken);
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical())).Should().ThrowAsync<InvalidDataException>();
        await service.DownloadAsync([2]);
        (await File.ReadAllBytesAsync(path, TestContext.Current.CancellationToken)).Should().Equal(audio);
        Directory.EnumerateFiles(Path.Join(storage.Root, "extensions", "recitation"), "*.mp3").Should().ContainSingle();
        extension.Delivery.Verify(d => d.FetchAsync(It.IsAny<string>(), It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()), Times.Never);
        progress.Should().Equal(1); changes.Should().Be(3);
    }

    private sealed class ImmediateProgress(Action<double> report) : IProgress<double>
    {
        public void Report(double value) => report(value);
    }

    [Fact]
    public async Task AppUpdateSuppliesNewTimings_AndReusesVerifiedAudio()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray(), "pending")]) };
        extension.Bundle(); var old = extension.Service; await old.DownloadAsync([1]);
        extension.Package = new(1, [Track(1, "audio"u8.ToArray())]); extension.Bundle();
        var updated = extension.Service; await updated.RefreshIfStaleAsync(); await updated.DownloadAsync([1]);
        updated.GetTrack(1)!.AlignmentStatus.Should().Be("ready");
        extension.Requests.Should().Equal(["recitation_1"], "the update reuses matching audio");
        var stops = 0; updated.PlaybackStopRequested += (_, _) => stops++;
        updated.RequestPlaybackStop(); stops.Should().Be(1);
    }

    [Fact]
    public async Task InvalidCatalogCannotReplaceInstalledMetadata()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle(); var service = extension.Service; await service.UpdateAsync(TestContext.Current.CancellationToken);
        storage.PackageFiles[RecitationExtensionCatalog.FileName] = "null"u8.ToArray();
        await service.Invoking(s => s.UpdateAsync()).Should().ThrowAsync<InvalidDataException>();
        service.GetTrack(1)!.AlignmentStatus.Should().Be("ready");
        extension.Package = new(1, [Track(1, "audio"u8.ToArray()) with { AlignmentStatus = "pending" }]); extension.Bundle();
        await service.Invoking(s => s.UpdateAsync()).Should().ThrowAsync<InvalidDataException>();
        service.GetTrack(1)!.AlignmentStatus.Should().Be("ready");
    }

    [Fact]
    public async Task PreferencesCancellationPreservesCompletedBooks_AndCanResume()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,1),(2,'שמות','Exodus',2,2)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL),(2,1,NULL)");
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray()), Track(2, "second"u8.ToArray())]) };
        extension.Audio["/recordings/2_record.mp3"] = "second"u8.ToArray(); extension.Bundle(); var service = extension.Service;
        var model = new RecitationPacksViewModel(service,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        await model.LoadAsync();
        await model.DownloadBookAsync(null); model.Status.Should().Contain("התקינו");
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        extension.Delivery.Setup(d => d.FetchAsync("recitation_2", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, IProgress<double>? _, CancellationToken ct) =>
            {
                entered.SetResult(); await Task.Delay(Timeout.Infinite, ct); return false;
            });
        var downloading = model.DownloadAllAsync(); await entered.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        model.IsDownloading.Should().BeTrue(); await model.DownloadAllAsync();
        model.CancelDownloadCommand.Execute(null); await downloading;
        model.IsIdle.Should().BeTrue(); model.Status.Should().Contain("הופסקה");
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeFalse();
        extension.Bundle(); await model.DownloadAllAsync();
        service.HasAudio(2).Should().BeTrue(); model.InstallState.Should().Be(RecitationInstallState.Installed);
        model.Books[0].Status.Should().Contain("1 מתוך 1");
        Directory.EnumerateFiles(storage.Root, "*.download", SearchOption.AllDirectories).Should().BeEmpty();
    }

    [Theory]
    [InlineData("ready")]
    [InlineData("pending")]
    public async Task PreferencesShowUnavailableBooks_AndRetryAFailedExtensionInstall(string alignmentStatus)
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,1),(2,'שמות','Exodus',2,2)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL),(2,1,NULL)");
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray(), alignmentStatus)]) };
        var model = new RecitationPacksViewModel(extension.Service,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        await model.LoadAsync(); model.Status.Should().Contain("לא ניתן לטעון");
        extension.Bundle(store: false);
        await model.LoadAsync(); await model.LoadAsync(); model.Books.Should().HaveCount(2);
        model.Books[0].CanDownload.Should().BeTrue("an offered book always exposes its download action");
        model.Books[0].Status.Should().Contain("0 מתוך 1");
        model.Books[1].CanDownload.Should().BeFalse();
        model.Books[1].Status.Should().Be("אין הקלטות זמינות");
        // A book with no catalogued recordings must not trigger a store request.
        await model.DownloadBookAsync(model.Books[1]);
        model.Status.Should().Contain("אין הקלטות זמינות");
        extension.Requests.Should().BeEmpty();
        var filename = extension.Catalog!.Books[0].FileName;
        var bytes = storage.PackageFiles[filename]; storage.PackageFiles.Remove(filename);
        await model.DownloadBookAsync(model.Books[0]); model.Status.Should().Contain("לא ניתן להשלים");
        model.IsIdle.Should().BeTrue(); model.InstallState.Should().Be(RecitationInstallState.NotInstalled);
        storage.PackageFiles[filename] = bytes;
        await model.DownloadBookAsync(model.Books[0]);
        model.InstallState.Should().Be(RecitationInstallState.Installed);
        model.Books[0].Status.Should().Contain("1 מתוך 1").And.Contain("MB");
        model.Books[0].ShowRemove.Should().BeTrue();
    }

    [Fact]
    public async Task PreferencesRemoveBook_RequiresConfirmation_AndDeletesOnlyThatBook()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,1),(2,'שמות','Exodus',2,2)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL),(2,2,NULL)");
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray()), Track(2, "second"u8.ToArray())]) };
        extension.Audio["/recordings/2_record.mp3"] = "second"u8.ToArray();
        extension.BookIds[1] = 1; extension.BookIds[2] = 2; extension.Bundle();
        var service = extension.Service;
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), "הסרה", "ביטול")).ReturnsAsync(false);
        var model = new RecitationPacksViewModel(service,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)), navigator.Object);
        await model.LoadAsync();
        await model.DownloadAllAsync();
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeTrue();
        model.SummaryText.Should().Be("מותקנת - 2 מתוך 2 הקלטות מותקנות");

        // Declining the confirmation removes nothing.
        await model.RemoveBookAsync(model.Books[0]);
        service.HasAudio(1).Should().BeTrue("a declined confirmation never deletes");

        navigator.Setup(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), "הסרה", "ביטול")).ReturnsAsync(true);
        await model.RemoveBookAsync(model.Books[0]);
        service.HasAudio(1).Should().BeFalse();
        service.HasAudio(2).Should().BeTrue("removal is scoped to the chosen book");
        model.Books[0].HasInstalled.Should().BeFalse();
        model.Books[1].HasInstalled.Should().BeTrue();
        model.SummaryText.Should().Be("מותקנת חלקית - 1 מתוך 2 הקלטות מותקנות");
        model.Status.Should().Contain("בראשית");
        model.CanRemove.Should().BeTrue();

        await model.RemoveAllAsync();
        service.HasAudio(2).Should().BeFalse();
        service.InstallState.Should().Be(RecitationInstallState.NotInstalled);
        model.SummaryText.Should().Be("לא מותקנת");
        model.CanRemove.Should().BeFalse();
        model.Status.Should().Contain("הוסרו");

        // Reinstall right after removal: download-all installs every book again.
        await model.DownloadAllAsync();
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeTrue();
        model.SummaryText.Should().Be("מותקנת - 2 מתוך 2 הקלטות מותקנות");
    }

    [Fact]
    public async Task PreferencesRemoveAll_WhenNothingInstalled_DoesNotAsk()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var navigator = new Mock<IAppNavigator>();
        var model = new RecitationPacksViewModel(extension.Service,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)), navigator.Object);
        await model.RemoveAllAsync();
        navigator.Verify(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task MissingCatalogKeepsBookChoices_AndReportsNotInstalled()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var model = new RecitationPacksViewModel(extension.Service,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        model.Books.Add(new RecitationBookChoice { Name = "בראשית", PerekIds = [1] });
        model.InstallState.Should().Be(RecitationInstallState.NotInstalled);
        model.SummaryText.Should().Be("לא מותקנת");
        await model.DownloadAllAsync(); model.Status.Should().Contain("לא ניתן להשלים");
        model.Books.Should().ContainSingle();
        model.Books[0].CanDownload.Should().BeTrue("an unavailable catalog must allow retrying the installation");
        model.Books[0].Status.Should().Be("זמינות תיבדק בעת ההורדה");
        model.CancelDownloadCommand.Execute(null); model.IsIdle.Should().BeTrue();
    }

    [Fact]
    public async Task ActivePreferencesDownloadShowsProgress_AndCompletedStatusIgnoresLateProgress()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle(); var service = extension.Service; await service.InitializeAsync();
        var model = new RecitationPacksViewModel(service,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        model.Books.Add(new RecitationBookChoice { Name = "בראשית", PerekIds = [1] });
        var observed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        model.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName == nameof(model.Progress) && model.Progress > 0)
            {
                observed.TrySetResult();
            }
        };
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        IProgress<double>? deliveredProgress = null;
        extension.Delivery.Setup(d => d.FetchAsync("recitation_1", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, IProgress<double>? progress, CancellationToken _) =>
            {
                deliveredProgress = progress; progress!.Report(0.5); await release.Task; return true;
            });
        // Emulate the provider making a complete archive available only after download.
        var directory = Path.Join(storage.Root, "store", "recitation_1");
        extension.Delivery.Setup(d => d.TryGetAssetPathAsync("recitation_1", It.IsAny<CancellationToken>()))
            .Returns(() => Task.FromResult(release.Task.IsCompleted ? directory : null));
        var downloading = model.DownloadAllAsync();
        await observed.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        model.IsDownloading.Should().BeTrue(); model.Progress.Should().BeApproximately(0.45, 1e-10);
        release.SetResult(); await downloading;
        var completed = model.Status;
        deliveredProgress!.Report(0.25);
        await Task.Delay(50, TestContext.Current.CancellationToken);
        model.CancelDownloadCommand.Execute(null);
        model.Status.Should().Be(completed); model.IsIdle.Should().BeTrue();
    }
    [Fact]
    public async Task Preferences_NarrationControlsPersistIndependentlyAndNotifyTheirLabels()
    {
        await using var storage = new TestStorage();
        var server = new Extension(storage);
        var service = server.Service;
        var saved = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(saved);
        var model = new RecitationPreferencesViewModel(service, preferences);
        model.Speed.Should().Be(1); model.Volume.Should().Be(1);
        model.OriginalPauses.Should().BeTrue(); model.CustomPauses.Should().BeFalse();
        model.PauseSeconds = 0; model.OriginalPauses.Should().BeTrue("a hidden slider must not change the default");
        var notifications = new List<string>(); model.PropertyChanged += (_, e) => notifications.Add(e.PropertyName!);
        model.Speed = 1.6; model.Volume = 0.35;
        model.OriginalPauses = false; model.PauseSeconds = 1.6;
        model.Speed.Should().Be(1.5); model.Volume.Should().Be(0.35);
        model.CustomPauses.Should().BeTrue(); model.PauseSeconds.Should().Be(1.5);
        notifications.Should().Contain(["Speed", "Volume", "OriginalPauses", "CustomPauses", "PauseSeconds"]);
        var restored = PreferencesService.CreateForTesting(saved); restored.Load();
        restored.RecitationSpeed.Should().Be(1.5); restored.RecitationVolume.Should().Be(0.35);
        restored.RecitationVersePauseMs.Should().Be(1500);
        model.OriginalPauses = true; preferences.RecitationVersePauseMs.Should().Be(-1);
        service.InstallState.Should().Be(RecitationInstallState.NotInstalled,
            "playback controls stay visible regardless of install state — the reader's player owns start/stop");
    }

    [Fact]
    public async Task CustomPauseIsPassedSeparatelyWithoutChangingApprovedIntervals()
    {
        await using var storage = new TestStorage();
        var server = new Extension(storage);
        var audio = "approved audio"u8.ToArray();
        server.Package = new(1, [Track(1, audio)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = server.Service;
        server.Bundle(); await service.UpdateAsync(TestContext.Current.CancellationToken); await service.DownloadAsync([1]);
        var decoder = new Mock<IRecitationAudioDecoder>();
        decoder.Setup(d => d.CreateClipAsync(It.IsAny<string>(), It.IsAny<IReadOnlyList<(double Start, double End)>>(), It.IsAny<CancellationToken>(), 2000)).ReturnsAsync("WAV"u8.ToArray());
        var ranges = new List<(double Start, double End)> { (100, 1800) };
        var clip = await service.PrepareAudioAsync(1, Canonical(), null, null, CancellationToken.None, ranges, decoder.Object, 2000);
        (await File.ReadAllBytesAsync(clip, TestContext.Current.CancellationToken)).Should().Equal("WAV"u8.ToArray());
        decoder.Verify(d => d.CreateClipAsync(It.IsAny<string>(), It.Is<IReadOnlyList<(double Start, double End)>>(r => r.SequenceEqual(ranges)), It.IsAny<CancellationToken>(), 2000), Times.Once);
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), null, null, CancellationToken.None, ranges, decoder.Object, double.NaN)).Should().ThrowAsync<InvalidDataException>();
    }

    [Fact]
    public async Task WordPlaybackRequiresExactCanonicalText_AndUnmodifiedApprovedIntervals()
    {
        await using var storage = new TestStorage();
        var server = new Extension(storage);
        var audio = "approved audio"u8.ToArray();
        server.Package = new(1, [Track(1, audio)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = server.Service;
        server.Bundle(); await service.UpdateAsync(TestContext.Current.CancellationToken); await service.DownloadAsync([1]);
        var decoder = new Mock<IRecitationAudioDecoder>();
        decoder.Setup(d => d.CreateClipAsync(It.IsAny<string>(), It.IsAny<IReadOnlyList<(double Start, double End)>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("PCM WAV"u8.ToArray());
        var word = await service.PrepareAudioAsync(1, Canonical(), 100, 800, decoder: decoder.Object);
        (await File.ReadAllBytesAsync(word, TestContext.Current.CancellationToken)).Should().Equal("PCM WAV"u8.ToArray());
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
        var server = new Extension(storage);
        var audio = "approved audio"u8.ToArray();
        server.Package = new(1, [Track(1, audio, status)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = server.Service;
        server.Bundle(); await service.UpdateAsync(TestContext.Current.CancellationToken); await service.DownloadAsync([1]);
        File.Exists(await service.PrepareAudioAsync(1, Canonical())).Should().BeTrue();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), 100, 800)).Should().ThrowAsync<InvalidDataException>();
    }

    [Fact]
    public async Task WordPreviewMarksTheResumePositionForChapterPlayback()
    {
        await using var storage = new TestStorage();
        var server = new Extension(storage);
        var audio = "approved audio"u8.ToArray();
        var track = new RecitationTrack(1, "https://example.com/recordings/1_record.mp3", Hash(audio),
            Hash(Encoding.UTF8.GetBytes("1:1:א\n1:2:ב\n2:1:ג")), 3000, "ready",
            [new(1, 1, "א", 100, 800), new(1, 2, "ב", 900, 1800), new(2, 1, "ג", 2000, 2600)]);
        server.Package = new(1, [track]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = server.Service;
        server.Bundle(); await service.UpdateAsync(TestContext.Current.CancellationToken); await service.DownloadAsync([1]);
        List<Pasuk> pasukim = [
            new() { PasukNum = 1, Text = "א ב", Segments = [new() { Type = SegmentType.Qri, Value = "א" }, new() { Type = SegmentType.Qri, Value = "ב" }] },
            new() { PasukNum = 2, Text = "ג", Segments = [new() { Type = SegmentType.Qri, Value = "ג" }] }];
        var decoder = new Mock<IRecitationAudioDecoder>();
        decoder.Setup(d => d.CreateClipAsync(It.IsAny<string>(), It.IsAny<IReadOnlyList<(double Start, double End)>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync("PCM WAV"u8.ToArray());
        // The tapped word still plays only its own approved interval.
        var wordClip = await service.PrepareAudioAsync(1, pasukim, 900, 1800, decoder: decoder.Object);
        (await File.ReadAllBytesAsync(wordClip, TestContext.Current.CancellationToken)).Should().Equal("PCM WAV"u8.ToArray());
        (double Start, double End)[] wordRange = [(900, 1800)];
        decoder.Verify(d => d.CreateClipAsync(It.IsAny<string>(), It.Is<IReadOnlyList<(double Start, double End)>>(r => r.SequenceEqual(wordRange)), It.IsAny<CancellationToken>()), Times.Once);
        // The main Play button prepares the whole perek as joined pasuk ranges...
        var chapterRanges = track.Words.GroupBy(w => w.Pasuk).OrderBy(g => g.Key)
            .Select(g => (g.First().StartMs!.Value, g.Last().EndMs!.Value)).ToList();
        var chapterClip = await service.PrepareAudioAsync(1, pasukim, null, null, CancellationToken.None, chapterRanges, decoder.Object, 0);
        File.Exists(chapterClip).Should().BeTrue();
        // ...and the tapped word maps to its position inside that clip, not zero.
        var timeline = new RecitationTimeline(track, chapterRanges, 0);
        timeline.PositionOf(900).Should().Be(800);
        timeline.PositionOf(2000).Should().Be(1700);
    }

    [Fact]
    public async Task PlaybackRejectsMissingDecoder_Download_OrIncompleteIntervals()
    {
        await using var storage = new TestStorage();
        var server = new Extension(storage);
        var audio = "original MP3"u8.ToArray();
        server.Package = new(1, [Track(1, audio)]); server.Audio["/recordings/1_record.mp3"] = audio;
        var service = server.Service;
        server.Bundle(); await service.UpdateAsync(TestContext.Current.CancellationToken);
        await service.Invoking(s => s.DownloadAsync([929])).Should().ThrowAsync<InvalidOperationException>();
        await service.Invoking(s => s.PrepareAudioAsync(929, Canonical())).Should().ThrowAsync<InvalidOperationException>();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical())).Should().ThrowAsync<InvalidDataException>();
        await service.DownloadAsync([1]);
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), 100, null, CancellationToken.None, null, null))
            .Should().ThrowAsync<InvalidDataException>();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), null, 800, CancellationToken.None, null, null))
            .Should().ThrowAsync<InvalidDataException>();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), 100, 800)).Should().ThrowAsync<InvalidOperationException>();
        await service.Invoking(s => s.PrepareAudioAsync(1, Canonical(), [], new Mock<IRecitationAudioDecoder>().Object))
            .Should().ThrowAsync<InvalidDataException>();
    }

    [Fact]
    public async Task RemoveAll_OnAbsentDirectory_CompletesSilently()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        var stops = 0;
        service.PlaybackStopRequested += (_, _) => stops++;

        await service.RemoveAllAsync();

        stops.Should().Be(1, "playback is stopped even when there is nothing to delete");
        Directory.Exists(Path.Join(storage.Root, "extensions", "recitation")).Should().BeFalse();
        service.InstallState.Should().Be(RecitationInstallState.NotInstalled);
    }

    [Fact]
    public async Task OrphanSweep_SkipsWhileADownloadHoldsTheGate()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        await service.InitializeAsync();
        var audioDir = Path.Join(storage.Root, "extensions", "recitation");
        Directory.CreateDirectory(audioDir);
        var orphan = Path.Join(audioDir, "stale-generation.mp3");
        await File.WriteAllTextAsync(orphan, "orphan", TestContext.Current.CancellationToken);

        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        extension.Delivery.Setup(d => d.FetchAsync("recitation_1", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, IProgress<double>? _, CancellationToken _) =>
            {
                entered.SetResult();
                await release.Task;
                return true;
            });
        var downloading = service.DownloadAsync([1]);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);

        // A catalog update mid-download must not sweep files the download may still write.
        await service.UpdateAsync(TestContext.Current.CancellationToken);
        File.Exists(orphan).Should().BeTrue("the sweep defers while the download gate is held");

        release.SetResult();
        // The store fetch resolves but no pack is delivered, so the bundled fallback is tried.
        await FluentActions.Awaiting(() => downloading).Should().ThrowAsync<FileNotFoundException>();
        await service.UpdateAsync(TestContext.Current.CancellationToken);
        File.Exists(orphan).Should().BeFalse("the next sweep collects the orphan once the gate frees");
    }

    [Fact]
    public async Task OrphanSweep_LogsUndeletableOrphans_AndKeepsSweeping()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        await service.InitializeAsync();
        var audioDir = Path.Join(storage.Root, "extensions", "recitation");
        Directory.CreateDirectory(audioDir);
        var undeletable = Path.Join(audioDir, "locked-generation.mp3");
        var collectible = Path.Join(audioDir, "collectible.mp3");
        await File.WriteAllTextAsync(undeletable, "orphan", TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(collectible, "orphan", TestContext.Current.CancellationToken);

        // Read-only files cannot be deleted on Windows; a read-only parent blocks the unlink on Unix.
        File.SetAttributes(undeletable, FileAttributes.ReadOnly);
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(audioDir, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        }
        try
        {
            await service.UpdateAsync(TestContext.Current.CancellationToken);
            File.Exists(undeletable).Should().BeTrue("an IO failure is logged and skipped, never fatal");
            if (OperatingSystem.IsWindows())
            {
                File.Exists(collectible).Should().BeFalse("other orphans are still collected");
            }
            else
            {
                // On Unix the unlink denial lives on the parent directory, so
                // every delete in it fails; the per-file catch still runs for
                // each orphan and the update completes.
                File.Exists(collectible).Should().BeTrue("directory write denial blocks every unlink, not just one");
            }
        }
        finally
        {
            File.SetAttributes(undeletable, FileAttributes.Normal);
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(audioDir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }
    }

    [Fact]
    public async Task OrphanSweep_ToleratesAnUnreadableDirectory()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        await service.InitializeAsync();
        var audioDir = Path.Join(storage.Root, "extensions", "recitation");
        Directory.CreateDirectory(audioDir);
        var orphan = Path.Join(audioDir, "stale.mp3");
        await File.WriteAllTextAsync(orphan, "orphan", TestContext.Current.CancellationToken);

        // Unix mode 0300: listable enumeration is denied while traversal stays possible.
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(audioDir, UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        try
        {
            await service.UpdateAsync(TestContext.Current.CancellationToken);
            if (OperatingSystem.IsWindows())
            {
                File.Exists(orphan).Should().BeFalse("without ACL denial the orphan is swept normally");
            }
            else
            {
                File.Exists(orphan).Should().BeTrue("enumeration was denied, but the update still completed");
            }
        }
        finally
        {
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(audioDir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }
    }

    private static RecitationPacksViewModel Preferences(TestStorage storage, RecitationService service,
        Mock<IAppNavigator>? navigator = null) =>
        new(service,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            (navigator ?? new Mock<IAppNavigator>()).Object);

    [Fact]
    public async Task PreferencesInstallState_ReflectsOnDiskAudioOnly()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage)
        {
            Package = new(1, [Track(1, "audio"u8.ToArray()), Track(2, "second"u8.ToArray())])
        };
        extension.Audio["/recordings/2_record.mp3"] = "second"u8.ToArray();
        extension.BookIds[1] = 1; extension.BookIds[2] = 2;
        extension.Bundle();
        var service = extension.Service;
        var model = Preferences(storage, service);
        await service.InitializeAsync();

        model.InstallState.Should().Be(RecitationInstallState.NotInstalled);
        await service.DownloadAsync([1]);
        model.InstallState.Should().Be(RecitationInstallState.Partial);
        await service.DownloadAsync([2]);
        model.InstallState.Should().Be(RecitationInstallState.Installed);
    }

    [Fact]
    public async Task PreferencesRemoveAll_WhenDeclined_KeepsEveryRecording()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        await service.DownloadAsync([1]);
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), "הסרה", "ביטול")).ReturnsAsync(false);
        var model = Preferences(storage, service, navigator);

        await model.RemoveAllAsync();

        service.HasAudio(1).Should().BeTrue("a declined confirmation never removes");
        navigator.Verify(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), "הסרה", "ביטול"), Times.Once);
    }

    [Fact]
    public async Task PreferencesRemoveAll_WhenDeletionThrows_ReportsARetriableError()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        await service.DownloadAsync([1]);
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), "הסרה", "ביטול")).ReturnsAsync(true);
        var model = Preferences(storage, service, navigator);
        service.PlaybackStopRequested += (_, _) => throw new IOException("audio device busy");

        await model.RemoveAllAsync();

        model.Status.Should().Be("לא ניתן להסיר את ההקלטות. נסו שוב.");
        service.HasAudio(1).Should().BeTrue("a failed removal keeps the recordings");
    }

    [Fact]
    public async Task PreferencesRemoveBook_IgnoresANullChoice()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        var navigator = new Mock<IAppNavigator>();
        var model = Preferences(storage, service, navigator);

        await model.RemoveBookAsync(null);

        navigator.Verify(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task PreferencesRemoveBook_WithoutInstalledAudio_SaysThereIsNothingToRemove()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        var navigator = new Mock<IAppNavigator>();
        var model = Preferences(storage, service, navigator);
        model.Books.Add(new RecitationBookChoice { Name = "בראשית", PerekIds = [1] });

        await model.RemoveBookAsync(model.Books[0]);

        model.Status.Should().Be("אין הקלטות מותקנות להסרה בספר בראשית.");
        navigator.Verify(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task PreferencesRemoveBook_WhenDeletionThrows_ReportsARetriableError()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        await service.DownloadAsync([1]);
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), "הסרה", "ביטול")).ReturnsAsync(true);
        var model = Preferences(storage, service, navigator);
        service.PlaybackStopRequested += (_, _) => throw new IOException("audio device busy");

        await model.RemoveBookAsync(new RecitationBookChoice { Name = "בראשית", PerekIds = [1] });

        model.Status.Should().Be("לא ניתן להסיר את ההקלטות. נסו שוב.");
        service.HasAudio(1).Should().BeTrue("a failed removal keeps the recordings");
    }

    [Fact]
    public async Task PreferencesRemoveBook_RemovingTheLastInstalledBook_EmptiesTheInstall()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        await service.DownloadAsync([1]);
        var navigator = new Mock<IAppNavigator>();
        navigator.Setup(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), "הסרה", "ביטול")).ReturnsAsync(true);
        var model = Preferences(storage, service, navigator);

        await model.RemoveBookAsync(new RecitationBookChoice { Name = "בראשית", PerekIds = [1] });

        service.HasAudio(1).Should().BeFalse();
        service.InstallState.Should().Be(RecitationInstallState.NotInstalled);
        model.Status.Should().Contain("הוסרו");
    }

    [Fact]
    public async Task PreferencesRemoval_IsRejectedWhileADownloadIsInFlight()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,1)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL)");
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle();
        var service = extension.Service;
        var navigator = new Mock<IAppNavigator>();
        var model = Preferences(storage, service, navigator);
        await model.LoadAsync();

        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var directory = Path.Join(storage.Root, "store", "recitation_1");
        extension.Delivery.Setup(d => d.FetchAsync("recitation_1", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, IProgress<double>? _, CancellationToken _) =>
            {
                entered.SetResult();
                await release.Task;
                return true;
            });
        extension.Delivery.Setup(d => d.TryGetAssetPathAsync("recitation_1", It.IsAny<CancellationToken>()))
            .Returns(() => Task.FromResult(release.Task.IsCompleted ? directory : null));
        var downloading = model.DownloadAllAsync();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);

        await model.RemoveBookAsync(model.Books[0]);
        await model.RemoveAllAsync();

        navigator.Verify(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never,
            "removal commands must not interleave with an in-flight download");
        release.SetResult();
        await downloading;
        service.HasAudio(1).Should().BeTrue();
    }

[Fact]
    public async Task OrphanSweep_ToleratesUndeletableFiles_AndStillUpdates()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        extension.Package = new(1, [Track(1, "audio"u8.ToArray())]);
        extension.Audio["/recordings/1_record.mp3"] = "audio"u8.ToArray();
        extension.Bundle(); var service = extension.Service;

        var dir = Path.Join(storage.Root, "extensions", "recitation");
        Directory.CreateDirectory(dir);
        var lockedPath = Path.Join(dir, "stale-locked.mp3");
        var readonlyPath = Path.Join(dir, "stale-readonly.mp3");
        File.WriteAllText(lockedPath, "stale");
        File.WriteAllText(readonlyPath, "stale");
        File.SetAttributes(readonlyPath, FileAttributes.ReadOnly);
        await using var lockHandle = new FileStream(lockedPath, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        // On Unix a read-only file deletes freely; a non-writable directory does not.
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(dir, UnixFileMode.UserRead | UnixFileMode.UserExecute);
        }
        try
        {
            await service.UpdateAsync(TestContext.Current.CancellationToken);
        }
        finally
        {
            if (!OperatingSystem.IsWindows())
            {
                File.SetUnixFileMode(dir, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            }
        }

        File.Exists(readonlyPath).Should().BeTrue("the sweep swallows delete failures instead of failing the update");
        File.SetAttributes(readonlyPath, FileAttributes.Normal);
    }

    [Fact]
    public async Task DecodedChapter_ThatIsNotACompleteWav_IsRejected()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var source = "original alignment MP3"u8.ToArray();
        var opus = "OggS derived playback"u8.ToArray();
        var track = Track(1, source) with { Playback = new("ogg-opus", Hash(opus), opus.Length, 24000, Hash(source)) };
        extension.Package = new(1, [track]);
        extension.Audio["/recordings/1_record.mp3"] = opus;
        extension.Bundle(); var service = extension.Service;
        await service.DownloadAsync([1]);
        var decoder = new Mock<IRecitationAudioDecoder>();
        decoder.Setup(d => d.CreateChapterAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([1, 2, 3]);

        var act = () => service.PrepareAudioAsync(1, Canonical(), null, null,
            TestContext.Current.CancellationToken, null, decoder.Object);

        await act.Should().ThrowAsync<InvalidDataException>().WithMessage("*Truncated*");
    }
}
