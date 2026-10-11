using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// Second-level קריינות settings: playback configuration plus per-book and
/// whole-pack install/remove controls with honest on-disk installation state.
/// </summary>
public partial class RecitationPreferencesPage : ContentPage
{
    private readonly RecitationPreferencesViewModel _viewModel;

    public RecitationPreferencesPage()
    {
        InitializeComponent();
        _viewModel = new RecitationPreferencesViewModel();
        BindingContext = _viewModel;
    }

    public RecitationPreferencesPage(RecitationPreferencesViewModel viewModel)
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

    /// <summary>Per-book removal: the button's CommandParameter carries the row's book choice.</summary>
    private async void OnRemoveBookClicked(object? sender, EventArgs e)
    {
        if (sender is Button { CommandParameter: RecitationBookChoice book })
        {
            await _viewModel.RemoveBookAsync(book);
        }
    }
}
