using BibleOnSite.Services;
using BibleOnSite.Tests.Fixtures;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Tests verifying that StarterService is loaded on app startup.
/// These tests ensure the LoadingPage behavior works as expected.
/// </summary>
[Trait("Category", "Integration")]
[Collection("ApiServer")]
public class StarterLoadOnStartupTests
{
    /// <summary>
    /// Verifies that LoadWithRetryAsync successfully loads starter data.
    /// This is the method called by LoadingPage on app startup.
    /// </summary>
    [Fact]
    public async Task LoadWithRetryAsync_ShouldLoadStarterData()
    {
        // Arrange
        var service = CreateTestableStarterService();

        // Act - this is what LoadingPage calls on startup
        await service.LoadWithRetryAsync();

        // Assert
        service.IsLoaded.Should().BeTrue("Starter should be marked as loaded after LoadWithRetryAsync");
        service.Authors.Should().NotBeEmpty("Authors should be loaded from API");
        service.Articles.Should().NotBeEmpty("Articles should be loaded from API");
        service.PerekArticlesCounters.Should().HaveCount(929, "All 929 perek counters should be loaded");
    }

    /// <summary>
    /// Verifies that once starter is loaded, subsequent pages can access the data immediately.
    /// This simulates the flow: LoadingPage loads data -> AuthorsPage uses cached data.
    /// </summary>
    [Fact]
    public async Task AfterStarterLoaded_AuthorsAreImmediatelyAvailable()
    {
        // Arrange - simulate LoadingPage loading the starter
        var service = CreateTestableStarterService();
        await service.LoadWithRetryAsync();

        // Act - simulate AuthorsPage accessing the data (no additional load needed)
        var authors = service.Authors;
        var isLoaded = service.IsLoaded;

        // Assert
        isLoaded.Should().BeTrue("Starter should already be loaded");
        authors.Should().NotBeEmpty("Authors should be immediately available");
        authors.All(a => !string.IsNullOrEmpty(a.Name)).Should().BeTrue("All authors should have names");
    }

    /// <summary>
    /// Verifies that articles can be retrieved by author ID after starter is loaded.
    /// </summary>
    [Fact]
    public async Task AfterStarterLoaded_CanGetArticlesByAuthorId()
    {
        // Arrange
        var service = CreateTestableStarterService();
        await service.LoadWithRetryAsync();

        // Act
        var firstAuthor = service.Authors.First();
        var articles = service.GetArticlesByAuthorId(firstAuthor.Id);

        // Assert
        articles.Should().NotBeNull("GetArticlesByAuthorId should return a list");
        // Note: Not all authors may have articles in test data
    }

    /// <summary>
    /// Verifies that articles can be retrieved by perek ID after starter is loaded.
    /// </summary>
    [Fact]
    public async Task AfterStarterLoaded_CanGetArticlesByPerekId()
    {
        // Arrange
        var service = CreateTestableStarterService();
        await service.LoadWithRetryAsync();

        // Act - Perek 1 should have articles in test data
        var articles = service.GetArticlesByPerekId(1);

        // Assert
        articles.Should().NotBeNull("GetArticlesByPerekId should return a list");
    }

    /// <summary>
    /// Helper to create a testable StarterService instance (not the singleton).
    /// Uses reflection to create a new instance for isolated testing.
    /// </summary>
    private static StarterService CreateTestableStarterService()
    {
        var type = typeof(StarterService);
        var constructor = type.GetConstructor(
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic,
            null,
            Type.EmptyTypes,
            null);

        if (constructor == null)
            throw new InvalidOperationException("Could not find private constructor for StarterService");

        return (StarterService)constructor.Invoke(null);
    }
}
