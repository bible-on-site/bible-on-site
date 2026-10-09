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
        var settings = new PreferencesViewModel(preferences, notes, storage.FileSystem.Object, share.Object);
        await settings.ExportPerushimLogsCommand.ExecuteAsync(null);
        var chapter = new PerekViewModel(preferences, null, null, null, notes, null, storage.FileSystem.Object, share.Object);
        await chapter.ExportPerushimLogsCommand.ExecuteAsync(null);
        files.Should().HaveCount(2);
        foreach (var path in files)
        {
            Path.GetDirectoryName(path).Should().Be(storage.Root);
            Path.GetFileName(path).Should().StartWith("perushim_diagnostics_").And.EndWith(".txt");
            (await File.ReadAllTextAsync(path)).Should().Contain("Perushim notes diagnostics").And.Contain("IsAvailable: False");
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
        var settings = new PreferencesViewModel(preferences, notes, storage.FileSystem.Object, share.Object, navigator.Object);
        await settings.ExportPerushimLogsAsync();
        var chapter = new PerekViewModel(preferences, null, null, null, notes, navigator.Object,
            storage.FileSystem.Object, share.Object);
        await chapter.ExportPerushimLogsAsync();
        navigator.Verify(n => n.DisplayAlertAsync("שגיאה", It.Is<string>(m => m.Contains("share unavailable")), "אישור"), Times.Exactly(2));
    }

    [Fact]
    public async Task Download_WhenSuccessful_UpdatesInstalledStatusAndNotifiesBindings()
    {
        await using var storage = new TestStorage();
        await storage.BundleDatabaseAsync("sefaria-dump-5784-sivan-4.perushim_notes.sqlite", "CREATE TABLE note (perush_id INTEGER)");
        var notes = new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object);
        var navigator = new Mock<IAppNavigator>();
        var settings = new PreferencesViewModel(PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()), notes,
            storage.FileSystem.Object, new Mock<IShare>().Object, navigator.Object);
        var changes = new List<string?>();
        settings.PropertyChanged += (_, e) => changes.Add(e.PropertyName);
        await settings.DownloadPerushimCommand.ExecuteAsync(null);
        settings.IsPerushimInstalled.Should().BeTrue();
        settings.ShowPerushimDownload.Should().BeFalse();
        settings.IsPerushimDownloading.Should().BeFalse();
        settings.PerushimNotesStatusText.Should().Contain("מותקנת ✓");
        changes.Should().Contain(nameof(settings.IsPerushimInstalled)).And.Contain(nameof(settings.ShowPerushimDownloadButton));
        navigator.Verify(n => n.DisplayAlertAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task Download_WhenDeliveryFails_ShowsErrorAndRestoresIdleState()
    {
        await using var storage = new TestStorage();
        var navigator = new Mock<IAppNavigator>();
        var settings = new PreferencesViewModel(PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()),
            new PerushimNotesService(NotesDeliveryTests.Pad().Object, storage.FileSystem.Object),
            storage.FileSystem.Object, new Mock<IShare>().Object, navigator.Object);
        await settings.DownloadPerushimAsync();
        settings.IsPerushimDownloading.Should().BeFalse();
        settings.ShowPerushimDownloadButton.Should().BeTrue();
        navigator.Verify(n => n.DisplayAlertAsync("שגיאה", It.Is<string>(m => m.Contains("לא ניתן להוריד")), "אישור"), Times.Once);
    }
}
