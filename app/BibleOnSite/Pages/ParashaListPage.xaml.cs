using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>פרשה על הפרק section landing — the Torah parasha list.</summary>
public partial class ParashaListPage : ContentPage
{
    private readonly ParashaListViewModel _viewModel;

    public ParashaListPage()
    {
        InitializeComponent();
        _viewModel = new ParashaListViewModel();
        BindingContext = _viewModel;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _ = _viewModel.LoadAsync();
    }

    private void OnMenuButtonClicked(object? sender, EventArgs e)
    {
        Shell.Current.FlyoutIsPresented = true;
    }
}
