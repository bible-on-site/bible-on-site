using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Helpers;
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
    {
        _preferencesService = preferencesService;
        _perushimNotesService = perushimNotesService;
        _fileSystem = fileSystem;
        _share = share;
        _navigator = navigator;
        Recitation = new RecitationPreferencesViewModel(RecitationService.Instance, preferencesService, PerekDataService.Instance);
        _preferencesService.PreferencesChanged += OnPreferencesChanged;
    }

    /// <summary>
    /// Font size multiplier for text display.
    /// </summary>
    public double FontFactor
    {
        get => _preferencesService.FontFactor;
        set
        {
            if (Math.Abs(_preferencesService.FontFactor - value) < 0.001)
            {
                return;
            }

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
            if (_preferencesService.LastLearntPerek == value)
            {
                return;
            }

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
            if (_preferencesService.PerekToLoad == value)
            {
                return;
            }

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
        set
        {
            if (value)
            {
                PerekToLoad = PerekToLoad.Todays;
            }
        }
    }

    /// <summary>True when startup perek is Last learnt.</summary>
    public bool IsPerekToLoadLastLearnt
    {
        get => PerekToLoad == PerekToLoad.LastLearnt;
        set
        {
            if (value)
            {
                PerekToLoad = PerekToLoad.LastLearnt;
            }
        }
    }

    #region הסתר שם השם

    /// <summary>Master toggle for divine-name display masking.</summary>
    public bool DivineNameMaskingEnabled
    {
        get => _preferencesService.DivineNameMaskingEnabled;
        set
        {
            if (_preferencesService.DivineNameMaskingEnabled == value)
            {
                return;
            }

            _preferencesService.DivineNameMaskingEnabled = value;
            OnPropertyChanged();
        }
    }

    /// <summary>Selected אלהים display option.</summary>
    public DivineNameMaskOption DivineNameMaskElohim
    {
        get => _preferencesService.DivineNameMaskElohim;
        set => SetMaskOption(() => _preferencesService.DivineNameMaskElohim = value,
            NotifyMaskElohim);
    }

    /// <summary>Custom replacement text for אלהים (used when "אחר" is selected).</summary>
    public string DivineNameMaskElohimCustom
    {
        get => _preferencesService.DivineNameMaskElohimCustom;
        set
        {
            if (_preferencesService.DivineNameMaskElohimCustom == value)
            {
                return;
            }

            _preferencesService.DivineNameMaskElohimCustom = value;
            OnPropertyChanged();
        }
    }

    /// <summary>Radio wrappers: the CheckedChanged handler is the real mechanism;
    /// setters exist only so the two-way IsChecked binding has a valid target
    /// (a false write-back on deselect is intentionally a no-op).</summary>
    public bool IsMaskElohimAsIs
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.AsIs;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.AsIs; } }
    }

    public bool IsMaskElohimElokim
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.Elokim;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.Elokim; } }
    }

    public bool IsMaskElohimHyphen
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.Hyphen;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.Hyphen; } }
    }

    public bool IsMaskElohimCustom
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.Custom;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.Custom; } }
    }

    /// <summary>Selected יהוה display option (ה' / ד' / אחר — אין "כמות שהוא").</summary>
    public DivineNameMaskOption DivineNameMaskYhwh
    {
        get => _preferencesService.DivineNameMaskYhwh;
        set => SetMaskOption(() => _preferencesService.DivineNameMaskYhwh = value,
            NotifyMaskYhwh);
    }

    /// <summary>Custom replacement text for יהוה (used when "אחר" is selected).</summary>
    public string DivineNameMaskYhwhCustom
    {
        get => _preferencesService.DivineNameMaskYhwhCustom;
        set
        {
            if (_preferencesService.DivineNameMaskYhwhCustom == value)
            {
                return;
            }

            _preferencesService.DivineNameMaskYhwhCustom = value;
            OnPropertyChanged();
        }
    }

    public bool IsMaskYhwhHeh
    {
        get => DivineNameMaskYhwh == DivineNameMaskOption.Heh;
        set { if (value) { DivineNameMaskYhwh = DivineNameMaskOption.Heh; } }
    }

    public bool IsMaskYhwhDalet
    {
        get => DivineNameMaskYhwh == DivineNameMaskOption.Dalet;
        set { if (value) { DivineNameMaskYhwh = DivineNameMaskOption.Dalet; } }
    }

    public bool IsMaskYhwhCustom
    {
        get => DivineNameMaskYhwh == DivineNameMaskOption.Custom;
        set { if (value) { DivineNameMaskYhwh = DivineNameMaskOption.Custom; } }
    }

    /// <summary>Selected אל display option (כמות שהוא / א-ל).</summary>
    public DivineNameMaskOption DivineNameMaskEl
    {
        get => _preferencesService.DivineNameMaskEl;
        set => SetMaskOption(() => _preferencesService.DivineNameMaskEl = value,
            NotifyMaskEl);
    }

    public bool IsMaskElAsIs
    {
        get => DivineNameMaskEl == DivineNameMaskOption.AsIs;
        set { if (value) { DivineNameMaskEl = DivineNameMaskOption.AsIs; } }
    }

    public bool IsMaskElHyphen
    {
        get => DivineNameMaskEl == DivineNameMaskOption.Hyphen;
        set { if (value) { DivineNameMaskEl = DivineNameMaskOption.Hyphen; } }
    }

    /// <summary>Selected שדי display option (כמות שהוא / שד-י / אחר).</summary>
    public DivineNameMaskOption DivineNameMaskShaddai
    {
        get => _preferencesService.DivineNameMaskShaddai;
        set => SetMaskOption(() => _preferencesService.DivineNameMaskShaddai = value,
            NotifyMaskShaddai);
    }

    /// <summary>Custom replacement text for שדי (used when "אחר" is selected).</summary>
    public string DivineNameMaskShaddaiCustom
    {
        get => _preferencesService.DivineNameMaskShaddaiCustom;
        set
        {
            if (_preferencesService.DivineNameMaskShaddaiCustom == value)
            {
                return;
            }

            _preferencesService.DivineNameMaskShaddaiCustom = value;
            OnPropertyChanged();
        }
    }

    public bool IsMaskShaddaiAsIs
    {
        get => DivineNameMaskShaddai == DivineNameMaskOption.AsIs;
        set { if (value) { DivineNameMaskShaddai = DivineNameMaskOption.AsIs; } }
    }

    public bool IsMaskShaddaiHyphen
    {
        get => DivineNameMaskShaddai == DivineNameMaskOption.Hyphen;
        set { if (value) { DivineNameMaskShaddai = DivineNameMaskOption.Hyphen; } }
    }

    public bool IsMaskShaddaiCustom
    {
        get => DivineNameMaskShaddai == DivineNameMaskOption.Custom;
        set { if (value) { DivineNameMaskShaddai = DivineNameMaskOption.Custom; } }
    }

    private void SetMaskOption(Action apply, Action notify)
    {
        apply();
        notify();
    }

    private void NotifyMaskElohim()
    {
        OnPropertyChanged(nameof(DivineNameMaskElohim));
        OnPropertyChanged(nameof(IsMaskElohimAsIs));
        OnPropertyChanged(nameof(IsMaskElohimElokim));
        OnPropertyChanged(nameof(IsMaskElohimHyphen));
        OnPropertyChanged(nameof(IsMaskElohimCustom));
    }

    private void NotifyMaskYhwh()
    {
        OnPropertyChanged(nameof(DivineNameMaskYhwh));
        OnPropertyChanged(nameof(IsMaskYhwhHeh));
        OnPropertyChanged(nameof(IsMaskYhwhDalet));
        OnPropertyChanged(nameof(IsMaskYhwhCustom));
    }

    private void NotifyMaskEl()
    {
        OnPropertyChanged(nameof(DivineNameMaskEl));
        OnPropertyChanged(nameof(IsMaskElAsIs));
        OnPropertyChanged(nameof(IsMaskElHyphen));
    }

    private void NotifyMaskShaddai()
    {
        OnPropertyChanged(nameof(DivineNameMaskShaddai));
        OnPropertyChanged(nameof(IsMaskShaddaiAsIs));
        OnPropertyChanged(nameof(IsMaskShaddaiHyphen));
        OnPropertyChanged(nameof(IsMaskShaddaiCustom));
    }

    #endregion

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

    /// <summary>
    /// Loads preferences from device storage.
    /// </summary>
    [RelayCommand]
    public void Load()
    {
        _preferencesService.Load();
        _ = _perushimNotesService.InitializeAsync();
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(LastLearntPerek));
        OnPropertyChanged(nameof(PerekToLoad));
        OnPropertyChanged(nameof(IsPerekToLoadTodays));
        OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
        OnPropertyChanged(nameof(ShowPerushimSection));
        OnPropertyChanged(nameof(IsPerushimInstalled));
        OnPropertyChanged(nameof(ShowPerushimDownload));
        OnPropertyChanged(nameof(ShowPerushimDownloadButton));
        OnPropertyChanged(nameof(PerushimNotesStatusText));
        NotifyDivineNameMaskingChanged();
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
            OnPropertyChanged(nameof(ShowPerushimSection));
            OnPropertyChanged(nameof(IsPerushimInstalled));
            OnPropertyChanged(nameof(ShowPerushimDownload));
            OnPropertyChanged(nameof(ShowPerushimDownloadButton));
            OnPropertyChanged(nameof(PerushimNotesStatusText));
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
        NotifyDivineNameMaskingChanged();
    }

    private void NotifyDivineNameMaskingChanged()
    {
        OnPropertyChanged(nameof(DivineNameMaskingEnabled));
        OnPropertyChanged(nameof(DivineNameMaskElohimCustom));
        OnPropertyChanged(nameof(DivineNameMaskYhwhCustom));
        OnPropertyChanged(nameof(DivineNameMaskShaddaiCustom));
        NotifyMaskElohim();
        NotifyMaskYhwh();
        NotifyMaskEl();
        NotifyMaskShaddai();
    }
}
