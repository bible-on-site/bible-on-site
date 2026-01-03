using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Services;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for user preferences management.
/// </summary>
public partial class PreferencesViewModel : ObservableObject
{
    private readonly PreferencesService _preferencesService;

    public PreferencesViewModel() : this(PreferencesService.Instance)
    {
    }

    public PreferencesViewModel(PreferencesService preferencesService)
    {
        _preferencesService = preferencesService;
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
        }
    }

    /// <summary>
    /// Loads preferences from device storage.
    /// </summary>
    [RelayCommand]
    public void Load()
    {
        _preferencesService.Load();
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(LastLearntPerek));
        OnPropertyChanged(nameof(PerekToLoad));
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
        // Refresh all properties when preferences change externally
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(LastLearntPerek));
        OnPropertyChanged(nameof(PerekToLoad));
    }
}
