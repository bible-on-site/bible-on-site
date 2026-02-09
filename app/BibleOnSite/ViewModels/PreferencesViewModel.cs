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

    public PreferencesViewModel() : this(PreferencesService.Instance, PerushimNotesService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService)
        : this(preferencesService, PerushimNotesService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService)
    {
        _preferencesService = preferencesService;
        _perushimNotesService = perushimNotesService;
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

    /// <summary>Status text for perushim notes (available / not downloaded).</summary>
    public string PerushimNotesStatusText =>
        _perushimNotesService.IsAvailable ? "מסד הנתונים מותקן." : "לא הותקן. הורידו להפעלת פירושים.";

    /// <summary>Whether to show the download perushim button.</summary>
    public bool ShowDownloadPerushimButton => !_perushimNotesService.IsAvailable;

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
        OnPropertyChanged(nameof(PerushimNotesStatusText));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
    }

    /// <summary>
    /// Downloads perushim notes (PAD or HTTP) on demand.
    /// </summary>
    [RelayCommand]
    public async Task DownloadPerushimAsync()
    {
        var ok = await _perushimNotesService.TryDownloadNotesAsync();
        OnPropertyChanged(nameof(PerushimNotesStatusText));
        OnPropertyChanged(nameof(ShowDownloadPerushimButton));
        if (!ok && Application.Current?.Windows?.Count > 0 && Application.Current.Windows[0].Page is Page page)
        {
            await page.DisplayAlert("שגיאה", "לא ניתן להוריד פירושים. נסו שוב מאוחר יותר.", "אישור");
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
}
