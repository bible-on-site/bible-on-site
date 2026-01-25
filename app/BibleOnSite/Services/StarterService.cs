using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading initial app data (authors, articles, perek article counters).
/// Follows singleton pattern matching the legacy Flutter implementation.
/// </summary>
public class StarterService : BaseGraphQLService
{
    private static readonly Lazy<StarterService> _instance = new(() => new StarterService());

    /// <summary>
    /// Singleton instance of the StarterService.
    /// </summary>
    public static StarterService Instance => _instance.Value;

    private StarterService() { }

    /// <summary>
    /// List of all authors loaded from the API.
    /// </summary>
    public List<Author> Authors { get; private set; } = [];

    /// <summary>
    /// List of all articles loaded from the API.
    /// </summary>
    public List<Article> Articles { get; private set; } = [];

    /// <summary>
    /// Array of article counts per perek (index 0 = perek 1, etc.)
    /// Initialized to 929 zeros, populated after LoadAsync.
    /// </summary>
    public List<int> PerekArticlesCounters { get; private set; } = Enumerable.Repeat(0, 929).ToList();

    /// <summary>
    /// Indicates whether starter data has been successfully loaded.
    /// </summary>
    public bool IsLoaded { get; private set; }

    private const string GetStarterQuery = """
        query GetStarter {
            starter {
                authors {
                    id
                    articlesCount
                    details
                    name
                }
                articles {
                    id
                    perekId
                    authorId
                    abstract
                    name
                    priority
                }
                perekArticlesCounters
            }
        }
        """;

    /// <summary>
    /// Loads starter data from the API with a 5-second timeout.
    /// </summary>
    public async Task LoadAsync()
    {
        if (IsLoaded)
            return;

        var response = await QueryWithTimeoutAsync<StarterResponse>(
            GetStarterQuery,
            TimeSpan.FromSeconds(5),
            "GetStarter");

        if (response?.Starter == null)
            return;

        // Build authors dictionary for article lookup
        var authorsById = new Dictionary<int, Author>();

        Authors = response.Starter.Authors
            .Select(a =>
            {
                var author = new Author
                {
                    Id = a.Id,
                    ArticlesCount = a.ArticlesCount,
                    Details = a.Details,
                    Name = a.Name
                };
                authorsById[a.Id] = author;
                return author;
            })
            .ToList();

        // Build articles with author references
        Articles = response.Starter.Articles
            .Select(a =>
            {
                authorsById.TryGetValue(a.AuthorId, out var author);
                return new Article
                {
                    Id = a.Id,
                    PerekId = a.PerekId,
                    AuthorId = a.AuthorId,
                    Abstract = a.Abstract ?? string.Empty,
                    Name = a.Name,
                    Priority = a.Priority,
                    Author = author
                };
            })
            .ToList();

        PerekArticlesCounters = response.Starter.PerekArticlesCounters.ToList();
        IsLoaded = true;
    }

    /// <summary>
    /// Gets articles for a specific author from cached data.
    /// </summary>
    public List<Article> GetArticlesByAuthorId(int authorId)
    {
        return Articles
            .Where(a => a.AuthorId == authorId)
            .OrderBy(a => a.Priority)
            .ToList();
    }

    /// <summary>
    /// Gets articles for a specific perek from cached data.
    /// </summary>
    public List<Article> GetArticlesByPerekId(int perekId)
    {
        return Articles
            .Where(a => a.PerekId == perekId)
            .OrderBy(a => a.Priority)
            .ToList();
    }

    /// <summary>
    /// Loads starter data with retry on failure (5-second delay between retries).
    /// </summary>
    public async Task LoadWithRetryAsync()
    {
        try
        {
            Console.WriteLine("Loading starter data...");
            await LoadAsync();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to load starter, retrying in 5 seconds: {ex.Message}");
            await Task.Delay(TimeSpan.FromSeconds(5));
            await LoadWithRetryAsync();
        }
    }

    #region DTOs for GraphQL response

    private record StarterResponse(StarterData Starter);

    private record StarterData(
        List<AuthorData> Authors,
        List<ArticleData> Articles,
        List<int> PerekArticlesCounters);

    private record AuthorData(
        int Id,
        int ArticlesCount,
        string Details,
        string Name);

    private record ArticleData(
        int Id,
        int PerekId,
        int AuthorId,
        string? Abstract,
        string Name,
        int Priority);

    #endregion
}
