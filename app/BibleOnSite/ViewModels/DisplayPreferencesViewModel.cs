using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>
/// תצוגה settings: font size with a live preview.
/// </summary>
#pragma warning disable S2333 // RelayCommand generates partial implementations.
public partial class DisplayPreferencesViewModel : DivineNamePreferencesViewModel
#pragma warning restore S2333
{
    private readonly PreferencesService _preferencesService;
    protected override PreferencesService MaskingPreferences => _preferencesService;

    public DisplayPreferencesViewModel() : this(PreferencesService.Instance)
    {
    }

    public DisplayPreferencesViewModel(PreferencesService preferencesService)
    {
        _preferencesService = preferencesService;
        BibleOnSite.Helpers.WeakPreferencesSubscription.Subscribe(this, _preferencesService, static model => model.OnPreferencesChanged(null, EventArgs.Empty));
    }

    /// <summary>
    /// Android-only in-app Back/Up override (#2467). Non-Android platforms
    /// ignore the stored value entirely.
    /// </summary>
    public InAppBackButtonPreference InAppBackButton
    {
        get => _preferencesService.InAppBackButton;
        set
        {
            if (_preferencesService.InAppBackButton == value)
            {
                return;
            }
            _preferencesService.InAppBackButton = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(IsBackButtonPlatformDefault));
            OnPropertyChanged(nameof(IsBackButtonShow));
            OnPropertyChanged(nameof(IsBackButtonHide));
        }
    }

    public bool IsBackButtonPlatformDefault
    {
        get => InAppBackButton == InAppBackButtonPreference.PlatformDefault;
        set { if (value) { InAppBackButton = InAppBackButtonPreference.PlatformDefault; } }
    }

    public bool IsBackButtonShow
    {
        get => InAppBackButton == InAppBackButtonPreference.Show;
        set { if (value) { InAppBackButton = InAppBackButtonPreference.Show; } }
    }

    public bool IsBackButtonHide
    {
        get => InAppBackButton == InAppBackButtonPreference.Hide;
        set { if (value) { InAppBackButton = InAppBackButtonPreference.Hide; } }
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

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(InAppBackButton));
        OnPropertyChanged(nameof(IsBackButtonPlatformDefault));
        OnPropertyChanged(nameof(IsBackButtonShow));
        OnPropertyChanged(nameof(IsBackButtonHide));
        NotifyDivineNameMaskingChanged();
    }
}
