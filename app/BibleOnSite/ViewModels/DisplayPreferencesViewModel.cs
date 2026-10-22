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

    #region Per-category relative sizes (#2461)

    // Each category stores a percentage of the master FontFactor; the numeric
    // input and the slider both bind the same property, so they stay in sync.

    /// <summary>פסוקים size as a percentage of the master font size (50–200).</summary>
    public double PasukFontPercent
    {
        get => _preferencesService.PasukFontPercent;
        set => SetFontPercent(value, v => _preferencesService.PasukFontPercent = v, nameof(PasukFontPercent));
    }

    /// <summary>פירושים size as a percentage of the master font size (50–200).</summary>
    public double PerushFontPercent
    {
        get => _preferencesService.PerushFontPercent;
        set => SetFontPercent(value, v => _preferencesService.PerushFontPercent = v, nameof(PerushFontPercent));
    }

    /// <summary>מאמרים size as a percentage of the master font size (50–200).</summary>
    public double ArticleFontPercent
    {
        get => _preferencesService.ArticleFontPercent;
        set => SetFontPercent(value, v => _preferencesService.ArticleFontPercent = v, nameof(ArticleFontPercent));
    }

    /// <summary>Effective pasuk body size in points, for the live preview.</summary>
    public double PasukEffectiveSize => _preferencesService.PasukFontFactor * 18;

    /// <summary>Effective perush body size in points, for the live preview.</summary>
    public double PerushEffectiveSize => _preferencesService.PerushFontFactor * 18;

    /// <summary>Effective article body size in points, for the live preview.</summary>
    public double ArticleEffectiveSize => _preferencesService.ArticleFontFactor * 16;

    public double FontPercentMinimum => PreferencesService.MinFontPercent;
    public double FontPercentMaximum => PreferencesService.MaxFontPercent;

    private void SetFontPercent(double value, Action<double> apply, string propertyName)
    {
        var normalized = double.IsFinite(value)
            ? Math.Clamp(value, PreferencesService.MinFontPercent, PreferencesService.MaxFontPercent)
            : PreferencesService.DefaultFontPercent;
        apply(normalized);
        // Notify unconditionally: an out-of-range input snaps back onto the
        // clamped value, and the effective-size previews move with the master.
        OnPropertyChanged(propertyName);
        OnPropertyChanged(propertyName.Replace("FontPercent", "EffectiveSize"));
    }

    [RelayCommand]
    public void ResetPasukFontPercent() => PasukFontPercent = PreferencesService.DefaultFontPercent;

    [RelayCommand]
    public void ResetPerushFontPercent() => PerushFontPercent = PreferencesService.DefaultFontPercent;

    [RelayCommand]
    public void ResetArticleFontPercent() => ArticleFontPercent = PreferencesService.DefaultFontPercent;

    #endregion

    private void OnPreferencesChanged(object? sender, EventArgs e)
    {
        OnPropertyChanged(nameof(FontFactor));
        OnPropertyChanged(nameof(InAppBackButton));
        OnPropertyChanged(nameof(IsBackButtonPlatformDefault));
        OnPropertyChanged(nameof(IsBackButtonShow));
        OnPropertyChanged(nameof(IsBackButtonHide));
        OnPropertyChanged(nameof(PasukFontPercent));
        OnPropertyChanged(nameof(PerushFontPercent));
        OnPropertyChanged(nameof(ArticleFontPercent));
        OnPropertyChanged(nameof(PasukEffectiveSize));
        OnPropertyChanged(nameof(PerushEffectiveSize));
        OnPropertyChanged(nameof(ArticleEffectiveSize));
        NotifyDivineNameMaskingChanged();
    }
}
