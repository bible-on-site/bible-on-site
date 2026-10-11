using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;

namespace BibleOnSite.ViewModels;

/// <summary>
/// שמע settings: three independent persisted volume channels — קריינות,
/// שיעורים מוקלטים and אפקטים. The קריינות slider edits the same
/// <see cref="PreferencesService.RecitationVolume"/> the קריינות page links to.
/// </summary>
public class SoundPreferencesViewModel : ObservableObject
{
    private readonly PreferencesService _preferencesService;

    public SoundPreferencesViewModel() : this(PreferencesService.Instance)
    {
    }

    public SoundPreferencesViewModel(PreferencesService preferencesService)
    {
        _preferencesService = preferencesService;
        _preferencesService.PreferencesChanged += OnPreferencesChanged;
    }

    /// <summary>קריינות playback volume (0–1).</summary>
    public double RecitationVolume
    {
        get => _preferencesService.RecitationVolume;
        set { _preferencesService.RecitationVolume = value; OnPropertyChanged(); }
    }

    /// <summary>Recorded lessons playback volume (0–1).</summary>
    public double LessonsVolume
    {
        get => _preferencesService.LessonsVolume;
        set { _preferencesService.LessonsVolume = value; OnPropertyChanged(); }
    }

    /// <summary>Sound-effects volume (0–1).</summary>
    public double EffectsVolume
    {
        get => _preferencesService.EffectsVolume;
        set { _preferencesService.EffectsVolume = value; OnPropertyChanged(); }
    }

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(RecitationVolume));
        OnPropertyChanged(nameof(LessonsVolume));
        OnPropertyChanged(nameof(EffectsVolume));
    }
}
