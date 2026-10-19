using BibleOnSite.Config;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.ApplicationModel.DataTransfer;
using Microsoft.Maui.Devices;

namespace BibleOnSite.Tests.ViewModels;

public class DiagnosticsExportTests
{
    [Fact]
    public async Task Export_WritesDiagnosticFile_AndSharesItFromBothViewModels()
    {
        await using var storage = new TestStorage();
        var device = new Mock<IDeviceInfo>();
        device.SetupGet(d => d.Platform).Returns(DevicePlatform.Android);
        var app = new Mock<IAppInfo>();
        var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object, device.Object, app.Object);
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var share = new Mock<IShare>();
        var files = new List<string>();
        share.Setup(s => s.RequestAsync(It.IsAny<ShareFileRequest>())).Callback<ShareFileRequest>(r => files.Add(r.File!.FullPath));
        // תמיכה settings export is always reachable — pack state is irrelevant.
        var support = new SupportPreferencesViewModel(notes, storage.FileSystem.Object, share.Object, new Mock<IAppNavigator>().Object);
        await support.ExportLogsCommand.ExecuteAsync(null);
        var chapter = new PerekViewModel(preferences, null, null, null, notes, null, storage.FileSystem.Object, share.Object);
        await chapter.ExportPerushimLogsCommand.ExecuteAsync(null);
        files.Should().HaveCount(2);
        foreach (var path in files)
        {
            Path.GetDirectoryName(path).Should().Be(storage.Root);
            Path.GetFileName(path).Should().StartWith("perushim_diagnostics_").And.EndWith(".txt");
            (await File.ReadAllTextAsync(path, TestContext.Current.CancellationToken)).Should().Contain("Perushim notes diagnostics").And.Contain("IsAvailable: False");
        }
    }

    [Fact]
    public async Task Export_WhenShareFails_ShowsErrorFromBothViewModels()
    {
        await using var storage = new TestStorage();
        var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object,
            new Mock<IDeviceInfo>().Object, new Mock<IAppInfo>().Object);
        var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
        var share = new Mock<IShare>();
        share.Setup(s => s.RequestAsync(It.IsAny<ShareFileRequest>())).ThrowsAsync(new IOException("share unavailable"));
        var navigator = new Mock<IAppNavigator>();
        var support = new SupportPreferencesViewModel(notes, storage.FileSystem.Object, share.Object, navigator.Object);
        await support.ExportLogsAsync();
        var chapter = new PerekViewModel(preferences, null, null, null, notes, navigator.Object,
            storage.FileSystem.Object, share.Object);
        await chapter.ExportPerushimLogsAsync();
        navigator.Verify(n => n.DisplayAlertAsync("שגיאה", It.Is<string>(m => m.Contains("share unavailable")), "אישור"), Times.Exactly(2));
    }

    [Fact]
    public async Task AccessibilityStatement_OpensTheMaintainedWebsiteUrl()
    {
        await using var storage = new TestStorage();
        var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object,
            new Mock<IDeviceInfo>().Object, new Mock<IAppInfo>().Object);
        var launcher = new Mock<ILauncher>();
        Uri? opened = null;
        launcher.Setup(l => l.OpenAsync(It.IsAny<Uri>()))
            .Callback<Uri>(u => opened = u)
            .ReturnsAsync(true);
        var support = new SupportPreferencesViewModel(notes, storage.FileSystem.Object,
            new Mock<IShare>().Object, new Mock<IAppNavigator>().Object, launcher.Object);
        await support.OpenAccessibilityStatementCommand.ExecuteAsync(null);
        opened.Should().Be(new Uri(AppConfig.Instance.AccessibilityUrl));
    }

    [Fact]
    public async Task AccessibilityStatement_WhenLaunchFails_ShowsError()
    {
        await using var storage = new TestStorage();
        var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object,
            new Mock<IDeviceInfo>().Object, new Mock<IAppInfo>().Object);
        var launcher = new Mock<ILauncher>();
        launcher.Setup(l => l.OpenAsync(It.IsAny<Uri>())).ThrowsAsync(new InvalidOperationException("no browser"));
        var navigator = new Mock<IAppNavigator>();
        var support = new SupportPreferencesViewModel(notes, storage.FileSystem.Object,
            new Mock<IShare>().Object, navigator.Object, launcher.Object);
        await support.OpenAccessibilityStatementAsync();
        navigator.Verify(n => n.DisplayAlertAsync("שגיאה", "לא ניתן לפתוח את הצהרת הנגישות", "אישור"), Times.Once);
    }

    private static ExtensionPacksViewModel Packs(TestStorage storage, PerushimNotesService notes, IAppNavigator navigator)
    {
        return new ExtensionPacksViewModel(notes,
            new RecitationService(storage.FileSystem.Object, new Mock<IPadDeliveryService>().Object),
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)), navigator);
    }

    [Fact]
    public async Task Download_WhenSuccessful_UpdatesInstalledStatusAndNotifiesBindings()
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite", NotesDbV2.Statements());
        var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object);
        var navigator = new Mock<IAppNavigator>();
        var packs = Packs(storage, notes, navigator.Object);
        var changes = new List<string?>();
        packs.PropertyChanged += (_, e) => changes.Add(e.PropertyName);
        await packs.DownloadPerushimCommand.ExecuteAsync(null);
        packs.IsPerushimInstalled.Should().BeTrue();
        packs.ShowPerushimDownload.Should().BeFalse();
        packs.IsPerushimDownloading.Should().BeFalse();
        packs.PerushimNotesStatusText.Should().Contain("מותקנת ✓");
        changes.Should().Contain(nameof(packs.IsPerushimInstalled)).And.Contain(nameof(packs.ShowPerushimDownloadButton));
        navigator.Verify(n => n.DisplayAlertAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        await storage.CloseDatabaseFileAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite");
    }

    [Fact]
    public async Task Download_WhenDeliveryFails_ShowsErrorAndRestoresIdleState()
    {
        await using var storage = new TestStorage();
        var navigator = new Mock<IAppNavigator>();
        var packs = Packs(storage,
            new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object), navigator.Object);
        await packs.DownloadPerushimAsync();
        packs.IsPerushimDownloading.Should().BeFalse();
        packs.ShowPerushimDownloadButton.Should().BeTrue();
        navigator.Verify(n => n.DisplayAlertAsync("שגיאה", It.Is<string>(m => m.Contains("לא ניתן להוריד")), "אישור"), Times.Once);
    }

    [Fact]
    public async Task Download_WhenCancelledByUser_RestoresIdleStateWithoutAnError()
    {
        await using var storage = new TestStorage();
        var navigator = new Mock<IAppNavigator>();
        var delivery = new Mock<IPadDeliveryService>();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        delivery.Setup(d => d.FetchAsync("perushim_notes", It.IsAny<IProgress<double>>(), It.IsAny<CancellationToken>()))
            .Returns(async (string _, IProgress<double>? _, CancellationToken ct) =>
            {
                entered.SetResult();
                await Task.Delay(Timeout.Infinite, ct);
                return false;
            });
        var packs = Packs(storage, new PerushimNotesService(delivery.Object, storage.FileSystem.Object), navigator.Object);

        var downloading = packs.DownloadPerushimCommand.ExecuteAsync(null);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken);
        packs.IsPerushimDownloading.Should().BeTrue();

        packs.CancelPerushimDownloadCommand.Execute(null);
        await downloading;

        packs.IsPerushimDownloading.Should().BeFalse();
        packs.ShowPerushimDownloadButton.Should().BeTrue("cancellation restores the install affordance");
        navigator.Verify(n => n.DisplayAlertAsync("שגיאה", It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }
}
