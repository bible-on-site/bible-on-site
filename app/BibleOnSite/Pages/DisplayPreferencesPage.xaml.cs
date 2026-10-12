using BibleOnSite.Helpers;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// תצוגה settings: font size with a live text preview.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
public partial class DisplayPreferencesPage : ContentPage
#pragma warning restore S2333
{
    public DisplayPreferencesPage()
    {
        InitializeComponent();
        BindingContext = new DisplayPreferencesViewModel();
    }

    public DisplayPreferencesPage(DisplayPreferencesViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = viewModel;
    }

    /// <summary>
    /// RadioButton group handlers for הסתר שם השם. Only CheckedChanged with
    /// e.Value == true applies a selection (a deselected sibling fires the same
    /// event with false and must not overwrite the choice).
    /// </summary>
    private void OnMaskElohimRadioChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (!e.Value || sender is not RadioButton rb)
        {
            return;
        }

        ((DisplayPreferencesViewModel)BindingContext).DivineNameMaskElohim = rb.AutomationId switch
        {
            "MaskElohimAsIs" => DivineNameMaskOption.AsIs,
            "MaskElohimElokim" => DivineNameMaskOption.Elokim,
            "MaskElohimCustomRadio" => DivineNameMaskOption.Custom,
            _ => DivineNameMaskOption.Hyphen,
        };
    }

    private void OnMaskYhwhRadioChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (!e.Value || sender is not RadioButton rb)
        {
            return;
        }

        ((DisplayPreferencesViewModel)BindingContext).DivineNameMaskYhwh = rb.AutomationId switch
        {
            "MaskYhwhDalet" => DivineNameMaskOption.Dalet,
            "MaskYhwhCustomRadio" => DivineNameMaskOption.Custom,
            _ => DivineNameMaskOption.Heh,
        };
    }

    private void OnMaskElRadioChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (!e.Value || sender is not RadioButton rb)
        {
            return;
        }

        ((DisplayPreferencesViewModel)BindingContext).DivineNameMaskEl = rb.AutomationId == "MaskElHyphen"
            ? DivineNameMaskOption.Hyphen
            : DivineNameMaskOption.AsIs;
    }

    private void OnMaskShaddaiRadioChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (!e.Value || sender is not RadioButton rb)
        {
            return;
        }

        ((DisplayPreferencesViewModel)BindingContext).DivineNameMaskShaddai = rb.AutomationId switch
        {
            "MaskShaddaiHyphen" => DivineNameMaskOption.Hyphen,
            "MaskShaddaiCustomRadio" => DivineNameMaskOption.Custom,
            _ => DivineNameMaskOption.AsIs,
        };
    }
}
