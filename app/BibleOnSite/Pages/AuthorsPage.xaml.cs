using BibleOnSite.Models;
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

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        // The binding handles the search phrase update
        // FilteredAuthors is automatically updated via NotifyPropertyChangedFor
        OnPropertyChanged(nameof(_viewModel.FilteredAuthors));
    }

    private async void OnAuthorTapped(object sender, TappedEventArgs e)
    {
        if (e.Parameter is Author author)
        {
            // Navigate to author's articles page
            var encodedName = Uri.EscapeDataString(author.Name);
            await Shell.Current.GoToAsync($"ArticlesPage?authorId={author.Id}&authorName={encodedName}");
        }
    }
}
