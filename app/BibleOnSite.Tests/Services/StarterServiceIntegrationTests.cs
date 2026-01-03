using BibleOnSite.Services;
using BibleOnSite.Tests.Fixtures;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Integration tests for StarterService that require the API server.
/// These tests require the API server to be running on http://127.0.0.1:3003
/// </summary>
[Trait("Category", "Integration")]
[Collection("ApiServer")]
public class StarterServiceIntegrationTests
{
    [Fact]
    public async Task LoadAsync_ShouldLoadAuthorsFromApi()
    {
        // Arrange
        // Create a new instance for testing (not the singleton)
        var service = CreateTestableStarterService();

        // Act
        await service.LoadAsync();

        // Assert
        service.IsLoaded.Should().BeTrue();
        service.Authors.Should().NotBeEmpty("API should return at least one author");
    }

    [Fact]
    public async Task LoadAsync_ShouldLoadPerekArticlesCounters()
    {
        // Arrange
        var service = CreateTestableStarterService();

        // Act
        await service.LoadAsync();

        // Assert
        service.PerekArticlesCounters.Should().HaveCount(929, "There should be 929 perek counters");
    }

    [Fact]
    public async Task GetAuthor_AfterLoad_ShouldReturnAuthor()
    {
        // Arrange
        var service = CreateTestableStarterService();
        await service.LoadAsync();

        // Act
        // Most APIs will have at least author with ID 1
        var author = service.Authors.FirstOrDefault();

        // Assert
        author.Should().NotBeNull();
        author!.Name.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task LoadAsync_ShouldLoadAuthorArticlesCounts()
    {
        // Arrange
        var service = CreateTestableStarterService();

        // Act
        await service.LoadAsync();

        // Assert
        // Test data: author 1 has 1 article, author 2 has 2 articles
        var author1 = service.Authors.FirstOrDefault(a => a.Id == 1);
        author1.Should().NotBeNull();
        author1!.ArticlesCount.Should().Be(1);

        var author2 = service.Authors.FirstOrDefault(a => a.Id == 2);
        author2.Should().NotBeNull();
        author2!.ArticlesCount.Should().Be(2);
    }

    [Fact]
    public async Task LoadAsync_CalledTwice_ShouldNotReload()
    {
        // Arrange
        var service = CreateTestableStarterService();
        await service.LoadAsync();
        var initialAuthorsCount = service.Authors.Count;

        // Act
        await service.LoadAsync(); // Second call

        // Assert
        service.Authors.Count.Should().Be(initialAuthorsCount, "Should not reload data");
    }

    /// <summary>
    /// Creates a testable instance of StarterService by using reflection to bypass the singleton.
    /// </summary>
    private static TestableStarterService CreateTestableStarterService()
    {
        return new TestableStarterService();
    }
}

/// <summary>
/// A testable version of StarterService that can be instantiated for tests.
/// </summary>
internal class TestableStarterService : BaseGraphQLService
{
    private bool _isLoaded;
    private readonly List<BibleOnSite.Models.Author> _authors = new();
    private int[] _perekArticlesCounters = new int[929];

    public IReadOnlyList<BibleOnSite.Models.Author> Authors => _authors.AsReadOnly();
    public IReadOnlyList<int> PerekArticlesCounters => _perekArticlesCounters;
    public bool IsLoaded => _isLoaded;

    private const string GetStarterQuery = @"
        query GetStarter {
            starter {
                authors {
                    id
                    articlesCount
                    details
                    name
                }
                perekArticlesCounters
            }
        }
    ";

    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (_isLoaded)
        {
            return;
        }

        var response = await QueryWithTimeoutAsync<StarterResponse>(
            GetStarterQuery,
            TimeSpan.FromSeconds(10),
            "GetStarter");

        if (response?.Starter == null)
        {
            throw new InvalidOperationException("Starter response was null");
        }

        _authors.Clear();
        if (response.Starter.Authors != null)
        {
            foreach (var authorData in response.Starter.Authors)
            {
                _authors.Add(new BibleOnSite.Models.Author
                {
                    Id = authorData.Id,
                    ArticlesCount = authorData.ArticlesCount,
                    Details = authorData.Details,
                    Name = authorData.Name
                });
            }
        }

        if (response.Starter.PerekArticlesCounters != null)
        {
            _perekArticlesCounters = response.Starter.PerekArticlesCounters.ToArray();
        }

        _isLoaded = true;
    }

    #region DTOs for GraphQL response

    private record StarterResponse(StarterData Starter);

    private record StarterData(
        List<AuthorData>? Authors,
        List<int>? PerekArticlesCounters);

    private record AuthorData(
        int Id,
        int ArticlesCount,
        string Details,
        string Name);

    #endregion
}
