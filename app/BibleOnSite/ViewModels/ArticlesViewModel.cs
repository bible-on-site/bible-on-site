using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using BibleOnSite.Models;
using System.Collections.ObjectModel;

namespace BibleOnSite.ViewModels;

/// <summary>
/// ViewModel for displaying articles related to a perek or by an author.
/// Supports filtering by either perek ID or author ID.
/// </summary>
public partial class ArticlesViewModel : ObservableObject
{
    private readonly Services.StarterService _starterService;
    private readonly Services.PerekDataService _perekDataService;
    private readonly Services.IAppNavigator _navigator;
    private readonly Services.ArticleService? _articleService;
    private readonly bool _useDefaultArticleService;
    private CancellationTokenSource? _searchCancellation;
    /// <summary>The unfiltered listing, restored when the search field clears.</summary>
    private List<Article> _allArticles = new();
    /// <summary>True while the list shows search hits rather than the listing.</summary>
    private bool _searchResultsActive;
#pragma warning disable MVVMTK0045
    [ObservableProperty]
    private int _perekId;

    [ObservableProperty]
    private string _perekTitle = string.Empty;

    [ObservableProperty]
    private int? _authorId;

    [ObservableProperty]
    private string _authorName = string.Empty;

    [ObservableProperty]
    private ObservableCollection<Article> _articles = new();

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _hasArticles;

    [ObservableProperty]
    private string _errorMessage = string.Empty;

    [ObservableProperty]
    private string _searchPhrase = string.Empty;

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(ShowSearchStatus))]
    private bool _isSearching;

    /// <summary>Status/availability line for article-content search (never an
    /// error masquerading as an empty list — the listing stays untouched on
    /// failure).</summary>
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(EmptyStateText))]
    [NotifyPropertyChangedFor(nameof(ShowSearchStatus))]
    private string _searchMessage = string.Empty;
#pragma warning restore MVVMTK0045

    /// <summary>Empty-list caption: search context wins over the plain "no articles" one.</summary>
    public string EmptyStateText =>
        !HasArticles && !string.IsNullOrEmpty(SearchMessage) ? SearchMessage : "אין מאמרים";

    /// <summary>Whether the search status row (spinner or message) shows.</summary>
    public bool ShowSearchStatus => IsSearching || !string.IsNullOrEmpty(SearchMessage);

    /// <summary>
    /// Gets whether we are filtering by perek.
    /// </summary>
    public bool IsFilterByPerek => PerekId > 0;

    /// <summary>
    /// Gets whether we are filtering by author.
    /// </summary>
    public bool IsFilterByAuthor => AuthorId.HasValue && AuthorId > 0;

    /// <summary>
    /// Gets the display title based on filter mode.
    /// </summary>
    public string DisplayTitle
    {
        get
        {
            if (IsFilterByAuthor)
            {
                return $"מאמרים של {AuthorName}";
            }

            return $"מאמרים על {PerekTitle}";
        }
    }

    partial void OnAuthorIdChanged(int? value)
    {
        // A new author means a new search scope: drop the previous context's
        // pending responses and the stale list before reloading.
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _searchResultsActive = false;
        SearchPhrase = string.Empty;
        SearchMessage = string.Empty;
        OnPropertyChanged(nameof(DisplayTitle));
        OnPropertyChanged(nameof(IsFilterByAuthor));
        OnPropertyChanged(nameof(IsFilterByPerek));
    }

    partial void OnAuthorNameChanged(string value)
    {
        OnPropertyChanged(nameof(DisplayTitle));
    }

    partial void OnPerekIdChanged(int value)
    {
        OnPropertyChanged(nameof(DisplayTitle));
        OnPropertyChanged(nameof(IsFilterByAuthor));
        OnPropertyChanged(nameof(IsFilterByPerek));
    }

    partial void OnPerekTitleChanged(string value)
    {
        OnPropertyChanged(nameof(DisplayTitle));
    }

    public ArticlesViewModel() : this(Services.StarterService.Instance, Services.PerekDataService.Instance,
        Services.ShellAppNavigator.Instance)
    {
        _useDefaultArticleService = true;
    }

    public ArticlesViewModel(Services.StarterService starterService, Services.PerekDataService perekDataService,
        Services.IAppNavigator navigator) : this(starterService, perekDataService, navigator, null)
    {
    }

    public ArticlesViewModel(Services.StarterService starterService, Services.PerekDataService perekDataService,
        Services.IAppNavigator navigator, Services.ArticleService? articleService)
    {
        _starterService = starterService;
        _perekDataService = perekDataService;
        _navigator = navigator;
        _articleService = articleService;
        _useDefaultArticleService = articleService == null;
    }

    /// <summary>
    /// Creates a view model for articles filtered by perek.
    /// </summary>
    public ArticlesViewModel(int perekId, string perekTitle) : this()
    {
        _perekId = perekId;
        _perekTitle = perekTitle;
    }

    /// <summary>
    /// Creates a view model for articles filtered by author.
    /// </summary>
    public static ArticlesViewModel ForAuthor(int authorId, string authorName)
    {
        return new ArticlesViewModel
        {
            AuthorId = authorId,
            AuthorName = authorName
        };
    }

    /// <summary>
    /// Sets the articles collection (useful for testing and initialization).
    /// </summary>
    public void SetArticles(IEnumerable<Article> articles)
    {
        var list = articles.ToList();
        // Every writer funnels here; while search hits are on screen the
        // latest listing refresh becomes the restore target instead of the hits.
        if (!_searchResultsActive)
        {
            _allArticles = list;
        }
        Articles.Clear();
        foreach (var article in list)
        {
            Articles.Add(article);
        }
        HasArticles = Articles.Count > 0;
        OnPropertyChanged(nameof(EmptyStateText));
    }

