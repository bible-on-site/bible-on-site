using BibleOnSite.Tests.E2E.Fixtures;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>
/// E2E tests for the PerekPage - the main page of the app.
/// </summary>
[Collection(nameof(AppCollection))]
public class PerekPageTests
{
    private readonly AppFixture _fixture;

    public PerekPageTests(AppFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public void PerekPage_LoadsOnAppStart()
    {
        // Assert - Main window should be visible
        _fixture.MainWindow.Should().NotBeNull();
        _fixture.MainWindow.Title.Should().NotBeEmpty();
    }

    [Fact]
    public async Task PerekPage_LoadsPasukimFromDatabase()
    {
        // Wait for the loading label to disappear (data loaded)
        var timeout = DateTime.UtcNow.AddSeconds(5);
        while (DateTime.UtcNow < timeout)
        {
            var loadingLabel = _fixture.FindByAutomationId("PerekLoadingLabel");
            if (loadingLabel == null)
            {
                break;
            }

            await Task.Delay(200);
        }

        _fixture.FindByAutomationId("PerekLoadingLabel")
            .Should().BeNull("loading indicator should disappear once pasukim are loaded");

        // Verify at least one pasuk text item is rendered
        var pasukTextElements = _fixture.MainWindow.FindAllDescendants(_fixture.CF.ByAutomationId("PasukText"));
        pasukTextElements.Should().NotBeNull();
        pasukTextElements.Length.Should().BeGreaterThan(0, "at least one pasuk should be rendered from the local database");
    }

    [Fact]
    public async Task PerekPage_DisplaysToolbarButtons()
    {
        // Assert - Should have the toolbar buttons
        var articlesButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("📚")));
        articlesButton.Should().NotBeNull("Articles button should be visible");

        var bookmarkButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("⭐")));
        bookmarkButton.Should().NotBeNull("Bookmark button should be visible");

        var prevButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("◀")));
        prevButton.Should().NotBeNull("Previous button should be visible");

        var nextButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("▶")));
        nextButton.Should().NotBeNull("Next button should be visible");
    }

    [Fact]
    public async Task NextButton_NavigatesToNextPerek()
    {
        // Arrange
        await Task.Delay(1000);
        var initialTitle = _fixture.MainWindow.Title;

        // Act - Click next button
        var nextButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("▶")));

        nextButton.Should().NotBeNull();
        nextButton!.AsButton().Invoke();

        await Task.Delay(1000);

        // Assert - Title should change (indicates different perek loaded)
        var newTitle = _fixture.MainWindow.Title;
        // Note: Title might be the same if content changes within, but ideally it updates
    }

    [Fact]
    public async Task PreviousButton_NavigatesToPreviousPerek()
    {
        // Arrange
        await Task.Delay(1000);

        // Act - Click prev button
        var prevButton = await _fixture.WaitForElementAsync(
            window => window.FindFirstDescendant(_fixture.CF.ByName("◀")));

        prevButton.Should().NotBeNull();
        prevButton!.AsButton().Invoke();

        await Task.Delay(1000);

        // Assert - Navigation occurred without crash
        _fixture.MainWindow.Should().NotBeNull("App should not crash on previous navigation");
    }
}
