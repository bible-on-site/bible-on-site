using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// The Tanahpedia landing page — today's anniversaries, the category
/// hierarchy and recently updated entries, mirroring the website's
/// <c>/pedia</c> landing.
/// </summary>
#pragma warning disable S2333 // MAUI XAML supplies the other partial declaration and controls.
public partial class TanahpediaPage : ContentPage
#pragma warning restore S2333
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

    private async void OnSearchTitleClicked(object sender, EventArgs e) //NOSONAR
    {
        await TanahpediaSearch.OpenAsync();
    }

    private async void OnSearchEntrySelected(object? sender, string uniqueName) //NOSONAR
    {
        await _viewModel.OpenEntryCommand.ExecuteAsync(uniqueName);
    }

    protected override bool OnBackButtonPressed()
    {
        if (TanahpediaSearch.HandleBack())
        {
            return true;
        }
        return base.OnBackButtonPressed();
    }
}
