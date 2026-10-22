using System.Text.Json.Serialization;
using BibleOnSite.Models;
using GraphQL;
using GraphQL.Client.Http;
using BibleOnSite.Config;

namespace BibleOnSite.Services;

/// <summary>
/// Service for fetching articles from the GraphQL API.
/// </summary>
public class ArticleService : BaseGraphQLService
{
    private static readonly Lazy<ArticleService> _instance = new(() => new ArticleService());

    /// <summary>
    /// Singleton instance of the ArticleService.
    /// </summary>
    public static ArticleService Instance => _instance.Value;

    private ArticleService() : base()
    {
    }

    public ArticleService(GraphQLHttpClient client) : base(client)
    {
    }

    /// <summary>
    /// Fetches all articles for a specific perek from the API.
    /// Readers use <see cref="StarterService.GetArticlesByPerekId"/> instead —
    /// the starter snapshot already holds every article, so swiping must not
    /// pay a network round-trip. This stays as the server-fresh path for
    /// callers that need data newer than the startup snapshot (e.g. content
    /// changed server-side after the app launched).
    /// </summary>
    public async Task<List<Article>> GetArticlesByPerekIdAsync(int perekId)
    {
        var query = new GraphQLRequest
        {
            Query = @"
                query ArticlesByPerekId($perekId: Int!) {
                    articlesByPerekId(perekId: $perekId) {
                        id
                        perekId
                        authorId
                        abstract
                        name
                        priority
                    }
                }",
            Variables = new Dictionary<string, object?> { ["perekId"] = perekId }
        };

        try
        {
            var response = await Client.SendQueryAsync<ArticlesByPerekIdResponse>(query);

            if (response.Errors != null && response.Errors.Length > 0)
            {
                Console.Error.WriteLine($"GraphQL errors fetching articles for perek {perekId}: {string.Join(", ", response.Errors.Select(e => e.Message))}");
                return new List<Article>();
            }

            var articles = response.Data?.ArticlesByPerekId ?? new List<ArticleDto>();

            // Use StarterService authors if available (may be empty offline — that's ok)
            return articles.Select(dto =>
            {
                var author = StarterService.Instance.Authors.FirstOrDefault(a => a.Id == dto.AuthorId);
                return new Article
                {
                    Id = dto.Id,
                    PerekId = dto.PerekId,
                    AuthorId = dto.AuthorId,
                    Abstract = dto.Abstract ?? string.Empty,
                    Name = dto.Name ?? string.Empty,
                    Priority = dto.Priority,
                    Author = author
                };
            }).OrderBy(a => a.Priority).ToList();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error fetching articles for perek {perekId}: {ex.Message}");
            return new List<Article>();
        }
    }

