using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Pages;

/// <summary>
/// Page displaying articles related to a specific perek or author.
/// </summary>
[QueryProperty(nameof(PerekId), "perekId")]
[QueryProperty(nameof(PerekTitle), "perekTitle")]
[QueryProperty(nameof(AuthorId), "authorId")]
[QueryProperty(nameof(AuthorName), "authorName")]
// Codacy: S2333 false positive — partial is required by the XAML code generator.
#pragma warning disable S2333
public partial class ArticlesPage : ContentPage, IAnalyticsScreenName, IWindowsDesktopSurface, IWindowsSearchSurface //NOSONAR
#pragma warning restore S2333
{
    private readonly ArticlesViewModel _viewModel;

    public int PerekId { get; set; }
    public string PerekTitle { get; set; } = string.Empty;
    public int AuthorId { get; set; }
    public string AuthorName { get; set; } = string.Empty;

    /// <summary>
    /// Catalogue-scope identity (#3378): the perek or author filter that
    /// brought the user here — or an explicitly global row — never the bare
    /// page name, and never a fabricated article identity.
    /// </summary>
    public AnalyticsScreen? AnalyticsScreen =>
        AuthorId > 0
            ? AnalyticsScreens.ForArticlesList(nameof(ArticlesPage),
                ArticlesListScope.Author, AuthorId, AuthorName)
            : AnalyticsScreens.ForArticlesList(nameof(ArticlesPage),
                PerekId > 0 ? ArticlesListScope.Perek : ArticlesListScope.All,
                PerekId,
                PerekId > 0
                    // The canonical source re-derived from the stable id wins
                    // over the query's label — a hand-crafted URL can lie.
                    ? PerekDataService.Instance.GetPerekSource(PerekId) ?? PerekTitle
                    : null);

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

        // Load on first show only — returning from an article keeps the
        // query, results and scroll position intact.
        if (_viewModel.Articles.Count == 0 && !_viewModel.IsLoading)
        {
            await _viewModel.LoadArticlesCommand.ExecuteAsync(null);
        }
    }

    private async void OnArticleTapped(object? sender, TappedEventArgs e)
    {
        if (e.Parameter is Article article)
        {
            await _viewModel.OpenArticleCommand.ExecuteAsync(article);
        }
    }

    private void OnClearSearchClicked(object? sender, EventArgs e)
    {
        ArticlesSearchInput.Text = string.Empty;
        ArticlesSearchInput.Focus();
    }

    private async void OnSearchTextChanged(object? sender, TextChangedEventArgs e)
    {
        ClearSearchButton.IsVisible = !string.IsNullOrEmpty(e.NewTextValue);
        await _viewModel.ApplySearchAsync(e.NewTextValue);
    }

    /// <summary>Ctrl+F lands in the inline filter when this page shows one —
    /// the perek-scoped view paints a title pill instead (#2766).</summary>
    void IWindowsSearchSurface.OpenDesktopSearch()
    {
        if (ArticlesSearchInput.IsVisible)
        {
            ArticlesSearchInput.Focus();
        }
    }

    /// <summary>Esc in the focused filter clears the query first, then leaves
    /// the field — the desktop two-step, never navigation (#2766).</summary>
    bool IWindowsDesktopSurface.DismissTopmostSurface()
    {
        if (!ArticlesSearchInput.IsFocused)
        {
            return false;
        }
        if (ArticlesSearchInput.Text is { Length: > 0 })
        {
            ArticlesSearchInput.Text = string.Empty;
        }
        else
        {
            ArticlesSearchInput.Unfocus();
        }
        return true;
    }

    void IWindowsDesktopSurface.FocusInitialElement()
    {
        if (!ArticlesSearchInput.IsFocused)
        {
            Controls.SharedTopBar.FocusNavigationButton(this);
        }
    }
}
