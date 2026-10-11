using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// תמיכה settings: diagnostics export, always reachable regardless of
/// commentary-pack install state.
/// </summary>
public partial class SupportPreferencesViewModel : ObservableObject
{
    private readonly PerushimNotesService _perushimNotesService;
    private readonly IFileSystem _fileSystem;
    private readonly IShare _share;
    private readonly IAppNavigator _navigator;

    public SupportPreferencesViewModel()
        : this(PerushimNotesService.Instance, FileSystem.Current, Share.Default, ShellAppNavigator.Instance)
    {
    }

    public SupportPreferencesViewModel(PerushimNotesService perushimNotesService,
        IFileSystem fileSystem, IShare share, IAppNavigator navigator)
    {
        _perushimNotesService = perushimNotesService;
        _fileSystem = fileSystem;
        _share = share;
        _navigator = navigator;
    }

    /// <summary>
    /// Exports pack diagnostics to a file and opens the share sheet so the user can save or send for support.
    /// </summary>
    [RelayCommand]
    public async Task ExportLogsAsync()
    {
        try
        {
            var report = await _perushimNotesService.GetDiagnosticsAsync();
            var fileName = $"perushim_diagnostics_{DateTime.UtcNow:yyyyMMdd_HHmmss}.txt";
            var path = Path.Combine(_fileSystem.CacheDirectory, fileName);
            await File.WriteAllTextAsync(path, report);
            await _share.RequestAsync(new ShareFileRequest
            {
                Title = "ייצוא לוגים לתמיכה",
                File = new ShareFile(path),
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Export logs failed: {ex.Message}");
            await _navigator.DisplayAlertAsync("שגיאה", $"לא ניתן לייצא לוגים: {ex.Message}", "אישור");
        }
    }
}
