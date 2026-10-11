using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using Microsoft.Maui.Devices;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Verifies extension-pack independence and lifecycle as implemented today (#2099):
/// install permutations, restart, per-book update scope, and the removal semantics that
/// #2098 must build on. The store doubles as Play Asset Delivery on Android and
/// On-Demand Resources on iOS; both are IPadDeliveryService behind one contract.
/// </summary>
public class ExtensionPackLifecycleTests
{
    private const string NotesDbName = "sefaria-dump-5784-sivan-4.perushim_notes.sqlite";
    private const string NotesPack = "perushim_notes";

    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));
    private static List<Pasuk> Canonical() => [new() { PasukNum = 1, Text = "ברא אור", Segments = [
        new() { Type = SegmentType.Qri, Value = "ברא" }, new() { Type = SegmentType.Qri, Value = "אור" }] }];
    private static RecitationTrack Track(int id, byte[] audio) => new(id,
        $"https://example.com/recordings/{id}_record.mp3", Hash(audio), Hash(Encoding.UTF8.GetBytes("1:1:ברא\n1:2:אור")),
        3000, "ready", [new(1, 1, "ברא", 100, 800), new(1, 2, "אור", 900, 1800)]);

    /// <summary>
    /// An on-device store: packs exist on the store server, and only delivered packs
    /// have a local asset path (PAD GetPackLocation / ODR conditional access).
    /// Downloaded packs stay usable offline; the store itself can go unreachable.
    /// </summary>
    private sealed class Store(string root)
    {
        public Mock<IPadDeliveryService> Delivery { get; } = new();
        public List<string> FetchLog { get; } = [];
        private readonly Dictionary<string, string> _stock = [];
        private readonly HashSet<string> _delivered = [];
        public bool Offline { get; set; }

        public void Stock(string packName, string fileName, byte[] bytes)
        {
            var directory = Path.Combine(root, "store", packName);
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(Path.Combine(directory, fileName), bytes);
            _stock[packName] = directory;
        }

        public void MarkDelivered(string packName) => _delivered.Add(packName);
        public void Evict(string packName) => _delivered.Remove(packName);
        public void Unstock(string packName) => _stock.Remove(packName);

        public void Wire()
        {
            Delivery.Setup(d => d.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Returns((string name, CancellationToken _) => Task.FromResult(
                    _delivered.Contains(name) && _stock.TryGetValue(name, out var dir) ? dir : (string?)null));
            Delivery.Setup(d => d.FetchAsync(It.IsAny<string>(), It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
                .Returns((string name, IProgress<double>? progress, CancellationToken ct) =>
                {
                    ct.ThrowIfCancellationRequested();
                    FetchLog.Add(name);
                    if (Offline || !_stock.ContainsKey(name))
                    {
                        return Task.FromResult(false);
                    }
                    _delivered.Add(name);
                    progress?.Report(1);
                    return Task.FromResult(true);
                });
            Delivery.Setup(d => d.GetDeliveryDiagnosticsAsync(It.IsAny<string>())).ReturnsAsync(new List<string>());
        }
    }

    private static PerushimNotesService Notes(TestStorage storage, IPadDeliveryService delivery)
    {
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.Android);
        device.SetupGet(d => d.VersionString).Returns("15");
        var app = new Mock<IAppInfo>();
        app.SetupGet(a => a.VersionString).Returns("1.2.3");
        app.SetupGet(a => a.BuildString).Returns("123");
        return new PerushimNotesService(delivery, storage.FileSystem.Object, device.Object, app.Object);
    }

    // Notes databases go through TestStorage so its tracked connections are closed
    // before the directory is deleted; CloseDatabaseFileAsync additionally releases
    // the pooled handle an open PerushimNotesService still holds on Windows.
    private static async Task<byte[]> CreateNotesDbAsync(TestStorage storage, string relativeDirectory)
    {
        Directory.CreateDirectory(Path.Combine(storage.Root, relativeDirectory));
        var db = await storage.CreateDatabaseAsync(Path.Combine(relativeDirectory, NotesDbName),
            "CREATE TABLE IF NOT EXISTS _metadata (key TEXT, value TEXT)",
            "INSERT INTO _metadata (key, value) VALUES ('build_timestamp', '1700000000')",
            "CREATE TABLE IF NOT EXISTS note (perush_id INTEGER, perek_id INTEGER, pasuk INTEGER, note_idx INTEGER, note_content TEXT)",
            "INSERT INTO note VALUES (1,1,1,0,'note')");
        // An open pooled connection locks the file; release it before copying the bytes.
        await db.CloseAsync();
        return await File.ReadAllBytesAsync(Path.Combine(storage.Root, relativeDirectory, NotesDbName),
            TestContext.Current.CancellationToken);
    }

    /// <summary>Stocks the store with the notes DB created at <paramref name="relativeDirectory"/>.</summary>
    private static async Task StockNotesAsync(TestStorage storage, Store store, string relativeDirectory)
    {
        store.Stock(NotesPack, NotesDbName, await CreateNotesDbAsync(storage, relativeDirectory));
    }

    /// <summary>
    /// Publishes recitation book packs to the store plus the bundled catalog,
    /// mirroring what prepare_recitation_assets.py writes into a release.
    /// </summary>
    private static RecitationExtensionCatalog PublishRecitation(TestStorage storage, Store store,
        params (int SeferId, (int PerekId, byte[] Audio)[] Chapters)[] books)
    {
        var tracks = new List<RecitationTrack>();
        var packs = new List<RecitationBookPack>();
        foreach (var (seferId, chapters) in books)
        {
            using var output = new MemoryStream();
            using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
            {
                foreach (var chapter in chapters.DistinctBy(c => Hash(c.Audio)))
                {
                    using var entry = zip.CreateEntry(Hash(chapter.Audio) + ".mp3").Open();
                    entry.Write(chapter.Audio);
                }
            }
            var bytes = output.ToArray();
            var pack = new RecitationBookPack(seferId, Hash(bytes), bytes.Length, chapters.Select(c => c.PerekId).ToList());
            packs.Add(pack);
            store.Stock(pack.PackName, pack.FileName, bytes);
            tracks.AddRange(chapters.Select(c => Track(c.PerekId, c.Audio)));
        }
        var catalog = new RecitationExtensionCatalog(1, new RecitationPackage(1, tracks), packs);
        storage.PackageFiles[RecitationExtensionCatalog.FileName] = JsonSerializer.SerializeToUtf8Bytes(
            catalog, RecitationJsonContext.Default.RecitationExtensionCatalog);
        return catalog;
    }

    [Fact]
    public async Task InstallPermutations_CommentaryAndRecitationAreIndependent()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        await StockNotesAsync(storage, store, Path.Combine("store", NotesPack));
        PublishRecitation(storage, store,
            (1, [(1, "genesis audio"u8.ToArray()), (2, "second chapter"u8.ToArray())]),
            (2, [(3, "exodus audio"u8.ToArray())]));
        store.Wire();

        // Neither pack installed: no fetch happens implicitly.
        var notes = Notes(storage, store.Delivery.Object);
        var recitation = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        await notes.InitializeAsync();
        await recitation.InitializeAsync();
        notes.IsAvailable.Should().BeFalse();
        recitation.IsInstalled.Should().BeTrue("the bundled catalog installs the extension metadata");
        recitation.HasAudio(1).Should().BeFalse();
        store.FetchLog.Should().BeEmpty("nothing is fetched until the user installs a pack");

        // Recitation only: one book installed, the second book stays absent, commentary untouched.
        await recitation.DownloadAsync([1]);
        recitation.HasAudio(1).Should().BeTrue();
        recitation.HasAudio(2).Should().BeTrue("tracks install per book, not per chapter");
        recitation.HasAudio(3).Should().BeFalse();
        notes.IsAvailable.Should().BeFalse();
        store.FetchLog.Should().Equal("recitation_1");

        // Commentary only: the notes fetch does not touch recitation books.
        (await notes.TryDownloadNotesAsync()).Should().BeTrue();
        notes.IsAvailable.Should().BeTrue();
        recitation.HasAudio(3).Should().BeFalse();
        store.FetchLog.Should().Equal("recitation_1", NotesPack);
        await storage.CloseDatabaseFileAsync(NotesDbName); // release the live notes handle for disposal
    }

    [Fact]
    public async Task InstalledPacks_WorkOfflineAndSurviveRestart()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        await StockNotesAsync(storage, store, "notes-src");
        PublishRecitation(storage, store, (1, [(1, "audio"u8.ToArray())]));
        store.Wire();
        var notes = Notes(storage, store.Delivery.Object);
        var recitation = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        (await notes.TryDownloadNotesAsync()).Should().BeTrue();
        await recitation.DownloadAsync([1]);

        // A restart with no store connectivity keeps every installed pack usable.
        store.Offline = true;
        var restartedNotes = Notes(storage, store.Delivery.Object);
        var restartedRecitation = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        await restartedNotes.InitializeAsync();
        await restartedRecitation.InitializeAsync();
        restartedNotes.IsAvailable.Should().BeTrue();
        (await restartedNotes.GetPerushIdsForPerekAsync(1)).Should().Equal(1);
        File.Exists(await restartedRecitation.PrepareAudioAsync(1, Canonical())).Should().BeTrue();
        store.FetchLog.Should().Equal(NotesPack, "recitation_1");
        await storage.CloseDatabaseFileAsync(NotesDbName); // release the live notes handle for disposal
    }

    [Fact]
    public async Task RemovedRecitationBook_StaysRemoved_UntilExplicitReinstall()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        var audio = "audio"u8.ToArray();
        var catalog = PublishRecitation(storage, store,
            (1, [(1, audio)]),
            (2, [(3, "other book"u8.ToArray())]));
        store.Wire();
        var recitation = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        await recitation.DownloadAsync([1, 3]);
        store.FetchLog.Should().Equal("recitation_1", "recitation_2");

        // Deleting a book's files is the only removal the app-owned storage allows;
        // nothing may re-download it on init, refresh, or restart (#2098 relies on this).
        var removed = catalog.Books[0].PerekIds.Select(id =>
            Path.Combine(storage.Root, "extensions", "recitation", recitation.GetTrack(id)!.AudioSha256 + ".mp3"));
        foreach (var file in removed)
        {
            File.Delete(file);
        }
        var restarted = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        await restarted.InitializeAsync();
        await restarted.UpdateAsync(TestContext.Current.CancellationToken);
        store.FetchLog.Should().HaveCount(2, "a metadata refresh must not silently re-download audio");
        restarted.IsInstalled.Should().BeTrue("the bundled catalog still loads after audio removal");
        restarted.HasAudio(1).Should().BeFalse();
        restarted.HasAudio(3).Should().BeTrue("removing one book leaves the other book intact");
        await restarted.Invoking(s => s.PrepareAudioAsync(1, Canonical())).Should()
            .ThrowAsync<InvalidDataException>().WithMessage("*recordings again*");
        File.Exists(await restarted.PrepareAudioAsync(3, Canonical())).Should().BeTrue();

        // Reinstall reuses the still-delivered OS pack without a download, and
        // re-fetches only that pack when the OS copy was reclaimed in between.
        await restarted.DownloadAsync([1]);
        restarted.HasAudio(1).Should().BeTrue();
        store.FetchLog.Should().HaveCount(2, "reinstall copies from the delivered OS pack");
        foreach (var file in removed)
        {
            File.Delete(file);
        }
        store.Evict("recitation_1");
        await restarted.DownloadAsync([1]);
        store.FetchLog.Should().Equal("recitation_1", "recitation_2", "recitation_1");
        restarted.HasAudio(1).Should().BeTrue();
    }

    [Fact]
    public async Task RemovedPerushimNotes_ReinstallSilently_WhenStorePackIsStillInstalled()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        await StockNotesAsync(storage, store, "notes-src");
        store.MarkDelivered(NotesPack);
        store.Wire();
        var notes = Notes(storage, store.Delivery.Object);
        await notes.InitializeAsync();
        notes.IsAvailable.Should().BeTrue();
        var localDb = Path.Combine(storage.Root, NotesDbName);

        // Documented current behavior: while the OS pack stays installed, deleting the
        // app-owned copy is silently undone by the next initialization — #2098 must
        // record deliberate removals so init does not resurrect the pack.
        await storage.CloseDatabaseFileAsync(NotesDbName); // the live notes connection holds the file open
        File.Delete(localDb);
        var restarted = Notes(storage, store.Delivery.Object);
        await restarted.InitializeAsync();
        restarted.IsAvailable.Should().BeTrue();
        store.FetchLog.Should().BeEmpty("the restore copies from the OS pack without a download");
        await storage.CloseDatabaseFileAsync(NotesDbName); // release the live notes handle for disposal
    }

    [Fact]
    public async Task RemovedPerushimNotes_StayRemoved_WhenStorePackIsGone()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        await StockNotesAsync(storage, store, "notes-src");
        store.MarkDelivered(NotesPack);
        store.Wire();
        var notes = Notes(storage, store.Delivery.Object);
        await notes.InitializeAsync();
        notes.IsAvailable.Should().BeTrue();

        // Simulate OS-level reclamation of the delivered pack (uninstall-free removal
        // is not exposed by PAD or ODR; eviction is the only path that makes a
        // deleted local copy stay removed).
        await storage.CloseDatabaseFileAsync(NotesDbName); // the live notes connection holds the file open
        File.Delete(Path.Combine(storage.Root, NotesDbName));
        store.Evict(NotesPack);
        var restarted = Notes(storage, store.Delivery.Object);
        await restarted.InitializeAsync();
        restarted.IsAvailable.Should().BeFalse();
    }

    [Fact]
    public async Task RemovingOneExtension_DoesNotTouchTheOtherExtensionsFiles()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        await StockNotesAsync(storage, store, "notes-src");
        PublishRecitation(storage, store, (1, [(1, "audio"u8.ToArray())]));
        store.Wire();
        var notes = Notes(storage, store.Delivery.Object);
        var recitation = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        (await notes.TryDownloadNotesAsync()).Should().BeTrue();
        await recitation.DownloadAsync([1]);
        var notesDb = Path.Combine(storage.Root, NotesDbName);
        var audioDir = Path.Combine(storage.Root, "extensions", "recitation");
        var audioFiles = Directory.GetFiles(audioDir).ToList();
        audioFiles.Should().ContainSingle();

        // Removing recitation leaves the commentary copy and the catalog untouched.
        Directory.Delete(audioDir, true);
        File.Exists(notesDb).Should().BeTrue();
        notes.IsAvailable.Should().BeTrue();
        (await notes.GetPerushIdsForPerekAsync(1)).Should().Equal(1);

        // Reinstalling recitation does not recreate or need the commentary pack,
        // then removing commentary (with no store pack to silently restore it)
        // leaves recitation audio and the catalog untouched.
        await recitation.DownloadAsync([1]);
        store.Offline = true;
        store.Evict(NotesPack);
        await storage.CloseDatabaseFileAsync(NotesDbName); // the live notes connection holds the file open
        File.Delete(notesDb);
        var restartedNotes = Notes(storage, store.Delivery.Object);
        await restartedNotes.InitializeAsync();
        restartedNotes.IsAvailable.Should().BeFalse();
        recitation.HasAudio(1).Should().BeTrue("recitation files are not owned by the notes pack");
        File.Exists(await recitation.PrepareAudioAsync(1, Canonical())).Should().BeTrue();
    }

    [Fact]
    public async Task CatalogUpdate_RefetchesOnlyTheChangedBook_AndLeavesOrphanedAudio()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        var audioV1 = "audio v1"u8.ToArray();
        PublishRecitation(storage, store,
            (1, [(1, audioV1)]),
            (2, [(3, "book two"u8.ToArray())]));
        store.Wire();
        var recitation = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        await recitation.DownloadAsync([1, 3]);
        var obsoleteAudio = Path.Combine(storage.Root, "extensions", "recitation", Hash(audioV1) + ".mp3");
        File.Exists(obsoleteAudio).Should().BeTrue();

        // App update: the bundled catalog changes book one's archive (new recording)
        // while the OS copy is not yet delivered. Book two's archive is untouched —
        // its pack must not be fetched and its audio must not be deleted.
        PublishRecitation(storage, store,
            (1, [(1, "audio v2"u8.ToArray())]),
            (2, [(3, "book two"u8.ToArray())]));
        store.Evict("recitation_1");
        var updated = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        await updated.RefreshIfStaleAsync();
        await updated.DownloadAsync([1, 3]);
        store.FetchLog.Should().Equal(["recitation_1", "recitation_2", "recitation_1"],
            "only the changed book is re-fetched; the unchanged book keeps its audio");
        updated.HasAudio(1).Should().BeTrue();
        updated.HasAudio(3).Should().BeTrue();
        File.Exists(obsoleteAudio).Should().BeTrue(
            "current behavior: superseded recordings are not garbage-collected — #2098 cleanup must own stale files");
    }

    [Fact]
    public async Task DebugAndDesktopBundledFallback_InstallsWithoutStoreDelivery()
    {
        await using var storage = new TestStorage();
        var store = new Store(storage.Root);
        var audio = "audio"u8.ToArray();
        var catalog = PublishRecitation(storage, store, (1, [(1, audio)]));
        // Debug APKs and Windows bundle the archive as a package asset; on a device
        // without store delivery the fetch fails and the bundled archive is used.
        var pack = catalog.Books[0];
        storage.PackageFiles[pack.FileName] = await File.ReadAllBytesAsync(
            Path.Combine(storage.Root, "store", pack.PackName, pack.FileName), TestContext.Current.CancellationToken);
        store.Unstock(pack.PackName);
        Directory.Delete(Path.Combine(storage.Root, "store"), true);
        store.Wire();
        var recitation = new RecitationService(storage.FileSystem.Object, store.Delivery.Object);
        await recitation.DownloadAsync([1]);
        recitation.HasAudio(1).Should().BeTrue();
        store.FetchLog.Should().Equal(["recitation_1"],
            "the store is still tried first; the bundled archive is only the fallback");
    }
}
