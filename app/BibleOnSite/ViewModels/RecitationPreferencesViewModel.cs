using System.Collections.ObjectModel;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>Hebrew wording for the recitation three-state summary shared by both settings levels.</summary>
internal static class RecitationInstallStateText
{
    public static string Of(RecitationInstallState state) => state switch
    {
        RecitationInstallState.Installed => "מותקנת",
        RecitationInstallState.Partial => "מותקנת חלקית",
        _ => "לא מותקנת"
    };
}

#pragma warning disable S2333 // ObservableProperty and RelayCommand generate partial implementations.
public partial class RecitationBookChoice : ObservableObject
{
    public required string Name { get; init; }
    public required List<int> PerekIds { get; init; }
    [ObservableProperty] private bool _canSelect = true;
    [ObservableProperty] private bool _hasInstalled;
    [ObservableProperty] private bool _isSelected;
    [ObservableProperty] private string _status = "";
}

public partial class RecitationPreferencesViewModel : ObservableObject
{
    private readonly RecitationService _recitation;
    private readonly PreferencesService _preferences;
    private readonly PerekDataService _perakim;
    private readonly IAppNavigator _navigator;
    private CancellationTokenSource? _download;
    public ObservableCollection<RecitationBookChoice> Books { get; } = [];
    public RecitationPreferencesViewModel() : this(RecitationService.Instance, PreferencesService.Instance, PerekDataService.Instance) { }
    public RecitationPreferencesViewModel(RecitationService recitation, PreferencesService preferences, PerekDataService perakim)
        : this(recitation, preferences, perakim, ShellAppNavigator.Instance) { }
    public RecitationPreferencesViewModel(RecitationService recitation, PreferencesService preferences, PerekDataService perakim, IAppNavigator navigator)
    {
        _recitation = recitation; _preferences = preferences; _perakim = perakim; _navigator = navigator;
    }
    /// <summary>Catalog metadata is loaded. Audio presence is reported by <see cref="InstallState"/>.</summary>
    public bool IsInstalled => _recitation.IsInstalled;
    public bool Enabled
    {
        get => _preferences.RecitationEnabled;
        set { _preferences.RecitationEnabled = value && IsInstalled; OnPropertyChanged(); }
    }
    public double Speed
    {
        get => _preferences.RecitationSpeed;
        set { _preferences.RecitationSpeed = Math.Round(value * 4) / 4; OnPropertyChanged(); }
    }
    public double Volume
    {
        get => _preferences.RecitationVolume;
        set { _preferences.RecitationVolume = value; OnPropertyChanged(); }
    }
    public bool OriginalPauses
    {
        get => _preferences.RecitationVersePauseMs < 0;
        set { _preferences.RecitationVersePauseMs = value ? -1 : 1000; OnPropertyChanged(); OnPropertyChanged(nameof(CustomPauses)); OnPropertyChanged(nameof(PauseSeconds)); }
    }
    public bool CustomPauses => !OriginalPauses;
    public double PauseSeconds
    {
        get => Math.Max(0, _preferences.RecitationVersePauseMs) / 1000;
        set
        {
            if (!CustomPauses) { return; }
            _preferences.RecitationVersePauseMs = Math.Round(value * 2) * 500;
            OnPropertyChanged();
        }
    }
    [ObservableProperty] [NotifyPropertyChangedFor(nameof(IsIdle))] private bool _isDownloading;
    public bool IsIdle => !IsDownloading;
    [ObservableProperty] private double _progress;
    [ObservableProperty] private string _status = "התקינו הקראה לכל הספרים או לספרים שתבחרו.";

    /// <summary>Three-state summary from verified audio on disk, never from catalog presence.</summary>
    public RecitationInstallState InstallState => _recitation.InstallState;

    /// <summary>Detailed installation state for this level: state word plus on-disk counts.</summary>
    public string SummaryText
    {
        get
        {
            if (_recitation.InstalledCount == 0)
            {
                return RecitationInstallStateText.Of(RecitationInstallState.NotInstalled);
            }

            return $"{RecitationInstallStateText.Of(_recitation.InstallState)} - {_recitation.InstalledCount} מתוך {_recitation.AvailableCount} הקלטות מותקנות";
        }
    }

    /// <summary>Whether any recording is installed and can be removed.</summary>
    public bool CanRemove => IsIdle && _recitation.InstalledCount > 0;

    public async Task LoadAsync()
    {
        try
        {
            await _recitation.InitializeAsync();
            await _perakim.LoadAsync();
            if (Books.Count == 0 && _perakim.Perakim is { } chapters)
            {
                foreach (var group in chapters.Values.GroupBy(p => p.SeferId).OrderBy(g => g.Key))
                {
                    Books.Add(new RecitationBookChoice { Name = group.First().SeferName, PerekIds = group.Select(p => p.PerekId).ToList(),
                        IsSelected = group.Any(p => _recitation.HasAudio(p.PerekId)) });
                }
            }

            Refresh();
        }
        catch (Exception) { Status = "לא ניתן לטעון את חבילת ההקראה. נסו להתקין אותה שוב."; }
    }

