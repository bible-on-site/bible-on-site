using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// קריינות playback preferences: speed, pause style and the volume shortcut into
/// שמע. Recording installation lives under חבילות הרחבה (<see cref="RecitationPacksViewModel"/>);
/// playback itself is controlled by the reader's player, not by a global switch.
/// </summary>
#pragma warning disable S2333 // RelayCommand generates partial implementations.
public partial class RecitationPreferencesViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly RecitationService _recitation;
    private readonly PreferencesService _preferences;
    private readonly IAppNavigator _navigator;

    public RecitationPreferencesViewModel()
        : this(RecitationService.Instance, PreferencesService.Instance, ShellAppNavigator.Instance) { }

    public RecitationPreferencesViewModel(RecitationService recitation, PreferencesService preferences)
        : this(recitation, preferences, ShellAppNavigator.Instance) { }

    public RecitationPreferencesViewModel(RecitationService recitation, PreferencesService preferences, IAppNavigator navigator)
    {
        _recitation = recitation;
        _preferences = preferences;
        _navigator = navigator;
        _preferences.PreferencesChanged += OnPreferencesChanged;
        _recitation.Changed += OnRecitationChanged;
    }

    public double Speed
    {
        get => _preferences.RecitationSpeed;
        set { _preferences.RecitationSpeed = Math.Round(value * 4) / 4; OnPropertyChanged(); }
    }

    /// <summary>קריינות volume — the same setting the שמע page edits.</summary>
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

    /// <summary>Honest on-disk install state for the התקנת הקלטות shortcut row.</summary>
    public string InstallStateText => RecitationInstallStateText.Of(_recitation.InstallState);

    /// <summary>Opens שמע focused on the קריינות volume control.</summary>
    [RelayCommand]
    public async Task OpenSoundAsync()
    {
        await _navigator.GoToAsync($"{AppRoutes.SoundPreferences}?focus=recitation");
    }

    /// <summary>Opens חבילות הרחבה where recitation recordings are installed and removed.</summary>
    [RelayCommand]
    public async Task OpenExtensionPacksAsync()
    {
        await _navigator.GoToAsync(AppRoutes.ExtensionPacks);
    }

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(Speed));
        OnPropertyChanged(nameof(Volume));
        OnPropertyChanged(nameof(OriginalPauses));
        OnPropertyChanged(nameof(CustomPauses));
        OnPropertyChanged(nameof(PauseSeconds));
    }

    private void OnRecitationChanged(object? sender, EventArgs e) => OnPropertyChanged(nameof(InstallStateText));
}
