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
#pragma warning restore MVVMTK0045

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
                return $"מאמרים של {AuthorName}";
            return $"מאמרים על {PerekTitle}";
        }
    }

    partial void OnAuthorIdChanged(int? value)
    {
        OnPropertyChanged(nameof(DisplayTitle));
    }

    partial void OnAuthorNameChanged(string value)
    {
        OnPropertyChanged(nameof(DisplayTitle));
    }

    partial void OnPerekIdChanged(int value)
    {
        OnPropertyChanged(nameof(DisplayTitle));
    }

    partial void OnPerekTitleChanged(string value)
    {
        OnPropertyChanged(nameof(DisplayTitle));
    }

    public ArticlesViewModel() : this(Services.StarterService.Instance, Services.PerekDataService.Instance,
        Services.ShellAppNavigator.Instance)
    {
    }

    public ArticlesViewModel(Services.StarterService starterService, Services.PerekDataService perekDataService,
        Services.IAppNavigator navigator)
    {
        _starterService = starterService;
        _perekDataService = perekDataService;
        _navigator = navigator;
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
        Articles.Clear();
        foreach (var article in articles)
        {
            Articles.Add(article);
        }
        HasArticles = Articles.Count > 0;
    }

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
            return;

        // Navigate to article detail page
        await _navigator.GoToAsync($"articleDetail?articleId={article.Id}&perekId={article.PerekId}");
    }
#endif
}
