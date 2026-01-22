using BibleOnSite.Models;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// Page displaying articles related to a specific perek or author.
/// </summary>
[QueryProperty(nameof(PerekId), "perekId")]
[QueryProperty(nameof(PerekTitle), "perekTitle")]
[QueryProperty(nameof(AuthorId), "authorId")]
[QueryProperty(nameof(AuthorName), "authorName")]
public partial class ArticlesPage : ContentPage
{
    private readonly ArticlesViewModel _viewModel;

    public int PerekId { get; set; }
    public string PerekTitle { get; set; } = string.Empty;
    public int AuthorId { get; set; }
    public string AuthorName { get; set; } = string.Empty;

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
        if (AuthorId > 0)
        {
            // Filter by author
            _viewModel.AuthorId = AuthorId;
            _viewModel.AuthorName = AuthorName;
        }
        else
        {
            // Filter by perek
            _viewModel.PerekId = PerekId;
            _viewModel.PerekTitle = PerekTitle;
        }

        // Load articles from API
        await _viewModel.LoadArticlesCommand.ExecuteAsync(null);
    }

    private async void OnArticleTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is Article article)
        {
            await _viewModel.OpenArticleCommand.ExecuteAsync(article);
        }
    }

    private async void OnBackClicked(object? sender, EventArgs e)
    {
        await Shell.Current.GoToAsync("..");
    }
}
