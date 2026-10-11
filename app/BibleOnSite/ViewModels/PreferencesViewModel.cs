using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for the settings overview: six category rows with current-state
/// summaries, each navigating to a focused detail page.
/// Uses local storage (MAUI Preferences); Firebase sync can be added later as enhancement.
/// </summary>
#pragma warning disable S2333 // RelayCommand generates partial implementations.
public partial class PreferencesViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly PreferencesService _preferencesService;
    private readonly PerushimNotesService _perushimNotesService;
    private readonly RecitationService _recitationService;
    private readonly IAppNavigator _navigator;

    public PreferencesViewModel() : this(PreferencesService.Instance, PerushimNotesService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService)
        : this(preferencesService, PerushimNotesService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService)
        : this(preferencesService, perushimNotesService, RecitationService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService,
        RecitationService recitationService)
        : this(preferencesService, perushimNotesService, recitationService, ShellAppNavigator.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService, PerushimNotesService perushimNotesService,
        RecitationService recitationService, IAppNavigator navigator)
    {
        _preferencesService = preferencesService;
        _perushimNotesService = perushimNotesService;
        _recitationService = recitationService;
        _navigator = navigator;
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
            OnPropertyChanged(nameof(PerekToLoadSummary));
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

    /// <summary>Current startup-perek choice for the על הפרק row.</summary>
    public string PerekToLoadSummary => PerekToLoad == PerekToLoad.Todays ? "הפרק של היום" : "האחרון שלמדתי";

    /// <summary>Whether perushim notes are installed and available.</summary>
    public bool IsPerushimInstalled => _perushimNotesService.IsAvailable;

    /// <summary>Short install-state word for the commentary pack.</summary>
    public string PerushimInstallStateText => IsPerushimInstalled ? "מותקנת" : "לא מותקנת";

    /// <summary>
    /// Three-state קריינות summary computed from locally usable audio files,
    /// not from the bundled catalog or a playback preference.
    /// </summary>
    public string RecitationStateText => RecitationInstallStateText.Of(_recitationService.InstallState);

    /// <summary>Combined pack states for the חבילות הרחבה row.</summary>
    public string PacksSummaryText => $"פירושים: {PerushimInstallStateText} · קריינות: {RecitationStateText}";

    /// <summary>Current playback configuration for the קריינות row.</summary>
    public string RecitationPlaybackSummary =>
        $"מהירות {_preferencesService.RecitationSpeed:0.##}× · עוצמה {_preferencesService.RecitationVolume:P0}";

    /// <summary>Current channel levels for the שמע row.</summary>
    public string SoundSummaryText =>
        $"קריינות {_preferencesService.RecitationVolume:P0} · שיעורים {_preferencesService.LessonsVolume:P0} · אפקטים {_preferencesService.EffectsVolume:P0}";

    /// <summary>
    /// Loads preferences from device storage.
    /// </summary>
    [RelayCommand]
    public void Load()
    {
        _preferencesService.Load();
        _ = _perushimNotesService.InitializeAsync();
        _ = _recitationService.InitializeAsync();
        NotifyPreferenceState();
        NotifyPackStates();
    }

    /// <summary>
    /// Loads preferences and waits for pack state so every row summary is accurate
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
        NotifyPackStates();
    }

    /// <summary>Opens תצוגה settings.</summary>
    [RelayCommand]
    public async Task OpenDisplayAsync()
    {
        await _navigator.GoToAsync(AppRoutes.DisplayPreferences);
    }

    /// <summary>Opens על הפרק settings.</summary>
    [RelayCommand]
    public async Task OpenPerekAsync()
    {
        await _navigator.GoToAsync(AppRoutes.PerekPreferences);
    }

    /// <summary>Opens חבילות הרחבה management.</summary>
    [RelayCommand]
    public async Task OpenExtensionPacksAsync()
    {
        await _navigator.GoToAsync(AppRoutes.ExtensionPacks);
    }

    /// <summary>Opens קריינות playback settings.</summary>
    [RelayCommand]
    public async Task OpenRecitationAsync()
    {
        await _navigator.GoToAsync(AppRoutes.RecitationPreferences);
    }

    /// <summary>Opens שמע volume settings.</summary>
    [RelayCommand]
    public async Task OpenSoundAsync()
    {
        await _navigator.GoToAsync(AppRoutes.SoundPreferences);
    }

    /// <summary>Opens תמיכה settings.</summary>
    [RelayCommand]
    public async Task OpenSupportAsync()
    {
        await _navigator.GoToAsync(AppRoutes.SupportPreferences);
    }

    private void NotifyPreferenceState()
    {
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(LastLearntPerek));
        OnPropertyChanged(nameof(PerekToLoad));
        OnPropertyChanged(nameof(IsPerekToLoadTodays));
        OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
        OnPropertyChanged(nameof(PerekToLoadSummary));
        OnPropertyChanged(nameof(RecitationPlaybackSummary));
        OnPropertyChanged(nameof(SoundSummaryText));
    }

    private void NotifyPackStates()
    {
        OnPropertyChanged(nameof(IsPerushimInstalled));
        OnPropertyChanged(nameof(PerushimInstallStateText));
        OnPropertyChanged(nameof(RecitationStateText));
        OnPropertyChanged(nameof(PacksSummaryText));
    }

    private void OnPreferencesChanged(object? sender, EventArgs e) => NotifyPreferenceState();

    private void OnRecitationChanged(object? sender, EventArgs e) => NotifyPackStates();
}
