using System.Collections.ObjectModel;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>Hebrew wording for the recitation three-state summary shared by every settings surface.</summary>
internal static class RecitationInstallStateText
{
    public static string Of(RecitationInstallState state) => state switch
    {
        RecitationInstallState.Installed => "מותקנת",
        RecitationInstallState.Partial => "מותקנת חלקית",
        _ => "לא מותקנת"
    };
}

/// <summary>
/// One recitation book row: name plus honest on-disk state. The action area is
/// derived from lifecycle — הורדה/השלמה while anything is missing, in-place
/// progress during an active download, הסרה once recordings exist.
/// </summary>
#pragma warning disable S2333 // ObservableProperty generates partial implementations.
public partial class RecitationBookChoice : ObservableObject
#pragma warning restore S2333
{
    public required string Name { get; init; }
    public required List<int> PerekIds { get; init; }

    /// <summary>Whether the catalog offers recordings for this book (unknown availability can be retried).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowDownload))]
    [NotifyPropertyChangedFor(nameof(DownloadLabel))]
    private bool _canDownload = true;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasInstalled))]
    [NotifyPropertyChangedFor(nameof(IsFullyInstalled))]
    [NotifyPropertyChangedFor(nameof(IsPartiallyInstalled))]
    [NotifyPropertyChangedFor(nameof(ShowDownload))]
    [NotifyPropertyChangedFor(nameof(ShowRemove))]
    [NotifyPropertyChangedFor(nameof(DownloadLabel))]
    private int _installedCount;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsFullyInstalled))]
    [NotifyPropertyChangedFor(nameof(IsPartiallyInstalled))]
    [NotifyPropertyChangedFor(nameof(ShowDownload))]
    private int _availableCount;

    [ObservableProperty] private long _sizeBytes;

    /// <summary>True while this book is part of the running download — replaces its action with progress.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowProgress))]
    [NotifyPropertyChangedFor(nameof(ShowDownload))]
    [NotifyPropertyChangedFor(nameof(ShowRemove))]
    private bool _isDownloading;

    [ObservableProperty] private string _status = "";

    public bool HasInstalled => InstalledCount > 0;
    public bool IsFullyInstalled => AvailableCount > 0 && InstalledCount >= AvailableCount;
    public bool IsPartiallyInstalled => HasInstalled && !IsFullyInstalled;
    public bool ShowProgress => IsDownloading;
    public bool ShowDownload => !IsDownloading && CanDownload && !IsFullyInstalled;
    public bool ShowRemove => !IsDownloading && HasInstalled;
    public string DownloadLabel => IsPartiallyInstalled ? "השלמת הורדה" : "הורדה";
}

