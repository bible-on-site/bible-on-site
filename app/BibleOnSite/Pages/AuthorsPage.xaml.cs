using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

public partial class AuthorsPage : ContentPage
{
    private readonly AuthorsViewModel _viewModel = new();

    public AuthorsPage()
    {
        InitializeComponent();
        BindingContext = _viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        if (_viewModel.Authors.Count == 0 && !_viewModel.IsLoading)
        {
            await _viewModel.LoadAuthorsAsync();
        }
    }
}
