using BibleOnSite.Models;
using GraphQL;
using GraphQL.Client.Http;
using GraphQL.Client.Serializer.Newtonsoft;
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

    /// <summary>
    /// Fetches all articles for a specific perek.
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
            Variables = new { perekId }
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

            return articles.Select(dto => new Article
            {
                Id = dto.Id,
                PerekId = dto.PerekId,
                AuthorId = dto.AuthorId,
                Abstract = dto.Abstract ?? string.Empty,
                Name = dto.Name ?? string.Empty,
                Priority = dto.Priority
            }).OrderBy(a => a.Priority).ToList();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error fetching articles for perek {perekId}: {ex.Message}");
            return new List<Article>();
        }
    }

    /// <summary>
    /// Fetches a single article by its ID.
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
                        name
                        priority
                    }
                }",
            Variables = new { id = articleId }
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
                return null;

            return new Article
            {
                Id = dto.Id,
                PerekId = dto.PerekId,
                AuthorId = dto.AuthorId,
                Abstract = dto.Abstract ?? string.Empty,
                Name = dto.Name ?? string.Empty,
                Priority = dto.Priority
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
            Variables = new { authorId }
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

            return articles.Select(dto => new Article
            {
                Id = dto.Id,
                PerekId = dto.PerekId,
                AuthorId = dto.AuthorId,
                Abstract = dto.Abstract ?? string.Empty,
                Name = dto.Name ?? string.Empty,
                Priority = dto.Priority
            }).OrderBy(a => a.Priority).ToList();
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Error fetching articles for author {authorId}: {ex.Message}");
            return new List<Article>();
        }
    }

    #region DTOs for GraphQL responses

    private class ArticlesByPerekIdResponse
    {
        public List<ArticleDto>? ArticlesByPerekId { get; set; }
    }

    private class ArticlesByAuthorIdResponse
    {
        public List<ArticleDto>? ArticlesByAuthorId { get; set; }
    }

    private class ArticleByIdResponse
    {
        public ArticleDto? ArticleById { get; set; }
    }

    private class ArticleDto
    {
        public int Id { get; set; }
        public int PerekId { get; set; }
        public int AuthorId { get; set; }
        public string? Abstract { get; set; }
        public string? Name { get; set; }
        public int Priority { get; set; }
    }

    #endregion
}
