using BibleOnSite.Helpers;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;

namespace BibleOnSite.ViewModels;

/// <summary>Shared display-only divine-name preference bindings.</summary>
public abstract class DivineNamePreferencesViewModel : ObservableObject
{
    protected abstract PreferencesService MaskingPreferences { get; }

    #region הסתר שם השם

    /// <summary>Master toggle for divine-name display masking.</summary>
    public bool DivineNameMaskingEnabled
    {
        get => MaskingPreferences.DivineNameMaskingEnabled;
        set
        {
            if (MaskingPreferences.DivineNameMaskingEnabled == value)
            {
                return;
            }

            MaskingPreferences.DivineNameMaskingEnabled = value;
            OnPropertyChanged();
        }
    }

    /// <summary>Selected אלהים display option.</summary>
    public DivineNameMaskOption DivineNameMaskElohim
    {
        get => MaskingPreferences.DivineNameMaskElohim;
        set => SetMaskOption(() => MaskingPreferences.DivineNameMaskElohim = value,
            NotifyMaskElohim);
    }

    /// <summary>Custom replacement text for אלהים (used when "אחר" is selected).</summary>
    public string DivineNameMaskElohimCustom
    {
        get => MaskingPreferences.DivineNameMaskElohimCustom;
        set
        {
            if (MaskingPreferences.DivineNameMaskElohimCustom == value)
            {
                return;
            }

            MaskingPreferences.DivineNameMaskElohimCustom = value;
            OnPropertyChanged();
        }
    }

