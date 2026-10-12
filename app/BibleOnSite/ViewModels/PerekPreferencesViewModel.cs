using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// על הפרק settings: which perek opens on startup.
/// </summary>
#pragma warning disable S2333 // RelayCommand generates partial implementations.
public partial class PerekPreferencesViewModel : ObservableObject
#pragma warning restore S2333
{
    private readonly PreferencesService _preferencesService;

    public PerekPreferencesViewModel() : this(PreferencesService.Instance)
    {
    }

    public PerekPreferencesViewModel(PreferencesService preferencesService)
    {
        _preferencesService = preferencesService;
        BibleOnSite.Helpers.WeakPreferencesSubscription.Subscribe(this, _preferencesService, static model => model.OnPreferencesChanged(null, EventArgs.Empty));
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

    /// <summary>
    /// Whether the מסורה על הפרק flyout menu entry is shown (opt-in, #2181).
    /// </summary>
    public bool MasoraMenuEnabled
    {
        get => _preferencesService.MasoraMenuEnabled;
        set
        {
            if (_preferencesService.MasoraMenuEnabled == value)
            {
                return;
            }

            _preferencesService.MasoraMenuEnabled = value;
            OnPropertyChanged();
        }
    }

    /// <summary>Maximum commentary sources shown across a whole chapter.</summary>
    public double InlineCommentaryLimit
    {
        get => _preferencesService.InlineCommentaryLimit;
        set
        {
            _preferencesService.InlineCommentaryLimit = double.IsFinite(value) ? (int)Math.Clamp(Math.Round(value), 1, 100) : 5;
            OnPropertyChanged();
        }
    }

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(PerekToLoad));
        OnPropertyChanged(nameof(IsPerekToLoadTodays));
        OnPropertyChanged(nameof(IsPerekToLoadLastLearnt));
        OnPropertyChanged(nameof(MasoraMenuEnabled));
        OnPropertyChanged(nameof(InlineCommentaryLimit));
    }
}
