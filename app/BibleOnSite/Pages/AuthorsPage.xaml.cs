using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

#pragma warning disable S2333 // MAUI XAML generates the other partial declaration.
public partial class AuthorsPage : ContentPage, IWindowsDesktopSurface, IWindowsSearchSurface
#pragma warning restore S2333
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


    private void OnClearSearchClicked(object? sender, EventArgs e)
    {
        AuthorsSearchInput.Text = string.Empty;
        AuthorsSearchInput.Focus();
    }

    private void OnSearchTextChanged(object? sender, TextChangedEventArgs e)
    {
        ClearSearchButton.IsVisible = !string.IsNullOrEmpty(e.NewTextValue);
        // The binding handles the search phrase update
        // FilteredAuthors is automatically updated via NotifyPropertyChangedFor
        OnPropertyChanged(nameof(_viewModel.FilteredAuthors));
    }

    /// <summary>Ctrl+F lands in the author filter (#2766).</summary>
    void IWindowsSearchSurface.OpenDesktopSearch() => AuthorsSearchInput.Focus();

    /// <summary>Esc in the focused filter clears the query first, then leaves
    /// the field — the desktop two-step, never navigation (#2766).</summary>
    bool IWindowsDesktopSurface.DismissTopmostSurface()
    {
        if (!AuthorsSearchInput.IsFocused)
        {
            return false;
        }
        if (AuthorsSearchInput.Text is { Length: > 0 })
        {
            AuthorsSearchInput.Text = string.Empty;
        }
        else
        {
            AuthorsSearchInput.Unfocus();
        }
        return true;
    }

    void IWindowsDesktopSurface.FocusInitialElement()
    {
        if (!AuthorsSearchInput.IsFocused)
        {
            Controls.SharedTopBar.FocusNavigationButton(this);
        }
    }

    private async void OnAuthorTapped(object? sender, TappedEventArgs e)
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
