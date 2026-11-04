using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for the article detail page.
/// </summary>
public partial class ArticleDetailViewModel : ObservableObject
{
    private readonly Services.IAppNavigator _navigator;
    private readonly IShare _share;

    public ArticleDetailViewModel() : this(Services.ShellAppNavigator.Instance, Share.Default) { }

    public ArticleDetailViewModel(Services.IAppNavigator navigator, IShare share)
    {
        _navigator = navigator;
        _share = share;
    }
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    private Article? _article;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private string? _errorMessage;

    /// <summary>0–1 word-weighted reading position over the article body
    /// (issue #2607), bound to the page's progress bar.</summary>
    [ObservableProperty]
    private double _readingProgress;
#pragma warning restore MVVMTK0045

    /// <summary>Stored words attributed to each rendered content child —
    /// set by the page once it builds the article body (issue #2607).</summary>
    private IReadOnlyList<Helpers.CountedProgressRegion> _progressRegions = [];
    private int? _progressTotalWords;

    /// <summary>True when stored progress units cover the article body —
    /// the bar stays hidden on unknown/empty metrics (issue #2607).</summary>
    public bool HasReadingProgress => _progressRegions.Count > 0;

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
    /// "זמן קריאה משוער: X" badge over the full article body (issue #2607);
    /// null when the metric is unknown — the badge hides entirely.
    /// </summary>
    public string? ReadingTimeBadge => Article?.ReadingTimeBadge;

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
        OnPropertyChanged(nameof(ReadingTimeBadge));
    }

    /// <summary>
    /// Registers the attributed progress regions after the page builds the
    /// article body children (issue #2607). Resets the bar to the top —
    /// a freshly opened article reads 0% even while the previous scroll
    /// position still applies.
    /// </summary>
    public void SetReadingContent(
        IReadOnlyList<Helpers.CountedProgressRegion> regions,
        int? totalWords)
    {
        _progressRegions = regions;
        _progressTotalWords = totalWords;
        ReadingProgress = 0;
        OnPropertyChanged(nameof(HasReadingProgress));
    }

    /// <summary>
    /// Recomputes the reading position for a scroll state (issue #2607).
    /// <paramref name="childExtents"/> carries each counted child's measured
    /// (top, bottom) in scroll-content coordinates — the page reads them off
    /// its rendered HtmlViews so layout, font-size and late media changes all
    /// count without a re-attribution.
    /// </summary>
    public void UpdateReadingProgress(
        double scrollY,
        double viewportHeight,
        double scrollContentHeight,
        IReadOnlyList<(double Top, double Bottom)> childExtents)
    {
        ReadingProgress = Helpers.ReadingProgressEngine.Fraction(
            _progressRegions,
            _progressTotalWords,
            scrollY,
            viewportHeight,
            scrollContentHeight,
            childExtents);
    }

#if MAUI
    /// <summary>
    /// Shares the article URL.
    /// </summary>
    [RelayCommand]
    public async Task ShareAsync()
    {
        if (Article == null)
        {
            return;
        }

        try
        {
            await _share.RequestAsync(new ShareTextRequest
            {
                Text = $"{ArticleName} - {AuthorName}",
                Uri = ShareUrl,
                Title = "שתף מאמר"
            });
        }
        #pragma warning disable S2221 // Deliberate failure boundary: share failure must not crash the command
        catch (Exception ex) //NOSONAR — share failure must not crash the command.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Article share failed for {Article?.Id}: {ex}");
        }
    }

    /// <summary>
    /// Navigates back.
    /// </summary>
    [RelayCommand]
    public async Task GoBackAsync()
    {
        try
        {
            await _navigator.GoToAsync("..");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: navigation failure must not crash the caller
        catch (Exception ex) //NOSONAR — navigation failure must not crash the caller.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Back navigation failed: {ex}");
        }
    }

    /// <summary>
    /// Navigates to the author's page.
    /// </summary>
    [RelayCommand]
    public async Task GoToAuthorAsync()
    {
        if (Article?.Author == null)
        {
            return;
        }

        try
        {
            var authorId = Article.Author.Id;
            var authorName = Uri.EscapeDataString(Article.Author.Name);
            await _navigator.GoToAsync($"ArticlesPage?authorId={authorId}&authorName={authorName}");
        }
        #pragma warning disable S2221 // Deliberate failure boundary: navigation failure must not crash the caller
        catch (Exception ex) //NOSONAR — navigation failure must not crash the caller.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Author navigation failed for {Article?.Author?.Id}: {ex}");
        }
    }
#endif
}