/// <summary>
/// קריינות recording management inside חבילות הרחבה: per-book lifecycle rows plus
/// single-action download-all/remove-all, honest on-disk install states.
/// </summary>
#pragma warning disable S2333 // ObservableProperty and RelayCommand generate partial implementations.
public partial class RecitationPacksViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly RecitationService _recitation;
    private readonly PerekDataService _perakim;
    private readonly IAppNavigator _navigator;
    private CancellationTokenSource? _download;

    public ObservableCollection<RecitationBookChoice> Books { get; } = [];

    public RecitationPacksViewModel() : this(RecitationService.Instance, PerekDataService.Instance) { }

    public RecitationPacksViewModel(RecitationService recitation, PerekDataService perakim)
        : this(recitation, perakim, ShellAppNavigator.Instance) { }

    public RecitationPacksViewModel(RecitationService recitation, PerekDataService perakim, IAppNavigator navigator)
    {
        _recitation = recitation;
        _perakim = perakim;
        _navigator = navigator;
        _recitation.Changed += OnRecitationChanged;
    }

    /// <summary>Catalog metadata is loaded. Audio presence is reported by <see cref="InstallState"/>.</summary>
    public bool IsInstalled => _recitation.IsInstalled;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsIdle))]
    [NotifyPropertyChangedFor(nameof(CanRemove))]
    private bool _isDownloading;

    public bool IsIdle => !IsDownloading;
    [ObservableProperty] private double _progress;
    [ObservableProperty] private string _status = "התקינו הקראה לכל הספרים או לספרים שתבחרו.";

    /// <summary>Three-state summary from verified audio on disk, never from catalog presence.</summary>
    public RecitationInstallState InstallState => _recitation.InstallState;

    /// <summary>Short state word for the pack, from verified audio on disk.</summary>
    public string RecitationStateText => RecitationInstallStateText.Of(_recitation.InstallState);

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
                    Books.Add(new RecitationBookChoice { Name = group.First().SeferName, PerekIds = group.Select(p => p.PerekId).ToList() });
                }
            }

            Refresh();
        }
        catch (Exception ex) //NOSONAR — the install surface spans IO/network; a failed load shows the retry hint.
        {
            System.Diagnostics.Debug.WriteLine($"Recitation load failed: {ex.Message}");
            Status = "לא ניתן לטעון את חבילת ההקראה. נסו להתקין אותה שוב.";
        }
    }

    private void Refresh()
    {
        foreach (var book in Books)
        {
            var available = book.PerekIds.Count(id => _recitation.GetTrack(id) != null);
            var installed = book.PerekIds.Count(_recitation.HasAudio);
            var size = _recitation.Books.Where(b => b.PerekIds.Any(book.PerekIds.Contains)).Sum(b => b.SizeBytes);
            // Unknown availability can be retried; a loaded catalog is authoritative.
            book.CanDownload = !IsInstalled || available > 0;
            book.AvailableCount = available;
            book.InstalledCount = installed;
            book.SizeBytes = size;
            var sizeMb = Math.Ceiling(size / 1_000_000d);
            book.Status = !IsInstalled ? "זמינות תיבדק בעת ההורדה"
                : available == 0 ? "אין הקלטות זמינות"
                : installed == 0 ? $"לא מותקן — 0 מתוך {available} הקלטות ({sizeMb} MB)"
                : installed < available ? $"מותקן חלקית — {installed} מתוך {available} הקלטות ({sizeMb} MB)"
                : $"מותקן — {installed} מתוך {available} הקלטות ({sizeMb} MB)";
        }
        OnPropertyChanged(nameof(IsInstalled));
        OnPropertyChanged(nameof(InstallState));
        OnPropertyChanged(nameof(RecitationStateText));
        OnPropertyChanged(nameof(SummaryText));
        OnPropertyChanged(nameof(CanRemove));
    }

    private void OnRecitationChanged(object? sender, EventArgs e) => Refresh();

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
        catch (Exception ex) //NOSONAR — removal spans IO/platform errors; failure is reported and the list refreshed.
        {
            System.Diagnostics.Debug.WriteLine($"Recitation removal failed: {ex.Message}");
            Status = "לא ניתן להסיר את ההקלטות. נסו שוב.";
            Refresh();
            return;
        }

        Status = "כל ההקלטות הוסרו. ניתן להתקין אותן שוב בכל עת.";
        Refresh();
    }

    /// <summary>Removes one book's installed recordings after confirmation.</summary>
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
        catch (Exception ex) //NOSONAR — removal spans IO/platform errors; failure is reported and the list refreshed.
        {
            System.Diagnostics.Debug.WriteLine($"Recitation removal failed: {ex.Message}");
            Status = "לא ניתן להסיר את ההקלטות. נסו שוב.";
            Refresh();
            return;
        }

        Status = $"הקלטות ספר {book.Name} הוסרו. ניתן להתקין אותן שוב בכל עת.";
        Refresh();
    }

    /// <summary>Downloads every catalogued recording in one action — no selection step.</summary>
    [RelayCommand]
    public async Task DownloadAllAsync() =>
        await DownloadAsync(Books.Where(b => b.CanDownload).SelectMany(b => b.PerekIds).ToHashSet());

    /// <summary>Downloads (or completes) one book's recordings in place.</summary>
    public async Task DownloadBookAsync(RecitationBookChoice? book)
    {
        if (book == null || IsDownloading)
        {
            return;
        }

        Refresh();
        if (!book.CanDownload)
        {
            Status = $"אין הקלטות זמינות להורדה בספר {book.Name}.";
            return;
        }

        await DownloadAsync(book.PerekIds.ToHashSet());
    }

    /// <summary>Performs the selected download scope, keeping stale progress reports from overwriting the outcome.</summary>
    private async Task DownloadAsync(HashSet<int> ids)
    {
        if (IsDownloading)
        {
            return;
        }

        if (ids.Count == 0)
        {
            Status = "אין הקלטות זמינות להורדה.";
            return;
        }

        IsDownloading = true;
        Progress = 0;
        foreach (var book in Books)
        {
            book.IsDownloading = book.PerekIds.Any(ids.Contains);
        }
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
            outcome = "ההקלטות מותקנות וזמינות גם ללא אינטרנט.";
        }
        catch (OperationCanceledException) { outcome = "ההורדה הופסקה. הקלטות שהושלמו נשמרו להמשך."; }
        // Any non-cancellation failure — catalog, package, checksum, filesystem
        // or platform delivery errors — collapses to one retriable status.
        catch (Exception ex) when (ex is not OperationCanceledException) { outcome = "לא ניתן להשלים את ההורדה. נסו שוב; הקלטות שהושלמו נשמרו."; }
        finally
        {
            _download = null;
            IsDownloading = false;
            foreach (var book in Books)
            {
                book.IsDownloading = false;
            }
        }
        Status = outcome;
        Refresh();
    }
}