#if MAUI
    /// <summary>Debounce before the server round-trip; rapid typing must not
    /// fire a request per keystroke.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(300);
    /// <summary>Page size for author-scoped content search.</summary>
    private const int AuthorSearchLimit = 50;

    /// <summary>
    /// Applies an article-content search scoped to the current author. An
    /// empty phrase restores the normal listing; a failed/unavailable search
    /// reports through <see cref="SearchMessage"/> and keeps the list as-is.
    /// </summary>
    public async Task ApplySearchAsync(string? phrase)
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        if (!IsFilterByAuthor)
        {
            return;
        }
        if (string.IsNullOrWhiteSpace(phrase))
        {
            _searchResultsActive = false;
            SetArticles(_allArticles);
            SearchMessage = string.Empty;
            IsSearching = false;
            return;
        }
        var cts = _searchCancellation = new CancellationTokenSource();
        var token = cts.Token;
        var authorId = AuthorId!.Value;
        try
        {
            IsSearching = true;
            SearchMessage = string.Empty;
            await Task.Delay(SearchDebounce, token);
            var service = _useDefaultArticleService ? Services.ArticleService.Instance : _articleService;
            var page = service == null
                ? null
                : await service.SearchArticlesAsync(phrase, AuthorSearchLimit, authorId, token);
            if (token.IsCancellationRequested)
            {
                return;
            }
            if (page == null)
            {
                SearchMessage = "חיפוש תוכן מאמרים זמין רק עם חיבור רשת";
                return;
            }
            _searchResultsActive = true;
            SetArticles(page.Hits.Select(MapHit));
            SearchMessage = page.Hits.Count == 0 ? "לא נמצאו מאמרים התואמים את החיפוש" : string.Empty;
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested)
        {
            // A newer query or an author switch owns the list now.
        }
        catch (Exception ex)
        {
            if (!token.IsCancellationRequested)
            {
                SearchMessage = "חיפוש תוכן מאמרים דורש חיבור רשת תקין";
                Console.Error.WriteLine($"Author article search failed: {ex}");
            }
        }
        finally
        {
            if (!token.IsCancellationRequested)
            {
                IsSearching = false;
            }
        }
    }

    private Article MapHit(Services.ArticleService.ArticleSearchHit hit)
    {
        var author = _starterService.Authors.FirstOrDefault(a => a.Id == hit.AuthorId)
            ?? new Author { Id = hit.AuthorId, Name = hit.AuthorName, Details = string.Empty };
        return new Article
        {
            Id = hit.ArticleId,
            PerekId = hit.PerekId,
            AuthorId = hit.AuthorId,
            // The hit excerpt is the content match context; the card's
            // ShortAbstract renders it as-is (plain text passes through).
            Abstract = hit.Excerpt,
            Name = hit.Name,
            PerekDisplayName = string.IsNullOrEmpty(hit.Source)
                ? _perekDataService.GetPerekSource(hit.PerekId)
                : hit.Source,
            Author = author
        };
    }
#endif

#if MAUI
    /// <summary>
    /// Loads articles for the current filter (perek or author).
    /// Uses cached Starter data for instant loading (no API calls).
    /// </summary>
    [RelayCommand]
    public async Task LoadArticlesAsync()
    {
        try
        {
            IsLoading = true;
            ErrorMessage = string.Empty;

            // Ensure Starter data is loaded
#if DEBUG
            await _starterService.LoadAsync(forceReload: true);
#else
            if (!_starterService.IsLoaded)
            {
                await _starterService.LoadAsync();
            }
#endif

            IEnumerable<Article> articles;

            if (IsFilterByAuthor && AuthorId.HasValue)
            {
                // Use cached Starter data - instant, no API call
                articles = _starterService.GetArticlesByAuthorId(AuthorId.Value);

                // Populate PerekDisplayName for each article (needed when showing articles by author)
                foreach (var article in articles)
                {
                    article.PerekDisplayName = _perekDataService.GetPerekSource(article.PerekId);
                }
            }
            else if (IsFilterByPerek)
            {
                // Use cached Starter data - instant, no API call
                articles = _starterService.GetArticlesByPerekId(PerekId);
            }
            else
            {
                articles = Array.Empty<Article>();
            }

            SetArticles(articles);
        }
        catch (Exception ex)
        {
            ErrorMessage = $"שגיאה בטעינת המאמרים: {ex.Message}";
            Console.Error.WriteLine($"Error loading articles: {ex}");
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Opens an article for reading.
    /// </summary>
    [RelayCommand]
    public async Task OpenArticleAsync(Article article)
    {
        if (article == null)
        {
            return;
        }

        // Navigate to article detail page
        await _navigator.GoToAsync($"articleDetail?articleId={article.Id}&perekId={article.PerekId}");
    }
#endif
}
