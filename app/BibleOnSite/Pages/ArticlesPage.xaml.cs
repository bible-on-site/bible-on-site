using BibleOnSite.Models;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// Page displaying articles related to a specific perek.
/// </summary>
[QueryProperty(nameof(PerekId), "perekId")]
[QueryProperty(nameof(PerekTitle), "perekTitle")]
public partial class ArticlesPage : ContentPage
{
    private readonly ArticlesViewModel _viewModel;

    public int PerekId { get; set; }
    public string PerekTitle { get; set; } = string.Empty;

    public ArticlesPage()
    {
        InitializeComponent();
        _viewModel = new ArticlesViewModel();
        BindingContext = _viewModel;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();

        // Set the ViewModel properties from query parameters
        _viewModel.PerekId = PerekId;
        _viewModel.PerekTitle = PerekTitle;

        // Load articles from API
        await _viewModel.LoadArticlesCommand.ExecuteAsync(null);
    }

    private async void OnArticleSelected(object? sender, SelectionChangedEventArgs e)
    {
        if (e.CurrentSelection.FirstOrDefault() is Article article)
        {
            // Clear selection
            if (sender is CollectionView collectionView)
            {
                collectionView.SelectedItem = null;
            }

            // Navigate to article
            await _viewModel.OpenArticleCommand.ExecuteAsync(article);
        }
    }
}
