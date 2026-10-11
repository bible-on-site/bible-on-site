using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

public partial class PreferencesPage : ContentPage
{
    private readonly PreferencesViewModel _viewModel;

    public PreferencesPage()
    {
        InitializeComponent();
        _viewModel = new PreferencesViewModel();
        BindingContext = _viewModel;
    }

    public PreferencesPage(PreferencesViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        _viewModel.Load();
        await _viewModel.Recitation.LoadAsync();
    }

    private void OnPerekToLoadRadioChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (e.Value && sender is RadioButton rb)
        {
            if (rb == PerekTodaysRadio)
            {
                _viewModel.PerekToLoad = PerekToLoad.Todays;
            }
            else if (rb == PerekLastRadio)
            {
                _viewModel.PerekToLoad = PerekToLoad.LastLearnt;
            }
        }
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

        _viewModel.DivineNameMaskElohim = rb.AutomationId switch
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

        _viewModel.DivineNameMaskYhwh = rb.AutomationId switch
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

        _viewModel.DivineNameMaskEl = rb.AutomationId == "MaskElHyphen"
            ? DivineNameMaskOption.Hyphen
            : DivineNameMaskOption.AsIs;
    }

    private void OnMaskShaddaiRadioChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (!e.Value || sender is not RadioButton rb)
        {
            return;
        }

        _viewModel.DivineNameMaskShaddai = rb.AutomationId switch
        {
            "MaskShaddaiHyphen" => DivineNameMaskOption.Hyphen,
            "MaskShaddaiCustomRadio" => DivineNameMaskOption.Custom,
            _ => DivineNameMaskOption.AsIs,
        };
    }
}