    private void Refresh()
    {
        foreach (var book in Books)
        {
            var available = book.PerekIds.Count(id => _recitation.GetTrack(id) != null);
            var installed = book.PerekIds.Count(_recitation.HasAudio);
            var size = _recitation.Books.Where(b => b.PerekIds.Any(book.PerekIds.Contains)).Sum(b => b.SizeBytes);
            // Unknown availability can be retried; a loaded catalog is authoritative.
            book.CanSelect = !IsInstalled || available > 0;
            book.HasInstalled = installed > 0;
            if (!book.CanSelect) { book.IsSelected = false; }
            book.Status = !IsInstalled ? "זמינות תיבדק בעת ההורדה" : available == 0 ? "אין הקלטות זמינות" : $"{installed} מתוך {available} הקלטות מותקנות ({Math.Ceiling(size / 1_000_000d)} MB)";
        }
        OnPropertyChanged(nameof(IsInstalled)); OnPropertyChanged(nameof(Enabled));
        OnPropertyChanged(nameof(InstallState)); OnPropertyChanged(nameof(SummaryText)); OnPropertyChanged(nameof(CanRemove));
    }

    [RelayCommand] private void SelectAll() { foreach (var book in Books)
        {
            book.IsSelected = book.CanSelect;
        }
    }
    [RelayCommand] private void CancelDownload() => _download?.Cancel();

    /// <summary>Removes every installed recording after confirmation.</summary>
    [RelayCommand]
    public async Task RemoveAllAsync()
    {
        if (!IsIdle || _recitation.InstalledCount == 0)
        {
            return;
        }

        if (!await _navigator.DisplayChoiceAsync("הסרת כל ההקלטות",
            "כל הקלטות הקריינות יוסרו מהמכשיר. ניתן להתקין אותן שוב בכל עת.", "הסרה", "ביטול"))
        {
            return;
        }

        try
        {
            await _recitation.RemoveAllAsync();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Recitation removal failed: {ex.Message}");
            Status = "לא ניתן להסיר את ההקלטות. נסו שוב.";
            Refresh();
            return;
        }

        Enabled = false;
        Status = "כל ההקלטות הוסרו. ניתן להתקין אותן שוב בכל עת.";
        Refresh();
    }

    /// <summary>Removes one book's installed recordings after confirmation.</summary>
    [RelayCommand]
    public async Task RemoveBookAsync(RecitationBookChoice? book)
    {
        if (book == null || !IsIdle)
        {
            return;
        }

        if (!book.PerekIds.Any(_recitation.HasAudio))
        {
            Status = $"אין הקלטות מותקנות להסרה בספר {book.Name}.";
            return;
        }

        if (!await _navigator.DisplayChoiceAsync("הסרת הקלטות",
            $"ההקלטות של ספר {book.Name} יוסרו מהמכשיר. ניתן להתקין אותן שוב בכל עת.", "הסרה", "ביטול"))
        {
            return;
        }

        try
        {
            await _recitation.RemoveAsync(book.PerekIds);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Recitation removal failed: {ex.Message}");
            Status = "לא ניתן להסיר את ההקלטות. נסו שוב.";
            Refresh();
            return;
        }

        if (_recitation.InstalledCount == 0)
        {
            Enabled = false;
        }

        Status = $"הקלטות ספר {book.Name} הוסרו. ניתן להתקין אותן שוב בכל עת.";
        Refresh();
    }

    [RelayCommand]
    public async Task DownloadSelectedAsync()
    {
        if (IsDownloading)
        {
            return;
        }

        Refresh();
        var ids = Books.Where(b => b.IsSelected && b.CanSelect).SelectMany(b => b.PerekIds).ToArray();
        if (ids.Length == 0) { Status = "בחרו ספר אחד לפחות, או את כל הספרים."; return; }
        IsDownloading = true; Progress = 0;
        using var cancellation = new CancellationTokenSource();
        _download = cancellation;
        // Queued progress callbacks are only rejected once _download and
        // IsDownloading are cleared, so the outcome is applied afterwards:
        // a stale report that runs during the catch→finally window must not
        // overwrite the completed or cancelled status.
        string outcome;
        try
        {
            Status = "מעדכן את חבילת ההקראה...";
            await _recitation.UpdateAsync(cancellation.Token);
            Status = "מוריד הקלטות...";
            await _recitation.DownloadAsync(ids, new Progress<double>(p =>
            {
                // Queued progress must not replace the completed or cancelled status.
                if (_download != cancellation || !IsDownloading)
                {
                    return;
                }
                Progress = p; Status = $"מוריד הקלטות... {p:P0}";
            }), cancellation.Token);
            Enabled = true;
            outcome = "ההקלטות מותקנות וזמינות גם ללא אינטרנט.";
        }
        catch (OperationCanceledException) { outcome = "ההורדה הופסקה. הקלטות שהושלמו נשמרו להמשך."; }
        // Any non-cancellation failure — catalog, package, checksum, filesystem
        // or platform delivery errors — collapses to one retriable status.
        catch (Exception ex) when (ex is not OperationCanceledException) { outcome = "לא ניתן להשלים את ההורדה. נסו שוב; הקלטות שהושלמו נשמרו."; }
        finally { _download = null; IsDownloading = false; }
        Status = outcome;
        Refresh();
    }

}
#pragma warning restore S2333
