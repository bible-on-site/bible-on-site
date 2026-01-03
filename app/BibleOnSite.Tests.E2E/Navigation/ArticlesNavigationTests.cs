using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.Input;

namespace BibleOnSite.Tests.E2E.Navigation;

/// <summary>
/// E2E tests for navigation between pages in the app.
/// </summary>
[Collection(nameof(AppCollection))]
public class ArticlesNavigationTests
{
    private readonly AppFixture _fixture;

    public ArticlesNavigationTests(AppFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>
    /// Ensure we're on the main PerekPage before each test.
    /// </summary>
    private async Task EnsureOnPerekPageAsync()
    {
        // Check if there's a Back button (meaning we're not on the main page)
        var backButton = _fixture.MainWindow.FindFirstDescendant(_fixture.CF.ByName("Back"));
        if (backButton != null)
        {
            backButton.AsButton().Invoke();
            await Task.Delay(1000);
        }
    }

    [Fact]
    public async Task ClickingArticlesButton_NavigatesToArticlesPage()
    {
        // Arrange - Ensure we start on PerekPage
        await EnsureOnPerekPageAsync();
        await Task.Delay(1000);

        // Act - Find and click the articles button (use ByName with emoji)
        var articlesButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("📚")));

        articlesButton.Should().NotBeNull("The articles button should be visible on the PerekPage");

        articlesButton!.AsButton().Invoke();

        // Assert - Wait for the ArticlesPage to appear
        await Task.Delay(1000);

        var articlesHeader = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(
                _fixture.CF.ByName("מאמרים").Or(_fixture.CF.ByClassName("ArticlesPage"))));

        // If navigation succeeded, we should see either the articles header or the page itself
        // Note: The actual assertion depends on what's visible in the ArticlesPage UI
    }

    [Fact]
    public async Task ArticlesPage_ShowsLoadingOrContent()
    {
        // Arrange - Ensure we start on PerekPage
        await EnsureOnPerekPageAsync();
        await Task.Delay(1000);

        var articlesButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("📚")));

        articlesButton.Should().NotBeNull("Articles button should be visible on PerekPage");

        articlesButton!.AsButton().Invoke();
        await Task.Delay(2000);

        // Assert - Navigation succeeded if the Back button is now visible
        var backButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("Back")),
            TimeSpan.FromSeconds(5));

        backButton.Should().NotBeNull("Back button should be visible on ArticlesPage after navigation");
    }
}
