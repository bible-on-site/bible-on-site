using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// The Tanahpedia landing page — today's anniversaries, the category
/// hierarchy and recently updated entries, mirroring the website's
/// <c>/pedia</c> landing.
/// </summary>
public partial class TanahpediaPage : ContentPage
{
    private readonly TanahpediaViewModel _viewModel = new();

    public TanahpediaPage()
    {
        InitializeComponent();
        BindingContext = _viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (!_viewModel.IsLoaded && !_viewModel.IsLoading)
        {
            await _viewModel.LoadAsync();
        }
    }

    private void OnMenuButtonClicked(object sender, EventArgs e)
    {
        if (Shell.Current is AppShell shell)
        {
            shell.FlyoutIsPresented = true;
        }
    }
}
