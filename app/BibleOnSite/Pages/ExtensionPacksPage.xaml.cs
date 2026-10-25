using BibleOnSite.Controls;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// חבילות הרחבה: extension-pack install/remove lifecycle — the פירושים pack
/// plus per-book קריינות recordings with download-all/remove-all.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration.
public partial class ExtensionPacksPage : PreferencesPageBase
#pragma warning restore S2333
{
    private readonly ExtensionPacksViewModel _viewModel;

    public ExtensionPacksPage()
    {
        InitializeComponent();
        _viewModel = new ExtensionPacksViewModel();
        BindingContext = _viewModel;
    }

    public ExtensionPacksPage(ExtensionPacksViewModel viewModel)
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
