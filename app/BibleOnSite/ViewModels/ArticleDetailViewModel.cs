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
    /// Gets the article content wrapped with RTL justify styling.
    /// </summary>
    public string? StyledContent => Article?.ArticleContent != null
        ? $"<div style=\"direction: rtl; text-align: justify;\">{Article.ArticleContent}</div>"
        : null;

    /// <summary>
    /// Gets the article content as a full HTML document for WebView with proper RTL and justify styling.
    /// </summary>
    public string? WebViewContent => Article?.ArticleContent != null
        ? $@"<!DOCTYPE html>
<html dir=""rtl"" lang=""he"">
<head>
    <meta charset=""UTF-8"">
    <meta name=""viewport"" content=""width=device-width, initial-scale=1.0"">
    <style>
        * {{
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            font-size: 16px;
            line-height: 1.6;
            direction: rtl;
            text-align: justify;
            color: #1a1a1a;
            background-color: transparent;
            padding: 0;
        }}
        @media (prefers-color-scheme: dark) {{
            body {{
                color: #e0e0e0;
                background-color: transparent;
            }}
            a {{
                color: #6ba3ff;
            }}
        }}
        h1 {{
            font-size: 1.125em;
            margin-bottom: 0.5em;
        }}
        h2 {{
            font-size: 1.0625em;
            text-decoration: underline;
            margin-bottom: 0.5em;
        }}
        h3 {{
            font-size: 0.925em;
            text-decoration: underline;
            margin-bottom: 0.5em;
        }}
        p {{
            margin-bottom: 1em;
        }}
        a {{
            color: #0066cc;
        }}
    </style>
</head>
<body>
{Article.ArticleContent}
</body>
</html>"
        : null;

    /// <summary>
    /// Gets the article display title (uses ShortAbstract, consistent with ArticleCard).
    /// </summary>
    public string ArticleName => Article?.ShortAbstract ?? string.Empty;

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
        OnPropertyChanged(nameof(StyledContent));
        OnPropertyChanged(nameof(WebViewContent));
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
