using BibleOnSite.ViewModels;
using BibleOnSite.Controls;

namespace BibleOnSite.Pages;

/// <summary>
/// Settings overview: six category rows, each opening its own detail page.
/// </summary>
public partial class PreferencesPage : PreferencesPageBase, IQueryAttributable
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

    private ExtensionPacksViewModel? _packs;

    public void ApplyQueryAttributes(IDictionary<string, object> query)
    {
        if (query.TryGetValue("section", out var section) && section is "packs" && _packs is null)
        {
            _packs = new ExtensionPacksViewModel();
            BindingContext = _packs;
            Content = new ExtensionPacksView();
            Title = "העדפות - חבילות הרחבה";
        }
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (_packs is not null)
        {
            await _packs.LoadAsync();
        }
        else
        {
            await _viewModel.LoadAsync();
        }
    }
}
