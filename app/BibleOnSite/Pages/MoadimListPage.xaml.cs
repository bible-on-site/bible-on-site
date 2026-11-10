using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>מועדים על הפרק section landing — the catalogue grouped by Hebrew month.</summary>
public partial class MoadimListPage : ContentPage //NOSONAR
{
    private readonly MoadimListViewModel _viewModel;

    public MoadimListPage()
    {
        InitializeComponent();
        _viewModel = new MoadimListViewModel();
        BindingContext = _viewModel;
    }

    public MoadimListPage(MoadimListViewModel viewModel)
    {
        InitializeComponent();
        _viewModel = viewModel;
        BindingContext = _viewModel;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _ = _viewModel.LoadAsync();
    }
}
