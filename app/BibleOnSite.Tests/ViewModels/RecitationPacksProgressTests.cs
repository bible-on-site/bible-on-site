using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// #3705 — the tapped sefer's row carries the download's own state: spinner
/// while progress is unknown, a readable fraction once the platform reports,
/// a row-level cancel for the single-sefer scope, and failure/cancellation
/// text beside the retried הורדה action. The aggregate progress block only
/// reports a multi-sefer scope, and unrelated rows stay readable rather than
/// the list dimming.
/// </summary>
public class RecitationPacksProgressTests : IAsyncDisposable
{
    private readonly TestStorage _storage = new();
    private readonly Delivery _delivery = new();
    private readonly RecitationService _recitation;
    private readonly RecitationPacksViewModel _viewModel;

    public RecitationPacksProgressTests()
    {
        _delivery.Wire(_storage);
        _recitation = new RecitationService(_storage.FileSystem.Object, _delivery.Mock.Object);
        _viewModel = new RecitationPacksViewModel(_recitation,
            new PerekDataService(new LocalDatabaseService(_storage.FileSystem.Object)),
            new Mock<IAppNavigator>().Object);
    }

    public async ValueTask DisposeAsync() => await _storage.DisposeAsync();

    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));

    private static RecitationTrack Track(int id, byte[] audio) => new(id,
        $"https://example.com/recordings/{id}_record.mp3", Hash(audio),
        Hash(Encoding.UTF8.GetBytes("1:1:ברא\n1:2:אור")), 3000, "pending", []);

    /// <summary>
    /// Publishes sefer packs to the fake store plus the bundled catalog,
    /// mirroring <see cref="ExtensionPackLifecycleTests"/>'s fixture.
    /// </summary>
    private void PublishRecitation(params (int SeferId, int PerekId, byte[] Audio)[] books)
    {
        var tracks = new List<RecitationTrack>();
        var packs = new List<RecitationBookPack>();
        foreach (var (seferId, perekId, audio) in books)
        {
            using var output = new MemoryStream();
            using (var zip = new ZipArchive(output, ZipArchiveMode.Create, true))
            {
                using var entry = zip.CreateEntry(Hash(audio) + ".mp3").Open();
                entry.Write(audio);
            }
            var bytes = output.ToArray();
            var pack = new RecitationBookPack(seferId, Hash(bytes), bytes.Length, [perekId]);
            packs.Add(pack);
            _delivery.Stock(pack.PackName, pack.FileName, bytes);
            tracks.Add(Track(perekId, audio));
        }
        var catalog = new RecitationExtensionCatalog(1, new RecitationPackage(1, tracks), packs);
        _storage.PackageFiles[RecitationExtensionCatalog.FileName] = JsonSerializer.SerializeToUtf8Bytes(
            catalog, RecitationJsonContext.Default.RecitationExtensionCatalog);
    }

    /// <summary>A store double whose fetch can report progress and wait on a test gate.</summary>
    private sealed class Delivery
    {
        public Mock<IPadDeliveryService> Mock { get; } = new();
        public List<string> FetchLog { get; } = [];
        private readonly Dictionary<string, string> _stock = [];
        private readonly HashSet<string> _delivered = [];
        private TestStorage? _storage;
        /// <summary>The Nth fetch awaits Gates[N-1] when armed; complete an entry to release it.</summary>
        public List<TaskCompletionSource> Gates { get; } = [];
        public double[]? Reports { get; set; }
        public bool Failing { get; set; }

        public void Stock(string packName, string fileName, byte[] bytes)
        {
            var directory = Path.Join(_storage!.Root, "store", Path.GetFileName(packName));
            Directory.CreateDirectory(directory);
            File.WriteAllBytes(Path.Join(directory, Path.GetFileName(fileName)), bytes);
            _stock[packName] = directory;
        }

        /// <summary>Arms waits for the next <paramref name="count"/> fetches, in order.</summary>
        public void GateFetches(int count)
        {
            for (var i = 0; i < count; i++)
            {
                Gates.Add(new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
            }
        }

        public void Wire(TestStorage storage)
        {
            _storage = storage;
            Mock.Setup(d => d.TryGetAssetPathAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
                .Returns((string name, CancellationToken _) => Task.FromResult(
                    _delivered.Contains(name) && _stock.TryGetValue(name, out var dir) ? dir : (string?)null));
            Mock.Setup(d => d.FetchAsync(It.IsAny<string>(), It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
                .Returns(async (string name, IProgress<double>? progress, CancellationToken ct) =>
                {
                    ct.ThrowIfCancellationRequested();
                    FetchLog.Add(name);
                    if (Failing || !_stock.ContainsKey(name))
                    {
                        return false;
                    }
                    foreach (var report in Reports ?? [])
                    {
                        progress?.Report(report);
                    }
                    var index = FetchLog.Count - 1;
                    if (index < Gates.Count)
                    {
                        await Gates[index].Task.WaitAsync(ct);
                    }
                    _delivered.Add(name);
                    return true;
                });
            Mock.Setup(d => d.GetDeliveryDiagnosticsAsync(It.IsAny<string>())).ReturnsAsync(new List<string>());
        }
    }

    private RecitationBookChoice AddRow(string name, params int[] perekIds)
    {
        var row = new RecitationBookChoice { Name = name, PerekIds = perekIds.ToList() };
        _viewModel.Books.Add(row);
        return row;
    }

    /// <summary>Progress&lt;T&gt; reports dispatch asynchronously; poll until they land.</summary>
    private static async Task WaitForAsync(Func<bool> condition, string because)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (!condition() && DateTime.UtcNow < deadline)
        {
            await Task.Delay(10, TestContext.Current.CancellationToken);
        }
        condition().Should().BeTrue(because);
    }

    [Fact]
    public async Task SingleBookDownload_MarksOnlyItsRow_WithCancelAndNoAggregate()
    {
        PublishRecitation((1, 1, "genesis"u8.ToArray()), (2, 2, "exodus"u8.ToArray()), (3, 3, "leviticus"u8.ToArray()));
        await _recitation.InitializeAsync();
        var first = AddRow("בראשית", 1);
        var middle = AddRow("שמות", 2);
        var last = AddRow("ויקרא", 3);
        _delivery.GateFetches(1);

        var download = _viewModel.DownloadBookAsync(middle);

        await WaitForAsync(() => _delivery.FetchLog.Count == 1, "the tapped sefer's pack fetch started");
        _delivery.FetchLog.Should().Equal(new[] { "recitation_2" },
            "only the tapped sefer's pack downloads (#3705)");
        _viewModel.IsDownloading.Should().BeTrue();
        _viewModel.ShowAggregateProgress.Should().BeFalse(
            "a single-sefer scope reports on the row, not the aggregate block");

        middle.IsDownloading.Should().BeTrue();
        middle.ShowCancel.Should().BeTrue("the cancel affordance sits on the tapped row");
        middle.ShowProgressBar.Should().BeFalse("progress is still unknown — only the spinner shows");

        first.IsDownloading.Should().BeFalse();
        last.IsDownloading.Should().BeFalse();
        first.ActionsEnabled.Should().BeFalse("conflicting actions are guarded per row");
        last.ActionsEnabled.Should().BeFalse();
        first.Status.Should().Contain("לא מותקן",
            "unrelated rows keep their readable state instead of dimming");
        last.Status.Should().Contain("לא מותקן");

        _delivery.Gates[0].TrySetResult();
        await download;

        _viewModel.Status.Should().Be("ההקלטות מותקנות וזמינות גם ללא אינטרנט.");
        _recitation.HasAudio(2).Should().BeTrue();
        _recitation.HasAudio(1).Should().BeFalse();
        middle.IsDownloading.Should().BeFalse();
        middle.ShowCancel.Should().BeFalse();
        first.ActionsEnabled.Should().BeTrue();
        last.ActionsEnabled.Should().BeTrue();
        middle.ShowRemove.Should().BeTrue("the row returns to its installed action at the same slot");
    }

    [Fact]
    public async Task SingleBookDownload_RowProgress_ReportsTheSefersOwnFraction()
    {
        PublishRecitation((1, 1, "audio bytes"u8.ToArray()));
        await _recitation.InitializeAsync();
        var row = AddRow("בראשית", 1);
        _delivery.Reports = [0.5];
        _delivery.GateFetches(1);

        var download = _viewModel.DownloadBookAsync(row);

        // The service reports the 0.9-weighted aggregate fraction, and the
        // row maps it back onto its own sefer (#3705).
        await WaitForAsync(() => row.DownloadProgress > 0,
            "the platform's report reaches the tapped row");
        row.DownloadProgress.Should().BeApproximately(0.45, 0.001);
        row.ShowProgressBar.Should().BeTrue("a readable bar appears once progress is known");
        row.ProgressText.Should().Be($"{0.45:P0}");
        row.IsDownloading.Should().BeTrue();

        _delivery.Gates[0].TrySetResult();
        await download;

        row.DownloadProgress.Should().Be(0, "the row resets for the idle/retry state");
        row.ShowProgress.Should().BeFalse();
    }

    [Fact]
    public async Task ApplyBookProgress_WithoutSizedPacks_LeavesTheRowsAlone()
    {
        // A report whose scope matches no catalogued pack has a zero total —
        // the guard returns instead of dividing by nothing (#3705).
        PublishRecitation((1, 1, "genesis"u8.ToArray()));
        await _recitation.InitializeAsync();
        var active = AddRow("בראשית", 1);
        active.IsDownloading = true;
        var idle = AddRow("שמות", 2);

        _viewModel.ApplyBookProgress(0.5, new HashSet<int> { 999 });

        active.DownloadProgress.Should().Be(0);
        idle.DownloadProgress.Should().Be(0);
    }

    [Fact]
    public async Task DownloadAll_UsesAggregateProgress_AndStillAttributesRows()
    {
        PublishRecitation((1, 1, "one"u8.ToArray()), (2, 2, "two"u8.ToArray()));
        await _recitation.InitializeAsync();
        var first = AddRow("בראשית", 1);
        var second = AddRow("שמות", 2);
        _delivery.GateFetches(2);

        var download = _viewModel.DownloadAllCommand.ExecuteAsync(null);

        await WaitForAsync(() => _delivery.FetchLog.Count == 1, "the first pack fetch started");
        _viewModel.ShowAggregateProgress.Should().BeTrue(
            "a multi-sefer scope keeps the aggregate progress block");
        first.ShowCancel.Should().BeFalse("the cancel stays on the aggregate block for a wide scope");
        second.ShowCancel.Should().BeFalse();
        first.IsDownloading.Should().BeTrue();
        second.IsDownloading.Should().BeTrue("every scoped row shows its in-flight state");

        _delivery.Reports = [0.5];
        _delivery.Gates[0].TrySetResult();

        // The second pack's fetch reports 50%: its own row attributes ~45%
        // (0.9-weighted) while the completed first row already reads 100%.
        await WaitForAsync(() => second.DownloadProgress > 0,
            "the second sefer's row reports its own fraction");
        second.DownloadProgress.Should().BeApproximately(0.45, 0.001);
        first.DownloadProgress.Should().BeApproximately(1, 0.001,
            "the completed pack's row reads 100%");

        _delivery.Gates[1].TrySetResult();
        await download;

        _recitation.HasAudio(1).Should().BeTrue();
        _recitation.HasAudio(2).Should().BeTrue();
        _viewModel.ShowAggregateProgress.Should().BeFalse();
    }

    [Fact]
    public async Task CancelDownload_MarksTheTappedRow_AndRetryRestoresIt()
    {
        PublishRecitation((1, 1, "audio"u8.ToArray()));
        await _recitation.InitializeAsync();
        var row = AddRow("בראשית", 1);
        _delivery.GateFetches(1);

        var cancelled = _viewModel.DownloadBookAsync(row);
        await WaitForAsync(() => _delivery.FetchLog.Count == 1, "the fetch is in flight");

        _viewModel.CancelDownloadCommand.Execute(null);
        await cancelled;

        _viewModel.Status.Should().Be("ההורדה הופסקה. הקלטות שהושלמו נשמרו להמשך.");
        row.Status.Should().Be("ההורדה הופסקה - ניתן לנסות שוב.",
            "cancellation lands on the same row that carried the progress");
        row.IsDownloading.Should().BeFalse();
        row.ShowCancel.Should().BeFalse();
        row.ShowDownload.Should().BeTrue("the retried הורדה action returns at the same slot");
        row.ActionsEnabled.Should().BeTrue();
        _recitation.HasAudio(1).Should().BeFalse();

        // Retry from the same row installs the sefer.
        await _viewModel.DownloadBookAsync(row);
        _recitation.HasAudio(1).Should().BeTrue();
        row.Status.Should().Contain("מותקן");
    }

    [Fact]
    public async Task CancelledDownloadAll_KeepsTheInstalledRowsStatus()
    {
        // Devin review on #3723: cancelling Download All mid-sequence must not
        // stamp "retry" on a row whose pack already landed — it contradicts
        // the הסרה action that completed row now shows.
        PublishRecitation((1, 1, "one"u8.ToArray()), (2, 2, "two"u8.ToArray()));
        await _recitation.InitializeAsync();
        var first = AddRow("בראשית", 1);
        var second = AddRow("שמות", 2);
        _delivery.GateFetches(2);

        var download = _viewModel.DownloadAllCommand.ExecuteAsync(null);
        await WaitForAsync(() => _delivery.FetchLog.Count == 1, "the first pack fetch started");
        _delivery.Gates[0].TrySetResult();
        await WaitForAsync(() => _delivery.FetchLog.Count == 2, "the second pack fetch started");

        _viewModel.CancelDownloadCommand.Execute(null);
        await download;

        _recitation.HasAudio(1).Should().BeTrue("the first pack landed before the cancel");
        _recitation.HasAudio(2).Should().BeFalse();
        first.Status.Should().Contain("מותקן").And.NotContain("נסות שוב",
            "a completed row keeps its installed status, not a retriable cancel");
        second.Status.Should().Be("ההורדה הופסקה - ניתן לנסות שוב.",
            "the cancelled row carries the retriable status");
    }

    [Fact]
    public async Task FailedDownload_MarksTheTappedRow_AndRetryStillWorks()
    {
        PublishRecitation((1, 1, "audio"u8.ToArray()));
        await _recitation.InitializeAsync();
        var row = AddRow("בראשית", 1);
        _delivery.Failing = true;

        await _viewModel.DownloadBookAsync(row);

        _viewModel.Status.Should().Be("לא ניתן להשלים את ההורדה. נסו שוב; הקלטות שהושלמו נשמרו.");
        row.Status.Should().Be("ההורדה נכשלה - ניתן לנסות שוב.",
            "failure lands on the same row that carried the progress");
        row.ShowDownload.Should().BeTrue();
        _recitation.HasAudio(1).Should().BeFalse();

        _delivery.Failing = false;
        await _viewModel.DownloadBookAsync(row);
        _recitation.HasAudio(1).Should().BeTrue();
    }
}
