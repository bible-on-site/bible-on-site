using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// על הפרק settings: which perek opens on startup.
/// </summary>
public partial class PerekPreferencesViewModel : ObservableObject
{
    private readonly PreferencesService _preferencesService;

    public PerekPreferencesViewModel() : this(PreferencesService.Instance)
    {
    }

    public PerekPreferencesViewModel(PreferencesService preferencesService)
    {
        _preferencesService = preferencesService;
        _preferencesService.PreferencesChanged += OnPreferencesChanged;
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

    /// <summary>Selects הפרק של היום as the startup perek.</summary>
    [RelayCommand]
    private void SelectTodaysPerek()
    {
        PerekToLoad = PerekToLoad.Todays;
    }

    /// <summary>Selects האחרון שלמדתי as the startup perek.</summary>
    [RelayCommand]
    private void SelectLastLearntPerek()
    {
        PerekToLoad = PerekToLoad.LastLearnt;
    }

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(PerekToLoad));
        OnPropertyChanged(nameof(IsPerekToLoadTodays));
        OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
    }
}