    /// <summary>
    /// Fetches a single article by its ID, including full content.
    /// </summary>
    public async Task<Article?> GetArticleByIdAsync(int articleId)
    {
        var query = new GraphQLRequest
        {
            Query = @"
                query ArticleById($id: Int!) {
                    articleById(id: $id) {
                        id
                        perekId
                        authorId
                        abstract
                        articleContent
                        name
                        priority
                    }
                }",
            Variables = new Dictionary<string, object?> { ["id"] = articleId }
        };

        try
        {
            var response = await Client.SendQueryAsync<ArticleByIdResponse>(query);

            if (response.Errors != null && response.Errors.Length > 0)
            {
                Console.Error.WriteLine($"GraphQL errors fetching article {articleId}: {string.Join(", ", response.Errors.Select(e => e.Message))}");
                return null;
            }

            var dto = response.Data?.ArticleById;
            if (dto == null)
            {
                return null;
            }

            // Use StarterService authors if available (may be empty offline — that's ok)
            var author = StarterService.Instance.Authors.FirstOrDefault(a => a.Id == dto.AuthorId);

            return new Article
            {
                Id = dto.Id,
                PerekId = dto.PerekId,
                AuthorId = dto.AuthorId,
                Abstract = dto.Abstract ?? string.Empty,
                ArticleContent = dto.ArticleContent,
                Name = dto.Name ?? string.Empty,
                Priority = dto.Priority,
                Author = author
            };
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error fetching article {articleId}: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Fetches all articles by a specific author.
    /// </summary>
    public async Task<List<Article>> GetArticlesByAuthorIdAsync(int authorId)
    {
        var query = new GraphQLRequest
        {
            Query = @"
                query ArticlesByAuthorId($authorId: Int!) {
                    articlesByAuthorId(authorId: $authorId) {
                        id
                        perekId
                        authorId
                        abstract
                        name
                        priority
                    }
                }",
            Variables = new Dictionary<string, object?> { ["authorId"] = authorId }
        };

        try
        {
            var response = await Client.SendQueryAsync<ArticlesByAuthorIdResponse>(query);

            if (response.Errors != null && response.Errors.Length > 0)
            {
                Console.Error.WriteLine($"GraphQL errors fetching articles for author {authorId}: {string.Join(", ", response.Errors.Select(e => e.Message))}");
                return new List<Article>();
            }

            var articles = response.Data?.ArticlesByAuthorId ?? new List<ArticleDto>();

            // Use StarterService authors if available (may be empty offline — that's ok)
            return articles.Select(dto =>
            {
                var author = StarterService.Instance.Authors.FirstOrDefault(a => a.Id == dto.AuthorId);
                return new Article
                {
                    Id = dto.Id,
                    PerekId = dto.PerekId,
                    AuthorId = dto.AuthorId,
                    Abstract = dto.Abstract ?? string.Empty,
                    Name = dto.Name ?? string.Empty,
                    Priority = dto.Priority,
                    Author = author
                };
            }).OrderBy(a => a.Priority).ToList();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error fetching articles for author {authorId}: {ex.Message}");
            return new List<Article>();
        }
    }

    /// <summary>
    /// Semantically searches article content on the server. Requires network
    /// access — failures propagate so callers can degrade gracefully.
    /// </summary>
    /// <param name="phrase">Raw user phrase; normalized server-side.</param>
    /// <param name="limit">Maximum hits (server clamps to 1-50).</param>
    public Task<ArticleSearchPage?> SearchArticlesAsync(string phrase, int limit) =>
        SearchArticlesAsync(phrase, limit, 0, null, null, CancellationToken.None);

    /// <param name="phrase">Raw user phrase; normalized server-side.</param>
    /// <param name="limit">Maximum hits (server clamps to 1-50).</param>
    /// <param name="cancellationToken">Caller cancellation.</param>
    public Task<ArticleSearchPage?> SearchArticlesAsync(string phrase, int limit, CancellationToken cancellationToken) =>
        SearchArticlesAsync(phrase, limit, 0, null, null, cancellationToken);

    /// <param name="phrase">Raw user phrase; normalized server-side.</param>
    /// <param name="limit">Maximum hits (server clamps to 1-50).</param>
    /// <param name="authorId">Restricts hits to this author's articles.</param>
    /// <param name="cancellationToken">Caller cancellation.</param>
    public Task<ArticleSearchPage?> SearchArticlesAsync(string phrase, int limit, int? authorId, CancellationToken cancellationToken) =>
        SearchArticlesAsync(phrase, limit, 0, authorId, null, cancellationToken);

    /// <param name="phrase">Raw user phrase; normalized server-side.</param>
    /// <param name="limit">Maximum hits (server clamps to 1-50).</param>
    /// <param name="timeout">Total request budget.</param>
    public Task<ArticleSearchPage?> SearchArticlesAsync(string phrase, int limit, TimeSpan timeout) =>
        SearchArticlesAsync(phrase, limit, 0, null, timeout, CancellationToken.None);

    /// <param name="phrase">Raw user phrase; normalized server-side.</param>
    /// <param name="limit">Maximum hits (server clamps to 1-50).</param>
    /// <param name="offset">Pagination offset (server clamps to 0-1000).</param>
    /// <param name="authorId">Restricts hits to this author's articles; the
    /// scope applies server-side before limit/offset so author matches are
    /// never dropped by a globally ranked page.</param>
    /// <param name="timeout">Total request budget.</param>
    /// <param name="cancellationToken">Caller cancellation.</param>
    public async Task<ArticleSearchPage?> SearchArticlesAsync(
        string phrase,
        int limit,
        int offset,
        int? authorId,
        TimeSpan? timeout,
        CancellationToken cancellationToken)
    {
        var query = new GraphQLRequest
        {
            Query = @"
                query SearchArticles($phrase: String!, $limit: Int, $offset: Int, $authorId: Int) {
                    searchArticles(phrase: $phrase, limit: $limit, offset: $offset, authorId: $authorId) {
                        total
                        hits {
                            articleId
                            name
                            authorName
                            authorId
                            perekId
                            source
                            excerpt
                            score
                        }
                    }
                }",
            Variables = new Dictionary<string, object?> { ["phrase"] = phrase, ["limit"] = limit, ["offset"] = offset, ["authorId"] = authorId }
        };

        using var timeoutSource = new CancellationTokenSource(timeout ?? DefaultSearchTimeout);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutSource.Token);
        try
        {
            var response = await Client.SendQueryAsync<SearchArticlesResponse>(query, linked.Token);

            if (response.Errors != null && response.Errors.Length > 0)
            {
                Console.Error.WriteLine($"GraphQL errors searching articles: {string.Join(", ", response.Errors.Select(e => e.Message))}");
                throw new GraphQLException(string.Join(", ", response.Errors.Select(e => e.Message)));
            }

            var data = response.Data?.SearchArticles;
            if (data == null)
            {
                return null;
            }

            return new ArticleSearchPage
            {
                Total = data.Total,
                Hits = (data.Hits ?? new List<ArticleSearchHitDto>()).Select(dto => new ArticleSearchHit
                {
                    ArticleId = dto.ArticleId,
                    PerekId = dto.PerekId,
                    AuthorId = dto.AuthorId,
                    AuthorName = dto.AuthorName ?? string.Empty,
                    Name = dto.Name ?? string.Empty,
                    Source = dto.Source ?? string.Empty,
                    Excerpt = dto.Excerpt ?? string.Empty,
                    Score = dto.Score
                }).ToList()
            };
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // Timeout source fired — translate to a TimeoutException so callers
            // can distinguish "no network answer" from user cancellation.
            throw new TimeoutException("Article search timed out");
        }
        catch (Exception ex) when (ex is not GraphQLException and not OperationCanceledException)
        {
            Console.Error.WriteLine($"Error searching articles: {ex.Message}");
            throw;
        }
    }

    private static readonly TimeSpan DefaultSearchTimeout = TimeSpan.FromSeconds(8);

    /// <summary>One remote article-search hit.</summary>
    public class ArticleSearchHit
    {
        public int ArticleId { get; set; }
        public int PerekId { get; set; }
        public int AuthorId { get; set; }
        public string AuthorName { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string Source { get; set; } = string.Empty;
        public string Excerpt { get; set; } = string.Empty;
        public float Score { get; set; }
    }

    /// <summary>Paginated remote search result.</summary>
    public class ArticleSearchPage
    {
        public int Total { get; set; }
        public List<ArticleSearchHit> Hits { get; set; } = new();
    }

    #region DTOs for GraphQL responses

    internal class SearchArticlesResponse
    {
        public SearchArticlesData? SearchArticles { get; set; }
    }

    internal class SearchArticlesData
    {
        public int Total { get; set; }
        public List<ArticleSearchHitDto>? Hits { get; set; }
    }

    internal class ArticleSearchHitDto
    {
        public int ArticleId { get; set; }
        public string? Name { get; set; }
        public string? AuthorName { get; set; }
        public int AuthorId { get; set; }
        public int PerekId { get; set; }
        public string? Source { get; set; }
        public string? Excerpt { get; set; }
        public float Score { get; set; }
    }

    internal class ArticlesByPerekIdResponse
    {
        public List<ArticleDto>? ArticlesByPerekId { get; set; }
    }

    internal class ArticlesByAuthorIdResponse
    {
        public List<ArticleDto>? ArticlesByAuthorId { get; set; }
    }

    internal class ArticleByIdResponse
    {
        public ArticleDto? ArticleById { get; set; }
    }

    internal class ArticleDto
    {
        public int Id { get; set; }
        public int PerekId { get; set; }
        public int AuthorId { get; set; }
        public string? Abstract { get; set; }

        // Explicit name keeps the GraphQL field mapping visible; GraphQLJsonContext
        // references the property statically so the trimmer keeps it (#1142).
        [JsonPropertyName("articleContent")]
        public string? ArticleContent { get; set; }

        public string? Name { get; set; }
        public int Priority { get; set; }
    }

    #endregion
}
