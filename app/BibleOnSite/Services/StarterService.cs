using System.Text.Json;
using BibleOnSite.Models;

namespace BibleOnSite.Services;

/// <summary>
/// Service for loading initial app data (authors, articles, perek article counters).
/// Supports offline mode: caches API responses locally and loads from cache when offline.
/// </summary>
public class StarterService : BaseGraphQLService
{
    private static readonly Lazy<StarterService> _instance = new(() => new StarterService());

    /// <summary>
    /// Singleton instance of the StarterService.
    /// </summary>
    public static StarterService Instance => _instance.Value;

    private const string CacheFileName = "starter_cache.json";

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
    /// Indicates whether starter data has been successfully loaded (from API or cache).
    /// </summary>
    public bool IsLoaded { get; private set; }

    /// <summary>
    /// True when data was loaded from local cache rather than from the API.
    /// </summary>
    public bool IsFromCache { get; private set; }

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

        await LoadFromApiAsync();
    }

    /// <summary>
    /// Loads starter data from the API with a 5-second timeout.
    /// </summary>
    public async Task LoadAsync(bool forceReload)
    {
        if (IsLoaded && !forceReload)
            return;

        await LoadFromApiAsync();
    }

    /// <summary>
    /// Fetches starter data from the API and caches the result locally.
    /// </summary>
    private async Task LoadFromApiAsync()
    {
        var response = await QueryWithTimeoutAsync<StarterResponse>(
            GetStarterQuery,
            TimeSpan.FromSeconds(5),
            "GetStarter");

        if (response?.Starter == null)
            return;

        ApplyResponse(response);
        IsFromCache = false;
        IsLoaded = true;

        // Persist to local cache in background (fire-and-forget)
        _ = Task.Run(() => SaveCacheAsync(response));
    }

    /// <summary>
    /// Applies a StarterResponse to the in-memory state (authors, articles, counters).
    /// </summary>
    private void ApplyResponse(StarterResponse response)
    {
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
            .OrderBy(a => a.Name)
            .ToList();

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
    /// Primary startup method.  Tries the API once, falls back to local cache,
    /// and if neither is available proceeds with empty data so the app can start.
    /// Never blocks indefinitely.
    /// </summary>
    public async Task LoadWithRetryAsync()
    {
        if (IsLoaded)
            return;

        // 1. Try the API (single attempt with 5-second timeout)
        try
        {
            Console.WriteLine("Loading starter data from API...");
            await LoadFromApiAsync();
            if (IsLoaded)
            {
                Console.WriteLine($"Loaded {Authors.Count} authors from API");
                return;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"API unavailable: {ex.Message}");
        }

        // 2. Fall back to local cache
        try
        {
            Console.WriteLine("Trying local cache...");
            if (await LoadFromCacheAsync())
            {
                Console.WriteLine($"Loaded {Authors.Count} authors from cache");
                return;
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Cache load failed: {ex.Message}");
        }

        // 3. No data — proceed empty; articles/authors just won't be shown
        Console.WriteLine("No starter data available — proceeding offline without articles");
    }

    /// <summary>
    /// Attempts to refresh starter data from the API.  Called when the device
    /// comes back online after starting in offline mode.
    /// </summary>
    public async Task TryRefreshAsync()
    {
        try
        {
            Console.WriteLine("Refreshing starter data from API...");
            await LoadFromApiAsync();
            if (IsLoaded)
                Console.WriteLine($"Refreshed {Authors.Count} authors from API");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Refresh failed: {ex.Message}");
        }
    }

    #region Local cache

    private static string CachePath =>
        Path.Combine(FileSystem.AppDataDirectory, CacheFileName);

    private static async Task SaveCacheAsync(StarterResponse response)
    {
        try
        {
            var json = JsonSerializer.Serialize(response, StarterJsonContext.Default.StarterResponse);
            await File.WriteAllTextAsync(CachePath, json);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Failed to save starter cache: {ex.Message}");
        }
    }

    private async Task<bool> LoadFromCacheAsync()
    {
        if (!File.Exists(CachePath))
            return false;

        var json = await File.ReadAllTextAsync(CachePath);
        var response = JsonSerializer.Deserialize(json, StarterJsonContext.Default.StarterResponse);
        if (response?.Starter == null)
            return false;

        ApplyResponse(response);
        IsFromCache = true;
        IsLoaded = true;
        return true;
    }

    #endregion

    #region DTOs for GraphQL response

    // Records used for both GraphQL deserialization and local JSON cache.
    // The System.Text.Json source generator (StarterJsonContext) handles
    // the local cache; Newtonsoft handles the GraphQL client.
    internal record StarterResponse(StarterData Starter);

    internal record StarterData(
        List<AuthorData> Authors,
        List<ArticleData> Articles,
        List<int> PerekArticlesCounters);

    internal record AuthorData(
        int Id,
        int ArticlesCount,
        string Details,
        string Name);

    internal record ArticleData(
        int Id,
        int PerekId,
        int AuthorId,
        string? Abstract,
        string Name,
        int Priority);

    #endregion
}

/// <summary>
/// System.Text.Json source generator for StarterService cache serialization.
/// Avoids reflection which is problematic with IL trimming in Release builds.
/// </summary>
[System.Text.Json.Serialization.JsonSerializable(typeof(StarterService.StarterResponse))]
internal partial class StarterJsonContext : System.Text.Json.Serialization.JsonSerializerContext { }