    /// <summary>Radio wrappers: the CheckedChanged handler is the real mechanism;
    /// setters exist only so the two-way IsChecked binding has a valid target
    /// (a false write-back on deselect is intentionally a no-op).</summary>
    public bool IsMaskElohimAsIs
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.AsIs;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.AsIs; } }
    }

    public bool IsMaskElohimElokim
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.Elokim;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.Elokim; } }
    }

    public bool IsMaskElohimHyphen
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.Hyphen;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.Hyphen; } }
    }

    public bool IsMaskElohimCustom
    {
        get => DivineNameMaskElohim == DivineNameMaskOption.Custom;
        set { if (value) { DivineNameMaskElohim = DivineNameMaskOption.Custom; } }
    }

    /// <summary>Selected יהוה display option (ה' / ד' / אחר — אין "כמות שהוא").</summary>
    public DivineNameMaskOption DivineNameMaskYhwh
    {
        get => MaskingPreferences.DivineNameMaskYhwh;
        set => SetMaskOption(() => MaskingPreferences.DivineNameMaskYhwh = value,
            NotifyMaskYhwh);
    }

    /// <summary>Custom replacement text for יהוה (used when "אחר" is selected).</summary>
    public string DivineNameMaskYhwhCustom
    {
        get => MaskingPreferences.DivineNameMaskYhwhCustom;
        set
        {
            if (MaskingPreferences.DivineNameMaskYhwhCustom == value)
            {
                return;
            }

            MaskingPreferences.DivineNameMaskYhwhCustom = value;
            OnPropertyChanged();
        }
    }

    public bool IsMaskYhwhHeh
    {
        get => DivineNameMaskYhwh == DivineNameMaskOption.Heh;
        set { if (value) { DivineNameMaskYhwh = DivineNameMaskOption.Heh; } }
    }

    public bool IsMaskYhwhDalet
    {
        get => DivineNameMaskYhwh == DivineNameMaskOption.Dalet;
        set { if (value) { DivineNameMaskYhwh = DivineNameMaskOption.Dalet; } }
    }

    public bool IsMaskYhwhCustom
    {
        get => DivineNameMaskYhwh == DivineNameMaskOption.Custom;
        set { if (value) { DivineNameMaskYhwh = DivineNameMaskOption.Custom; } }
    }

    /// <summary>Selected אל display option (כמות שהוא / א-ל).</summary>
    public DivineNameMaskOption DivineNameMaskEl
    {
        get => MaskingPreferences.DivineNameMaskEl;
        set => SetMaskOption(() => MaskingPreferences.DivineNameMaskEl = value,
            NotifyMaskEl);
    }

    public bool IsMaskElAsIs
    {
        get => DivineNameMaskEl == DivineNameMaskOption.AsIs;
        set { if (value) { DivineNameMaskEl = DivineNameMaskOption.AsIs; } }
    }

    public bool IsMaskElHyphen
    {
        get => DivineNameMaskEl == DivineNameMaskOption.Hyphen;
        set { if (value) { DivineNameMaskEl = DivineNameMaskOption.Hyphen; } }
    }

    /// <summary>Selected שדי display option (כמות שהוא / שד-י / אחר).</summary>
    public DivineNameMaskOption DivineNameMaskShaddai
    {
        get => MaskingPreferences.DivineNameMaskShaddai;
        set => SetMaskOption(() => MaskingPreferences.DivineNameMaskShaddai = value,
            NotifyMaskShaddai);
    }

    /// <summary>Custom replacement text for שדי (used when "אחר" is selected).</summary>
    public string DivineNameMaskShaddaiCustom
    {
        get => MaskingPreferences.DivineNameMaskShaddaiCustom;
        set
        {
            if (MaskingPreferences.DivineNameMaskShaddaiCustom == value)
            {
                return;
            }

            MaskingPreferences.DivineNameMaskShaddaiCustom = value;
            OnPropertyChanged();
        }
    }

    public bool IsMaskShaddaiAsIs
    {
        get => DivineNameMaskShaddai == DivineNameMaskOption.AsIs;
        set { if (value) { DivineNameMaskShaddai = DivineNameMaskOption.AsIs; } }
    }

    public bool IsMaskShaddaiHyphen
    {
        get => DivineNameMaskShaddai == DivineNameMaskOption.Hyphen;
        set { if (value) { DivineNameMaskShaddai = DivineNameMaskOption.Hyphen; } }
    }

    public bool IsMaskShaddaiCustom
    {
        get => DivineNameMaskShaddai == DivineNameMaskOption.Custom;
        set { if (value) { DivineNameMaskShaddai = DivineNameMaskOption.Custom; } }
    }

    private void SetMaskOption(Action apply, Action notify)
    {
        apply();
        notify();
    }

    private void NotifyMaskElohim()
    {
        OnPropertyChanged(nameof(DivineNameMaskElohim));
        OnPropertyChanged(nameof(IsMaskElohimAsIs));
        OnPropertyChanged(nameof(IsMaskElohimElokim));
        OnPropertyChanged(nameof(IsMaskElohimHyphen));
        OnPropertyChanged(nameof(IsMaskElohimCustom));
    }

    private void NotifyMaskYhwh()
    {
        OnPropertyChanged(nameof(DivineNameMaskYhwh));
        OnPropertyChanged(nameof(IsMaskYhwhHeh));
        OnPropertyChanged(nameof(IsMaskYhwhDalet));
        OnPropertyChanged(nameof(IsMaskYhwhCustom));
    }

    private void NotifyMaskEl()
    {
        OnPropertyChanged(nameof(DivineNameMaskEl));
        OnPropertyChanged(nameof(IsMaskElAsIs));
        OnPropertyChanged(nameof(IsMaskElHyphen));
    }

    private void NotifyMaskShaddai()
    {
        OnPropertyChanged(nameof(DivineNameMaskShaddai));
        OnPropertyChanged(nameof(IsMaskShaddaiAsIs));
        OnPropertyChanged(nameof(IsMaskShaddaiHyphen));
        OnPropertyChanged(nameof(IsMaskShaddaiCustom));
    }

    #endregion

    protected void NotifyDivineNameMaskingChanged()
    {
        OnPropertyChanged(nameof(DivineNameMaskingEnabled));
        OnPropertyChanged(nameof(DivineNameMaskElohimCustom));
        OnPropertyChanged(nameof(DivineNameMaskYhwhCustom));
        OnPropertyChanged(nameof(DivineNameMaskShaddaiCustom));
        NotifyMaskElohim();
        NotifyMaskYhwh();
        NotifyMaskEl();
        NotifyMaskShaddai();
    }
}
