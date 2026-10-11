using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// תצוגה settings: font size with a live preview.
/// </summary>
public partial class DisplayPreferencesViewModel : ObservableObject
{
    private readonly PreferencesService _preferencesService;

    public DisplayPreferencesViewModel() : this(PreferencesService.Instance)
    {
    }

    public DisplayPreferencesViewModel(PreferencesService preferencesService)
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
            if (Math.Abs(_preferencesService.FontFactor - value) < 0.001)
            {
                return;
            }
            _preferencesService.FontFactor = value;
            OnPropertyChanged();
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

    private void OnPreferencesChanged(object? sender, EventArgs e) => OnPropertyChanged(nameof(FontFactor));
}
