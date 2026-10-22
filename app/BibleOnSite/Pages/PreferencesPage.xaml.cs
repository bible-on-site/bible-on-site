using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// Settings overview: six category rows, each opening its own detail page.
/// </summary>
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
        await _viewModel.LoadAsync();
    }
}
