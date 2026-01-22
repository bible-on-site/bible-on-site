using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for the article detail page.
/// </summary>
public partial class ArticleDetailViewModel : ObservableObject
{
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    private Article? _article;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private string? _errorMessage;
#pragma warning restore MVVMTK0045

    /// <summary>
    /// Gets whether the article has content to display.
    /// </summary>
    public bool HasContent => !string.IsNullOrEmpty(Article?.ArticleContent);

    /// <summary>
    /// Gets the article name.
    /// </summary>
    public string ArticleName => Article?.Name ?? string.Empty;

    /// <summary>
    /// Gets the author name.
    /// </summary>
    public string AuthorName => Article?.Author?.Name ?? string.Empty;

    /// <summary>
    /// Gets the author image URL.
    /// </summary>
    public string? AuthorImageUrl => Article?.Author?.ImageUrl;

    /// <summary>
    /// Gets the share URL for this article.
    /// </summary>
    public string ShareUrl => Article != null
        ? $"https://תנך.co.il/929/{Article.PerekId}/{Article.Id}"
        : string.Empty;

    /// <summary>
    /// Sets the article to display.
    /// </summary>
    public void SetArticle(Article article)
    {
        Article = article;
        IsLoading = false;
        OnPropertyChanged(nameof(HasContent));
        OnPropertyChanged(nameof(ArticleName));
        OnPropertyChanged(nameof(AuthorName));
        OnPropertyChanged(nameof(AuthorImageUrl));
        OnPropertyChanged(nameof(ShareUrl));
    }

#if MAUI
    /// <summary>
    /// Shares the article URL.
    /// </summary>
    [RelayCommand]
    public async Task ShareAsync()
    {
        if (Article == null)
            return;

        await Share.RequestAsync(new ShareTextRequest
        {
            Text = $"{ArticleName} - {AuthorName}",
            Uri = ShareUrl,
            Title = "שתף מאמר"
        });
    }

    /// <summary>
    /// Navigates back.
    /// </summary>
    [RelayCommand]
    public async Task GoBackAsync()
    {
        await Shell.Current.GoToAsync("..");
    }

    /// <summary>
    /// Navigates to the author's page.
    /// </summary>
    [RelayCommand]
    public async Task GoToAuthorAsync()
    {
        if (Article?.Author == null)
            return;

        var authorId = Article.Author.Id;
        var authorName = Uri.EscapeDataString(Article.Author.Name);
        await Shell.Current.GoToAsync($"ArticlesPage?authorId={authorId}&authorName={authorName}");
    }
#endif
}
