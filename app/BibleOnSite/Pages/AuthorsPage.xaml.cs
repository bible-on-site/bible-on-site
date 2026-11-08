using BibleOnSite.Models;
using BibleOnSite.Services;
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


    private void OnClearSearchClicked(object sender, EventArgs e)
    {
        AuthorsSearchInput.Text = string.Empty;
        AuthorsSearchInput.Focus();
    }

    private void OnSearchTextChanged(object sender, TextChangedEventArgs e)
    {
        ClearSearchButton.IsVisible = !string.IsNullOrEmpty(e.NewTextValue);
        // The binding handles the search phrase update
        // FilteredAuthors is automatically updated via NotifyPropertyChangedFor
        OnPropertyChanged(nameof(_viewModel.FilteredAuthors));
    }

    private async void OnAuthorTapped(object sender, TappedEventArgs e)
    {
        if (e.Parameter is Author author)
        {
            // Navigate to author's articles page
            try
            {
                var encodedName = Uri.EscapeDataString(author.Name);
                await ShellAppNavigator.Instance.GoToAsync($"ArticlesPage?authorId={author.Id}&authorName={encodedName}");
            }
            #pragma warning disable S2221 // Deliberate failure boundary: navigation failure is log-only
            catch (Exception ex) //NOSONAR — navigation failure is log-only.
            {
                #pragma warning restore S2221
                Console.Error.WriteLine($"Author navigation failed for {author.Id}: {ex}");
            }
        }
    }
}
