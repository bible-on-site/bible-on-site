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

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _viewModel.Load();
    }

    private void OnPerekToLoadRadioChanged(object? sender, CheckedChangedEventArgs e)
    {
        if (e.Value && sender is RadioButton rb)
        {
            if (rb == PerekTodaysRadio)
                _viewModel.PerekToLoad = PerekToLoad.Todays;
            else if (rb == PerekLastRadio)
                _viewModel.PerekToLoad = PerekToLoad.LastLearnt;
        }
    }
}
