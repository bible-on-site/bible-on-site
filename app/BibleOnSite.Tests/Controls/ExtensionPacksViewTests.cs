using System.ComponentModel;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using BibleOnSite.Controls;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Moq;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// The חבילות הרחבה code-behind routes per-book button taps to the view-model.
/// XAML visuals are device-tested; these tests drive the click handlers
/// directly with the same sender shapes the buttons produce. The book actions
/// run against a real <see cref="RecitationService"/> backed by the packaged
/// catalog fixture, so a routed tap reaches the store boundary or deletes
/// installed audio — not just an early status update.
/// </summary>
public class ExtensionPacksViewTests : IAsyncDisposable
{
    private readonly TestStorage _storage = new();
    private readonly Mock<IPadDeliveryService> _pad = NotesDeliveryTests.Pad();
    private readonly Mock<IAppNavigator> _navigator = new();
    private readonly RecitationService _recitation;
    private readonly ExtensionPacksViewModel _viewModel;

    public ExtensionPacksViewTests()
    {
        var notes = PerushimNotesService.CreateForTesting(_pad.Object, _storage.Root);
        _recitation = new RecitationService(_storage.FileSystem.Object, _pad.Object);
        var perekData = new PerekDataService(new LocalDatabaseService(_storage.FileSystem.Object));
        _viewModel = new ExtensionPacksViewModel(notes, _recitation, perekData, _navigator.Object);
    }

    public async ValueTask DisposeAsync() => await _storage.DisposeAsync();

    private static readonly MethodInfo DownloadHandler = typeof(ExtensionPacksView)
        .GetMethod("OnDownloadBookClicked", BindingFlags.NonPublic | BindingFlags.Instance)!;
    private static readonly MethodInfo RemoveHandler = typeof(ExtensionPacksView)
        .GetMethod("OnRemoveBookClicked", BindingFlags.NonPublic | BindingFlags.Instance)!;

    private ExtensionPacksView CreateView()
    {
        var view = new ExtensionPacksView { BindingContext = _viewModel };
        return view;
    }

    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));

    private static RecitationBookChoice Book(string name = "בראשית", bool canDownload = false,
        int[]? perekIds = null) =>
        new() { Name = name, PerekIds = perekIds?.ToList() ?? [], CanDownload = canDownload };

    /// <summary>
    /// Publishes a one-book recitation catalog (pending alignment, so no word
    /// timings are required) and loads it into the service.
    /// </summary>
    private async Task SeedCatalogAsync()
    {
        var track = new RecitationTrack(1, "https://example.com/recordings/1_record.mp3",
            Hash("audio"u8.ToArray()), Hash("text"u8.ToArray()), 1000, "pending", []);
        var book = new RecitationBookPack(1, Hash("pack"u8.ToArray()), 100, [1]);
        var catalog = new RecitationExtensionCatalog(1, new RecitationPackage(1, [track]), [book]);
        _storage.PackageFiles[RecitationExtensionCatalog.FileName] =
            JsonSerializer.SerializeToUtf8Bytes(catalog, RecitationJsonContext.Default.RecitationExtensionCatalog);
        await _recitation.InitializeAsync();
    }

    /// <summary>Seeds the catalog and drops the chapter's audio file on disk.</summary>
    private async Task SeedInstalledBookAsync()
    {
        await SeedCatalogAsync();
        var track = _recitation.GetTrack(1)!;
        var directory = Path.Join(_storage.Root, "extensions", "recitation");
        Directory.CreateDirectory(directory);
        await File.WriteAllBytesAsync(Path.Join(directory, track.PlaybackFileName), "audio"u8.ToArray());
        _recitation.HasAudio(1).Should().BeTrue("the seeded file is the catalogued playback name");
    }

    /// <summary>
    /// The click handlers are async-void, so completion is observed through the
    /// pack status the action settles on rather than the invoke return.
    /// </summary>
    private async Task WaitForPackStatusAsync(string expected)
    {
        var reached = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? sender, PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(RecitationPacksViewModel.Status) && _viewModel.Packs.Status == expected)
            {
                reached.TrySetResult();
            }
        }

        _viewModel.Packs.PropertyChanged += Handler;
        try
        {
            await reached.Task.WaitAsync(TestContext.Current.CancellationToken);
            _viewModel.Packs.Status.Should().Be(expected);
        }
        finally
        {
            _viewModel.Packs.PropertyChanged -= Handler;
        }
    }

    [Fact]
    public async Task DownloadBook_Click_WithBookChoice_StartsTheBookDownload()
    {
        await SeedCatalogAsync();
        var view = CreateView();
        var book = Book(canDownload: true, perekIds: [1]);
        var button = new Button { CommandParameter = book };

        // The tap runs the real download: catalog refresh, missing-file scan and
        // a store fetch for recitation_1. With no pack delivered it collapses to
        // the honest retriable status.
        var waiting = WaitForPackStatusAsync("לא ניתן להשלים את ההורדה. נסו שוב; הקלטות שהושלמו נשמרו.");
        DownloadHandler.Invoke(view, [button, EventArgs.Empty]);
        await waiting;

        _viewModel.Packs.IsIdle.Should().BeTrue("the failed download releases the pack action");
        _pad.Verify(p => p.FetchAsync("recitation_1", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()),
            Times.Once, "the per-book tap reached the store-delivery boundary");
    }

    [Fact]
    public async Task RemoveBook_Click_WithBookChoice_StartsTheBookRemoval()
    {
        await SeedInstalledBookAsync();
        _navigator.Setup(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(),
                It.IsAny<string>(), It.IsAny<string>())).ReturnsAsync(true);
        var view = CreateView();
        var book = Book(perekIds: [1]);
        var button = new Button { CommandParameter = book };

        var waiting = WaitForPackStatusAsync("הקלטות ספר בראשית הוסרו. ניתן להתקין אותן שוב בכל עת.");
        RemoveHandler.Invoke(view, [button, EventArgs.Empty]);
        await waiting;

        _recitation.HasAudio(1).Should().BeFalse("the confirmed removal deleted the seeded audio");
        _navigator.Verify(n => n.DisplayDestructiveChoiceAsync(It.IsAny<string>(), It.IsAny<string>(),
            "הסרה", "ביטול"), Times.Once);
    }

    [Fact]
    public void DownloadBook_Click_WithoutBookChoice_DoesNothing()
    {
        var view = CreateView();
        var initial = _viewModel.Packs.Status;

        // A button whose parameter is not a book choice, and a non-button sender.
        DownloadHandler.Invoke(view, [new Button { CommandParameter = "לא ספר" }, EventArgs.Empty]);
        DownloadHandler.Invoke(view, [new Label { Text = "x" }, EventArgs.Empty]);
        DownloadHandler.Invoke(view, [null, EventArgs.Empty]);

        _viewModel.Packs.Status.Should().Be(initial);
    }

    [Fact]
    public void RemoveBook_Click_WithoutBookChoice_DoesNothing()
    {
        var view = CreateView();
        var initial = _viewModel.Packs.Status;

        RemoveHandler.Invoke(view, [new Button(), EventArgs.Empty]);
        RemoveHandler.Invoke(view, [new Label(), EventArgs.Empty]);

        _viewModel.Packs.Status.Should().Be(initial);
    }
}
