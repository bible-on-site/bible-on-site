using System.Text.Json;
using BibleOnSite.Models;
using GraphQL.Client.Http;
using BibleOnSite.Helpers;

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

    private readonly IFileSystem _fileSystem;

    private StarterService()
    {
        _fileSystem = FileSystem.Current;
        _scheduleService = PerekScheduleService.Instance;
    }

    public StarterService(GraphQLHttpClient client, IFileSystem fileSystem)
        : this(client, fileSystem, PerekScheduleService.Instance) { }

    public StarterService(GraphQLHttpClient client, IFileSystem fileSystem,
        PerekScheduleService scheduleService) : base(client)
    {
        _fileSystem = fileSystem;
        _scheduleService = scheduleService;
    }

    private readonly PerekScheduleService _scheduleService;

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
                    readingMetric {
                        wordCount
                        estimatedSeconds
                        wordsPerMinute
                        calcVersion
                        sourceHash
                    }
                }
                perekArticlesCounters
                articleHebrewDateOverrides {
                    articleId
                    hebrewMonth
                    hebrewDay
                }
            }
        }
        """;

    /// <summary>
    /// Loads starter data from the API with a 5-second timeout.
    /// </summary>
    public async Task LoadAsync()
    {
        if (IsLoaded)
        {
            return;
        }

        await LoadFromApiAsync();
    }

    /// <summary>
    /// Loads starter data from the API with a 5-second timeout.
    /// </summary>
    public async Task LoadAsync(bool forceReload)
    {
        if (IsLoaded && !forceReload)
        {
            return;
        }

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
        {
            return;
        }

        ApplyResponse(response);
        IsFromCache = false;
        IsLoaded = true;

        // Finish persisting before reporting a completed load, so immediate offline
        // restarts can use the response and tests can observe the durable result.
        await SaveCacheAsync(response);
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
                    ReadingMetric = a.ReadingMetric?.ToModel(),
                    Author = author
                };
            })
            .ToList();

        PerekArticlesCounters = response.Starter.PerekArticlesCounters.ToList();

        // Recurring Hebrew-date overrides (#3098): keyed by month*100+day so a
        // daily-perek view resolves its assigned article from cached data with
        // no network call. Null on caches written before the field existed.
        _hebrewDateOverrideArticleIds = (response.Starter.ArticleHebrewDateOverrides ?? [])
            .ToDictionary(o => o.HebrewMonth * 100 + o.HebrewDay, o => o.ArticleId);
    }

    /// <summary>month*100+day -> articleId assignments from the starter payload (#3098).</summary>
    private Dictionary<int, int> _hebrewDateOverrideArticleIds = new();

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
    /// Articles for the daily reading surface (#3098). When the viewed perek
    /// is the resolved daily perek of a Hebrew date carrying an assignment,
    /// that article alone replaces the ordinary per-perek list — even when
    /// its primary perek_id is unrelated. Two date contexts apply: today
    /// (always active — the daily surface stays overridden on any entry path)
    /// and the optional calendar-selected date the reader was opened for
    /// (YYYYMMDD). Everywhere else falls back to the unchanged per-perek list.
    /// </summary>
    public List<Article> GetDailyArticles(int perekId) => GetDailyArticles(perekId, null);

    /// <inheritdoc cref="GetDailyArticles(int)"/>
    public List<Article> GetDailyArticles(int perekId, int? selectedDateNum)
    {
        if (DailyOverrideArticleId(perekId, selectedDateNum) is int articleId)
        {
            return Articles.Where(a => a.Id == articleId).Take(1).ToList();
        }
        return GetArticlesByPerekId(perekId);
    }

    /// <summary>
    /// Article-count badge for the daily surface (#3098): 1 when a Hebrew-date
    /// override governs the viewed perek, otherwise the startup counter.
    /// </summary>
    public int GetDailyPerekArticlesCount(int perekId) =>
        GetDailyPerekArticlesCount(perekId, null);

    /// <inheritdoc cref="GetDailyPerekArticlesCount(int)"/>
    public int GetDailyPerekArticlesCount(int perekId, int? selectedDateNum) =>
        DailyOverrideArticleId(perekId, selectedDateNum) is not null
            ? 1
            : GetPerekArticlesCount(perekId);

    /// <summary>
    /// The assigned article for the viewed perek when it is the resolved
    /// daily perek of an assigned Hebrew date, else null.
    /// </summary>
    private int? DailyOverrideArticleId(int perekId, int? selectedDateNum)
    {
        if (!IsLoaded || !_scheduleService.IsLoaded)
        {
            return null;
        }
        // The calendar-selected context first — it is the explicit daily date
        // the reader was opened for; today stays an active context too so any
        // visit to today's daily perek keeps the override.
        foreach (var dateNum in ActiveDailyDateNums(selectedDateNum))
        {
            var (year, month, day) = HebrewDateHelper.NumberToHebrewDate(dateNum);
            if (_scheduleService.ResolveDay(year, month, day).PerekId != perekId)
            {
                continue;
            }
            if (_hebrewDateOverrideArticleIds.TryGetValue(month * 100 + day, out var articleId))
            {
                return articleId;
            }
        }
        return null;
    }

    private static IEnumerable<int> ActiveDailyDateNums(int? selectedDateNum)
    {
        if (selectedDateNum is int selected)
        {
            yield return selected;
        }
        var today = HebrewDateHelper.GetTodayDateNumber();
        if (today != selectedDateNum)
        {
            yield return today;
        }
    }

    /// <summary>
    /// Number of articles attached to a perek, read from the startup counters
    /// (index = perekId - 1). Returns 0 when starter data is not loaded yet or
    /// the id is out of range — callers treat that as "no badge".
    /// </summary>
    public int GetPerekArticlesCount(int perekId) =>
        IsLoaded && perekId >= 1 && perekId <= PerekArticlesCounters.Count
            ? PerekArticlesCounters[perekId - 1]
            : 0;

    /// <summary>
    /// Primary startup method.  Tries the API once, falls back to local cache,
    /// and if neither is available proceeds with empty data so the app can start.
    /// Never blocks indefinitely.
    /// </summary>
    public async Task LoadWithRetryAsync()
    {
        if (IsLoaded)
        {
            return;
        }

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
        #pragma warning disable S2221 // Deliberate failure boundary: starter API failure falls back to local cache
        catch (Exception ex) //NOSONAR — starter API failure falls back to local cache.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"API unavailable: {ex}");
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
        #pragma warning disable S2221 // Deliberate failure boundary: cache load failure proceeds offline without articles
        catch (Exception ex) //NOSONAR — cache load failure proceeds offline without articles.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Cache load failed: {ex}");
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
            {
                Console.WriteLine($"Refreshed {Authors.Count} authors from API");
            }
        }
        #pragma warning disable S2221 // Deliberate failure boundary: background refresh failure is log-only
        catch (Exception ex) //NOSONAR — background refresh failure is log-only.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Refresh failed: {ex}");
        }
    }

    #region Local cache

    private string CachePath =>
        Path.Join(_fileSystem.AppDataDirectory, CacheFileName);

    private async Task SaveCacheAsync(StarterResponse response)
    {
        try
        {
            var json = JsonSerializer.Serialize(response, StarterJsonContext.Default.StarterResponse);
            await AtomicFile.WriteAllTextAsync(CachePath, json);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: cache save is best-effort
        catch (Exception ex) //NOSONAR — cache save is best-effort.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Failed to save starter cache: {ex}");
        }
    }

    private async Task<bool> LoadFromCacheAsync()
    {
        if (!File.Exists(CachePath))
        {
            return false;
        }

        var json = await File.ReadAllTextAsync(CachePath);
        var response = JsonSerializer.Deserialize(json, StarterJsonContext.Default.StarterResponse);
        if (response?.Starter == null)
        {
            return false;
        }

        ApplyResponse(response);
        IsFromCache = true;
        IsLoaded = true;
        return true;
    }

    #endregion

    #region DTOs for GraphQL response

    // Records used for both GraphQL deserialization and local JSON cache.
    // Source-generated System.Text.Json metadata handles both: StarterJsonContext
    // for the local cache and GraphQLJsonContext for the GraphQL client.
    internal record StarterResponse(StarterData Starter);

    internal record StarterData(
        List<AuthorData> Authors,
        List<ArticleData> Articles,
        List<int> PerekArticlesCounters,
        List<ArticleHebrewDateOverrideData>? ArticleHebrewDateOverrides = null);

    /// <summary>One recurring Hebrew month/day -> article assignment (#3098), uniform month numbering (13/14 = Adar I/II).</summary>
    internal record ArticleHebrewDateOverrideData(
        int ArticleId,
        int HebrewMonth,
        int HebrewDay);

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
        int Priority,
        ReadingMetricData? ReadingMetric = null);

    /// <summary>Persisted reading metric as the API returns it (issue #2607); serialized into the local cache so offline starts keep the badge.</summary>
    internal record ReadingMetricData(
        int? WordCount,
        int? EstimatedSeconds,
        int WordsPerMinute,
        int CalcVersion,
        string? SourceHash)
    {
        public ReadingMetric ToModel() => new()
        {
            WordCount = WordCount,
            EstimatedSeconds = EstimatedSeconds,
            WordsPerMinute = WordsPerMinute,
            CalcVersion = CalcVersion,
            SourceHash = SourceHash ?? string.Empty
        };
    }

    #endregion
}

/// <summary>
/// System.Text.Json source generator for StarterService cache serialization.
/// Avoids reflection which is problematic with IL trimming in Release builds.
/// </summary>
[System.Text.Json.Serialization.JsonSerializable(typeof(StarterService.StarterResponse))]
internal partial class StarterJsonContext : System.Text.Json.Serialization.JsonSerializerContext { }
