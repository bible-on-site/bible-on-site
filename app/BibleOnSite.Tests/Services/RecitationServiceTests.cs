using System.IO.Compression;
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
                    foreach (var track in group.DistinctBy(t => t.AudioSha256))
                    {
                        using var entry = zip.CreateEntry(track.AudioSha256 + ".mp3").Open();
                        entry.Write(Audio.GetValueOrDefault($"/recordings/{track.PerekId}_record.mp3", "audio"u8.ToArray()));
                    }
                }
                var bytes = output.ToArray();
                var book = new RecitationBookPack(group.Key, Hash(bytes), bytes.Length, group.Select(t => t.PerekId).ToList());
                books.Add(book);
                if (store)
                {
                    var directory = Path.Combine(storage.Root, "store", book.PackName);
                    Directory.CreateDirectory(directory);
                    File.WriteAllBytes(Path.Combine(directory, book.FileName), bytes);
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
        var path = Path.Combine(storage.Root, "store", pack.PackName, pack.FileName);
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
        service.HasAudio(1).Should().BeFalse(); (await File.ReadAllBytesAsync(originalPath, TestContext.Current.CancellationToken)).Should().Equal("audio"u8.ToArray());
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
        var model = new RecitationPreferencesViewModel(service, PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()),
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        await model.LoadAsync(); await model.DownloadSelectedAsync(); model.Status.Should().Contain("בחרו");
        model.SelectAllCommand.Execute(null); var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        extension.Delivery.Setup(d => d.FetchAsync("recitation_2", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, IProgress<double>? _, CancellationToken ct) =>
            {
                entered.SetResult(); await Task.Delay(Timeout.Infinite, ct); return false;
            });
        var downloading = model.DownloadSelectedAsync(); await entered.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        model.IsDownloading.Should().BeTrue(); await model.DownloadSelectedAsync();
        model.CancelDownloadCommand.Execute(null); await downloading;
        model.IsIdle.Should().BeTrue(); model.Status.Should().Contain("הופסקה");
        service.HasAudio(1).Should().BeTrue(); service.HasAudio(2).Should().BeFalse();
        extension.Bundle(); await model.DownloadSelectedAsync();
        service.HasAudio(2).Should().BeTrue(); model.Enabled.Should().BeTrue(); model.Books[0].Status.Should().Contain("1 מתוך 1");
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
        var model = new RecitationPreferencesViewModel(extension.Service,
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()),
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        await model.LoadAsync(); model.Status.Should().Contain("לא ניתן לטעון");
        extension.Bundle(store: false);
        await model.LoadAsync(); await model.LoadAsync(); model.Books.Should().HaveCount(2);
        model.Books[0].CanSelect.Should().BeTrue("recordings need not be downloaded to select their book");
        model.Books[0].Status.Should().Contain("0 מתוך 1");
        model.Books[1].CanSelect.Should().BeFalse();
        model.Books[1].Status.Should().Be("אין הקלטות זמינות");
        // A stale selection must not trigger a request for an unavailable extension.
        model.Books[1].IsSelected = true;
        await model.DownloadSelectedAsync();
        model.Status.Should().Contain("בחרו"); model.Books[1].IsSelected.Should().BeFalse();
        extension.Requests.Should().BeEmpty();
        model.SelectAllCommand.Execute(null);
        model.Books[0].IsSelected.Should().BeTrue(); model.Books[1].IsSelected.Should().BeFalse();
        var filename = extension.Catalog!.Books[0].FileName;
        var bytes = storage.PackageFiles[filename]; storage.PackageFiles.Remove(filename);
        await model.DownloadSelectedAsync(); model.Status.Should().Contain("לא ניתן להשלים");
        model.IsIdle.Should().BeTrue(); model.Enabled.Should().BeFalse();
        storage.PackageFiles[filename] = bytes;
        await model.DownloadSelectedAsync(); model.Enabled.Should().BeTrue();
        model.Books[0].Status.Should().Contain("1 מתוך 1").And.Contain("MB");
        model.Enabled = false; model.Enabled.Should().BeFalse();
    }

    [Fact]
    public async Task MissingCatalogKeepsBookChoices_AndCannotEnableRecitation()
    {
        await using var storage = new TestStorage(); var extension = new Extension(storage);
        var model = new RecitationPreferencesViewModel(extension.Service,
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()),
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        model.Books.Add(new RecitationBookChoice { Name = "בראשית", PerekIds = [1], IsSelected = true });
        model.Enabled = true; model.Enabled.Should().BeFalse();
        await model.DownloadSelectedAsync(); model.Status.Should().Contain("לא ניתן להשלים");
        model.Books.Should().ContainSingle(); model.Books[0].IsSelected.Should().BeTrue();
        model.Books[0].CanSelect.Should().BeTrue("an unavailable catalog must allow retrying the installation");
        model.Books[0].Status.Should().Be("זמינות תיבדק בעת ההורדה");
        model.CancelDownloadCommand.Execute(null); model.IsIdle.Should().BeTrue();
    }

    [Fact]
    public async Task ActivePreferencesDownloadShowsProgress_AndCompletedStatusIgnoresLateProgress()
    {
        await using var storage = new TestStorage();
        var extension = new Extension(storage) { Package = new(1, [Track(1, "audio"u8.ToArray())]) };
        extension.Bundle(); var service = extension.Service; await service.InitializeAsync();
        var model = new RecitationPreferencesViewModel(service,
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()),
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
        model.Books.Add(new RecitationBookChoice { Name = "בראשית", PerekIds = [1], IsSelected = true });
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
        var downloading = model.DownloadSelectedAsync();
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
        var model = new RecitationPreferencesViewModel(service, preferences, new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)));
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
        model.Enabled.Should().BeFalse();
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

}
