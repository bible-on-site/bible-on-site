using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for user preferences management.
/// Uses local storage (MAUI Preferences); Firebase sync can be added later as enhancement.
/// </summary>
public partial class PreferencesViewModel : ObservableObject
{
    private readonly PreferencesService _preferencesService;
    private readonly PerushimNotesService _perushimNotesService;
    private readonly RecitationService _recitationService;
    private readonly IFileSystem _fileSystem;
    private readonly IShare _share;
    private readonly IAppNavigator _navigator;
    public RecitationPreferencesViewModel Recitation { get; }

    public PreferencesViewModel() : this(PreferencesService.Instance, PerushimNotesService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService)
        : this(preferencesService, PerushimNotesService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService)
        : this(preferencesService, perushimNotesService, FileSystem.Current, Share.Default)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService,
        IFileSystem fileSystem, IShare share)
        : this(preferencesService, perushimNotesService, fileSystem, share, ShellAppNavigator.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService,
        IFileSystem fileSystem, IShare share, IAppNavigator navigator)
        : this(preferencesService, perushimNotesService, fileSystem, share, navigator, RecitationService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService,
        IFileSystem fileSystem, IShare share, IAppNavigator navigator, RecitationService recitationService)
    {
        _preferencesService = preferencesService;
        _perushimNotesService = perushimNotesService;
        _recitationService = recitationService;
        _fileSystem = fileSystem;
        _share = share;
        _navigator = navigator;
        Recitation = new RecitationPreferencesViewModel(recitationService, preferencesService, PerekDataService.Instance, navigator);
        _preferencesService.PreferencesChanged += OnPreferencesChanged;
        _recitationService.Changed += OnRecitationChanged;
    }

    /// <summary>
    /// Font size multiplier for text display.
    /// </summary>
    public double FontFactor
    {
        get => _preferencesService.FontFactor;
        set
        {
            if (Math.Abs(_preferencesService.FontFactor - value) < 0.001) return;
            _preferencesService.FontFactor = value;
            OnPropertyChanged();
        }
    }

    /// <summary>
    /// The last perek the user was learning.
    /// </summary>
    public int? LastLearntPerek
    {
        get => _preferencesService.LastLearntPerek;
        set
        {
            if (_preferencesService.LastLearntPerek == value) return;
            _preferencesService.LastLearntPerek = value;
            OnPropertyChanged();
        }
    }

    /// <summary>
    /// Which perek to load on startup.
    /// </summary>
    public PerekToLoad PerekToLoad
    {
        get => _preferencesService.PerekToLoad;
        set
        {
            if (_preferencesService.PerekToLoad == value) return;
            _preferencesService.PerekToLoad = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsPerekToLoadTodays));
            OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
        }
    }

    /// <summary>True when startup perek is Today's.</summary>
    public bool IsPerekToLoadTodays
    {
        get => PerekToLoad == PerekToLoad.Todays;
        set { if (value) PerekToLoad = PerekToLoad.Todays; }
    }

    /// <summary>True when startup perek is Last learnt.</summary>
    public bool IsPerekToLoadLastLearnt
    {
        get => PerekToLoad == PerekToLoad.LastLearnt;
        set { if (value) PerekToLoad = PerekToLoad.LastLearnt; }
    }

    /// <summary>Always show the perushim section — with different content based on install state.</summary>
    public bool ShowPerushimSection => true;

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
    [NotifyPropertyChangedFor(nameof(PerushimDownloadStatusText))]
    private bool _isPerushimDownloading;

    /// <summary>Download progress in the range 0..1 (stays 0 until the first report).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(PerushimDownloadStatusText))]
    private double _perushimDownloadProgress;

    /// <summary>Idle download button: shown only when not installed and not currently downloading.</summary>
    public bool ShowPerushimDownloadButton => ShowPerushimDownload && !IsPerushimDownloading;

    /// <summary>Label shown on the progress overlay (percentage when reported, else a generic message).</summary>
    public string PerushimDownloadStatusText =>
        PerushimDownloadProgress > 0
            ? $"מוריד… {(int)Math.Round(PerushimDownloadProgress * 100)}%"
            : "מוריד…";

    /// <summary>Whether to offer removing the installed commentary pack.</summary>
    public bool ShowPerushimRemove => IsPerushimInstalled && !IsPerushimDownloading;

    /// <summary>
    /// Three-state קריינות summary computed from locally usable audio files,
    /// not from the bundled catalog or the playback on/off preference.
    /// </summary>
    public string RecitationStateText => RecitationInstallStateText.Of(_recitationService.InstallState);

    /// <summary>
    /// Loads preferences from device storage.
    /// </summary>
    [RelayCommand]
    public void Load()
    {
        _preferencesService.Load();
        _ = _perushimNotesService.InitializeAsync();
        _ = _recitationService.InitializeAsync();
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(LastLearntPerek));
        OnPropertyChanged(nameof(PerekToLoad));
        OnPropertyChanged(nameof(IsPerekToLoadTodays));
        OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
        NotifyPerushimState();
        OnPropertyChanged(nameof(RecitationStateText));
    }

    /// <summary>
    /// Loads preferences and waits for pack state so both summaries are accurate
    /// before the page first renders. A missing or corrupt pack catalog must not
    /// break the settings page.
    /// </summary>
    public async Task LoadAsync()
    {
        Load();
        try { await _perushimNotesService.InitializeAsync(); }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Perushim init: {ex.Message}"); } //NOSONAR
        try { await _recitationService.InitializeAsync(); }
        catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"Recitation init: {ex.Message}"); } //NOSONAR
        NotifyPerushimState();
        OnPropertyChanged(nameof(RecitationStateText));
    }

    /// <summary>Opens the second-level קריינות settings page.</summary>
    [RelayCommand]
    public async Task OpenRecitationAsync()
    {
        await _navigator.GoToAsync(AppRoutes.RecitationPreferences);
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
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Perushim removal failed: {ex.Message}");
            await _navigator.DisplayAlertAsync("שגיאה", "לא ניתן להסיר את חבילת הפירושים. נסו שוב.", "אישור");
        }

        NotifyPerushimState();
    }

    private void NotifyPerushimState()
    {
        OnPropertyChanged(nameof(ShowPerushimSection));
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
            return;

        IsPerushimDownloading = true;
        PerushimDownloadProgress = 0;
        try
        {
            var progress = new Progress<double>(p => PerushimDownloadProgress = Math.Clamp(p, 0, 1));
            var ok = await _perushimNotesService.TryDownloadNotesAsync(progress);
            if (!ok)
            {
                await _navigator.DisplayAlertAsync("שגיאה", "לא ניתן להוריד את חבילת הפירושים. נסו שוב מאוחר יותר.", "אישור");
            }
        }
        finally
        {
            IsPerushimDownloading = false;
            NotifyPerushimState();
        }
    }

    /// <summary>
    /// Exports perushim diagnostics to a file and opens the share sheet so the user can save or send for support.
    /// </summary>
    [RelayCommand]
    public async Task ExportPerushimLogsAsync()
    {
        try
        {
            var report = await _perushimNotesService.GetDiagnosticsAsync();
            var fileName = $"perushim_diagnostics_{DateTime.UtcNow:yyyyMMdd_HHmmss}.txt";
            var path = Path.Combine(_fileSystem.CacheDirectory, fileName);
            await File.WriteAllTextAsync(path, report);
            await _share.RequestAsync(new ShareFileRequest
            {
                Title = "ייצוא לוגים - פירושים",
                File = new ShareFile(path),
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"Export perushim logs failed: {ex.Message}");
            await _navigator.DisplayAlertAsync("שגיאה", $"לא ניתן לייצא לוגים: {ex.Message}", "אישור");
        }
    }

    /// <summary>
    /// Increases font size.
    /// </summary>
    [RelayCommand]
    public void IncreaseFontSize()
    {
        FontFactor = Math.Min(2.0, FontFactor + 0.1);
    }

    /// <summary>
    /// Decreases font size.
    /// </summary>
    [RelayCommand]
    public void DecreaseFontSize()
    {
        FontFactor = Math.Max(0.5, FontFactor - 0.1);
    }

    /// <summary>
    /// Resets font size to default.
    /// </summary>
    [RelayCommand]
    public void ResetFontSize()
    {
        FontFactor = 1.0;
    }

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(LastLearntPerek));
        OnPropertyChanged(nameof(PerekToLoad));
        OnPropertyChanged(nameof(IsPerekToLoadTodays));
        OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
    }

    private void OnRecitationChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(RecitationStateText));
    }
}
