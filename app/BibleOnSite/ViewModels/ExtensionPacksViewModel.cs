using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// חבילות הרחבה: extension-pack installation and removal, per pack lifecycle —
/// the פירושים pack and every קריינות book. Playback preferences live under
/// קריינות settings; this page only manages what is on the device.
/// </summary>
#pragma warning disable S2333 // ObservableProperty and RelayCommand generate partial implementations.
public partial class ExtensionPacksViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly PerushimNotesService _perushimNotesService;
    private readonly RecitationService _recitationService;
    private readonly IAppNavigator _navigator;
    private CancellationTokenSource? _perushimDownload;

    /// <summary>קריינות book-pack management: per-book rows, download-all and remove-all.</summary>
    public RecitationPacksViewModel Packs { get; }

    public ExtensionPacksViewModel()
        : this(PerushimNotesService.Instance, RecitationService.Instance, PerekDataService.Instance, ShellAppNavigator.Instance)
    {
    }

    public ExtensionPacksViewModel(PerushimNotesService perushimNotesService,
        RecitationService recitationService, PerekDataService perekDataService, IAppNavigator navigator)
    {
        _perushimNotesService = perushimNotesService;
        _recitationService = recitationService;
        _navigator = navigator;
        Packs = new RecitationPacksViewModel(recitationService, perekDataService, navigator);
        // The service is a singleton: a strong subscription would retain every
        // opened settings page. The weak subscription self-removes on collect.
        BibleOnSite.Helpers.WeakEventSubscription.Subscribe(this, _recitationService,
            static (service, handler) => service.Changed += handler,
            static (service, handler) => service.Changed -= handler,
            static model => model.OnRecitationChanged(null, EventArgs.Empty));
    }

    /// <summary>Whether perushim notes are installed and available.</summary>
    public bool IsPerushimInstalled => _perushimNotesService.IsAvailable;

    /// <summary>Whether to show the download controls (when NOT installed).</summary>
    public bool ShowPerushimDownload => !_perushimNotesService.IsAvailable;

    /// <summary>Status text for perushim notes.</summary>
    public string PerushimNotesStatusText =>
        _perushimNotesService.IsAvailable
            ? "חבילת הפירושים מותקנת ✓"
            : "חבילת הפירושים לא הותקנה. הורידו כדי להפעיל פירושים.";

    /// <summary>True while the perushim package is downloading.</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowPerushimDownloadButton))]
    [NotifyPropertyChangedFor(nameof(ShowPerushimRemove))]
    [NotifyPropertyChangedFor(nameof(PerushimDownloadStatusText))]
    private bool _isPerushimDownloading;

    /// <summary>Download progress in the range 0..1 (stays 0 until the first report).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PerushimDownloadStatusText))]
    private double _perushimDownloadProgress;

    /// <summary>Idle download button: shown only when not installed and not currently downloading.</summary>
    public bool ShowPerushimDownloadButton => ShowPerushimDownload && !IsPerushimDownloading;

    /// <summary>Label shown next to the progress bar (percentage when reported, else a generic message).</summary>
    public string PerushimDownloadStatusText =>
        PerushimDownloadProgress > 0
            ? $"מוריד… {(int)Math.Round(PerushimDownloadProgress * 100)}%"
            : "מוריד…";

    /// <summary>Whether to offer removing the installed commentary pack.</summary>
    public bool ShowPerushimRemove => IsPerushimInstalled && !IsPerushimDownloading;

    /// <summary>
    /// Three-state קריינות summary computed from locally usable audio files —
    /// the pack header mirrors <see cref="RecitationPacksViewModel.SummaryText"/>.
    /// </summary>
    public string RecitationStateText => RecitationInstallStateText.Of(_recitationService.InstallState);

    /// <summary>Loads pack state so both sections render accurate summaries on first appear.</summary>
    public async Task LoadAsync()
    {
        try { await _perushimNotesService.InitializeAsync(); }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Perushim init: {ex.Message}"); } //NOSONAR
        #pragma warning restore S2221
        await Packs.LoadAsync();
        NotifyPerushimState();
        OnPropertyChanged(nameof(RecitationStateText));
    }

    /// <summary>
    /// Removes the commentary pack's app-owned copy after confirmation. Store-managed
    /// bytes stay installed (PAD/ODR have no per-pack uninstall); a tombstone keeps
    /// the deliberate removal from being silently undone by initialization.
    /// </summary>
    [RelayCommand]
    public async Task RemovePerushimAsync()
    {
        if (!IsPerushimInstalled)
        {
            return;
        }

        var confirmed = await _navigator.DisplayChoiceAsync("הסרת חבילת הפירושים",
            "הפירושים יוסרו מהמכשיר. ניתן להתקין את החבילה שוב בכל עת.", "הסרה", "ביטול");
        if (!confirmed)
        {
            return;
        }

        try
        {
            await _perushimNotesService.RemoveNotesAsync();
        }
        #pragma warning disable S2221 // Deliberate failure boundary: see the //NOSONAR note
        catch (Exception ex) //NOSONAR — removal spans IO/platform errors; failure is reported to the user.
        {
            #pragma warning restore S2221
            System.Diagnostics.Debug.WriteLine($"Perushim removal failed: {ex.Message}");
            await _navigator.DisplayAlertAsync("שגיאה", "לא ניתן להסיר את חבילת הפירושים. נסו שוב.", "אישור");
        }

        NotifyPerushimState();
    }

    private void NotifyPerushimState()
    {
        OnPropertyChanged(nameof(IsPerushimInstalled));
        OnPropertyChanged(nameof(ShowPerushimDownload));
        OnPropertyChanged(nameof(ShowPerushimDownloadButton));
        OnPropertyChanged(nameof(ShowPerushimRemove));
        OnPropertyChanged(nameof(PerushimNotesStatusText));
    }

    /// <summary>
    /// Downloads perushim notes (PAD or HTTP) on demand.
    /// </summary>
    [RelayCommand]
    public async Task DownloadPerushimAsync()
    {
        if (IsPerushimDownloading)
        {
            return;
        }

        IsPerushimDownloading = true;
        PerushimDownloadProgress = 0;
        using var cancellation = new CancellationTokenSource();
        _perushimDownload = cancellation;
        try
        {
            var progress = new Progress<double>(p =>
            {
                // Reject only reports from a superseded attempt: Progress<T>
                // dispatches asynchronously, so this attempt's own reports may
                // legitimately land after the finally below. The field keeps
                // pointing at this CTS until the next download replaces it.
                if (_perushimDownload != cancellation)
                {
                    return;
                }
                PerushimDownloadProgress = Math.Clamp(p, 0, 1);
            });
            var ok = await _perushimNotesService.TryDownloadNotesAsync(progress, cancellation.Token);
            if (!ok)
            {
                await _navigator.DisplayAlertAsync("שגיאה", "לא ניתן להוריד את חבילת הפירושים. נסו שוב מאוחר יותר.", "אישור");
            }
        }
        catch (OperationCanceledException) { /* The cancel action restores the idle install affordance. */ }
        finally
        {
            IsPerushimDownloading = false;
            NotifyPerushimState();
        }
    }

    /// <summary>Cancels the running perushim download where the platform delivery supports it.</summary>
    [RelayCommand]
    private void CancelPerushimDownload() => _perushimDownload?.Cancel();

    private void OnRecitationChanged(object? sender, EventArgs e) => OnPropertyChanged(nameof(RecitationStateText));
}
