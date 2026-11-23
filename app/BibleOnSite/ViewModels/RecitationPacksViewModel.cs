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
    [NotifyPropertyChangedFor(nameof(ShowProgressBar))]
    [NotifyPropertyChangedFor(nameof(ShowDownload))]
    [NotifyPropertyChangedFor(nameof(ShowRemove))]
    private bool _isDownloading;

    /// <summary>
    /// This sefer's own transfer fraction 0–1 (#3705): 0 means the platform
    /// has not reported progress yet, so the row shows only its spinner.
    /// </summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowProgressBar))]
    [NotifyPropertyChangedFor(nameof(ProgressText))]
    private double _downloadProgress;

    /// <summary>Whether this row's download/remove actions respond — false while a download runs.</summary>
    [ObservableProperty] private bool _actionsEnabled = true;

    /// <summary>Whether the row carries the download's cancel action (single-sefer scope).</summary>
    [ObservableProperty] private bool _showCancel;

    [ObservableProperty] private string _status = "";

    public bool HasInstalled => InstalledCount > 0;
    public bool IsFullyInstalled => AvailableCount > 0 && InstalledCount >= AvailableCount;
    public bool IsPartiallyInstalled => HasInstalled && !IsFullyInstalled;
    public bool ShowProgress => IsDownloading;
    /// <summary>The readable bar appears once the platform reports a fraction.</summary>
    public bool ShowProgressBar => IsDownloading && DownloadProgress > 0;
    public string ProgressText => DownloadProgress > 0 ? $"{DownloadProgress:P0}" : "";
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
    private readonly object _statusGate = new();
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
        // The service is a singleton: a strong subscription would retain every
        // opened settings page. The weak subscription self-removes on collect.
        BibleOnSite.Helpers.WeakEventSubscription.Subscribe(this, _recitation,
            static (service, handler) => service.Changed += handler,
            static (service, handler) => service.Changed -= handler,
            static model => model.OnRecitationChanged(null, EventArgs.Empty));
    }

    /// <summary>Catalog metadata is loaded. Audio presence is reported by <see cref="InstallState"/>.</summary>
    public bool IsInstalled => _recitation.IsInstalled;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsIdle))]
    [NotifyPropertyChangedFor(nameof(CanRemove))]
    [NotifyPropertyChangedFor(nameof(ShowAggregateProgress))]
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
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — the install surface spans IO/network; a failed load shows the retry hint.
        {
            #pragma warning restore S2221
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
                : installed == 0 ? $"לא מותקן - 0 מתוך {available} הקלטות ({sizeMb} MB)"
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

        if (!await _navigator.DisplayDestructiveChoiceAsync("הסרת כל ההקלטות",
            "כל הקלטות הקריינות יוסרו מהמכשיר. ניתן להתקין אותן שוב בכל עת.", "הסרה", "ביטול"))
        {
            return;
        }

        try
        {
            await _recitation.RemoveAllAsync();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — removal spans IO/platform errors; failure is reported and the list refreshed.
        {
            #pragma warning restore S2221
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

        if (!await _navigator.DisplayDestructiveChoiceAsync("הסרת הקלטות",
            $"ההקלטות של ספר {book.Name} יוסרו מהמכשיר. ניתן להתקין אותן שוב בכל עת.", "הסרה", "ביטול"))
        {
            return;
        }

        try
        {
            await _recitation.RemoveAsync(book.PerekIds);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — removal spans IO/platform errors; failure is reported and the list refreshed.
        {
            #pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"Recitation removal failed: {ex.Message}");
            Status = "לא ניתן להסיר את ההקלטות. נסו שוב.";
            Refresh();
            return;
        }

        Status = $"הקלטות ספר {book.Name} הוסרו. ניתן להתקין אותן שוב בכל עת.";
        Refresh();
    }

    /// <summary>How many sefer packs the active download covers — scopes the aggregate progress block.</summary>
    private int _downloadScopeCount;

    /// <summary>
    /// The bottom progress/cancel block reports aggregate progress only for a
    /// multi-sefer scope (#3705) — a single sefer's bar and cancel live on its
    /// own row where the tap landed.
    /// </summary>
    public bool ShowAggregateProgress => IsDownloading && _downloadScopeCount > 1;

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

    /// <summary>
    /// Maps the aggregate transfer fraction back onto each sefer's row (#3705):
    /// the service installs the packs in catalog order, so cumulative bytes
    /// identify the book in flight — completed rows read 100%, queued rows 0.
    /// </summary>
    private void ApplyBookProgress(double p, HashSet<int> ids)
    {
        var packs = _recitation.Books.Where(b => b.PerekIds.Any(ids.Contains)).ToList();
        var total = packs.Sum(b => b.SizeBytes);
        if (total <= 0)
        {
            return;
        }

        var completed = p * total;
        long prior = 0;
        foreach (var pack in packs)
        {
            var fraction = pack.SizeBytes > 0
                ? Math.Clamp((completed - prior) / pack.SizeBytes, 0, 1) : 0;
            foreach (var book in Books.Where(b => b.IsDownloading && b.PerekIds.Any(pack.PerekIds.Contains)))
            {
                book.DownloadProgress = fraction;
            }
            prior += pack.SizeBytes;
        }
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

        var scope = Books.Where(b => b.PerekIds.Any(ids.Contains)).ToList();
        // Set before IsDownloading so the ShowAggregateProgress notification
        // the flag fires already reads the new scope.
        _downloadScopeCount = scope.Count;
        IsDownloading = true;
        Progress = 0;
        foreach (var book in Books)
        {
            var inScope = scope.Contains(book);
            book.IsDownloading = inScope;
            book.DownloadProgress = 0;
            // The cancel action sits on the tapped row for a single-sefer
            // download; a wider scope keeps the aggregate cancel below (#3705).
            book.ShowCancel = inScope && scope.Count == 1;
            // Conflicting actions are guarded per row — unrelated rows stay
            // readable instead of the whole list dimming (#3705).
            book.ActionsEnabled = false;
        }
        using var cancellation = new CancellationTokenSource();
        _download = cancellation;
        // Queued progress callbacks are only rejected once _download and
        // IsDownloading are cleared, so the outcome is applied afterwards:
        // a stale report that runs during the catch→finally window must not
        // overwrite the completed or cancelled status.
        string outcome;
        string? rowOutcome = null;
        try
        {
            Status = "מעדכן את חבילת ההקראה...";
            await _recitation.UpdateAsync(cancellation.Token);
            Status = "מוריד הקלטות...";
            await _recitation.DownloadAsync(ids, new Progress<double>(p =>
            {
                // Queued progress must not replace the completed or cancelled status:
                // the check and the write stay inside the gate so a callback that
                // observed the download as active can still lose to the outcome.
                lock (_statusGate)
                {
                    if (_download != cancellation || !IsDownloading)
                    {
                        return;
                    }
                    Progress = p; Status = $"מוריד הקלטות... {p:P0}";
                    ApplyBookProgress(p, ids);
                }
            }), cancellation.Token);
            outcome = "ההקלטות מותקנות וזמינות גם ללא אינטרנט.";
        }
        catch (OperationCanceledException)
        {
            outcome = "ההורדה הופסקה. הקלטות שהושלמו נשמרו להמשך.";
            rowOutcome = "ההורדה הופסקה - ניתן לנסות שוב.";
        }
        // Any non-cancellation failure — catalog, package, checksum, filesystem
        // or platform delivery errors — collapses to one retriable status.
        #pragma warning disable S2221 // Deliberate failure boundary: multi-source download failure collapses to one retriable status
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            outcome = "לא ניתן להשלים את ההורדה. נסו שוב; הקלטות שהושלמו נשמרו.";
            rowOutcome = "ההורדה נכשלה - ניתן לנסות שוב.";
        }
        #pragma warning restore S2221
        finally
        {
            lock (_statusGate)
            {
                _download = null;
                IsDownloading = false;
                foreach (var book in Books)
                {
                    book.IsDownloading = false;
                    book.DownloadProgress = 0;
                    book.ShowCancel = false;
                    book.ActionsEnabled = true;
                }
            }
        }
        // Under the same gate the callback's guarded write uses: a stale report that
        // passed its check before the disarm is already written, and one that waits
        // on the gate finds _download cleared — either way the outcome wins.
        lock (_statusGate)
        {
            Status = outcome;
        }
        Refresh();
        // Failure or cancellation lands on the tapped row too, next to the
        // retried הורדה action — not only in the page-level status (#3705).
        // Without a catalog the row keeps its "availability checked at
        // download" hint: the attempt never reached a known pack.
        if (rowOutcome != null && IsInstalled)
        {
            // Rows whose pack already landed keep their installed status —
            // "retry" on a completed row contradicts the הסרה action it shows.
            foreach (var book in scope.Where(b => !b.IsFullyInstalled))
            {
                book.Status = rowOutcome;
            }
        }
    }
}
