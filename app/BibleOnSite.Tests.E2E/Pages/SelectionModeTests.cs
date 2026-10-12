using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>
/// E2E tests for pasuk selection mode functionality.
/// Tests selection bar UI, copy/share buttons, selection count.
/// Note: FlaUI can find elements inside selection bar but not the Grid itself.
/// </summary>
[Collection(nameof(AppCollection))]
public class SelectionModeTests
{
    private readonly AppFixture _fixture;

    public SelectionModeTests(AppFixture fixture)
    {
        _fixture = fixture;
    }

    /// <summary>
    /// Helper to wait for pasukim to be loaded.
    /// </summary>
    private async Task WaitForPasukimLoadedAsync()
    {
        _fixture.MainWindow.Focus();
        var timeout = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < timeout)
        {
            var pasukElements = GetPasukElements();
            if (pasukElements?.Length > 0)
            {
                return;
            }
            await Task.Delay(200, TestContext.Current.CancellationToken);
        }
        throw new TimeoutException("Pasukim did not load within 10 seconds");
    }

    /// <summary>
    /// Helper to get all pasuk elements.
    /// </summary>
    private AutomationElement[] GetPasukElements()
    {
        var viewport = _fixture.MainWindow.BoundingRectangle;
        return _fixture.MainWindow.FindAllDescendants(_fixture.CF.ByAutomationId("PasukText"))
            .Where(p => !p.IsOffscreen && p.BoundingRectangle.Width > 0 && p.BoundingRectangle.Height > 0 &&
                p.BoundingRectangle.IntersectsWith(viewport)).ToArray();
    }

    /// <summary>
    /// Helper to exit selection mode by clicking back button.
    /// </summary>
    private async Task ExitSelectionModeAsync()
    {
        var backButton = _fixture.FindByAutomationId("SelectionBackButton");
        if (backButton != null)
        {
            backButton.AsButton()?.Invoke();
            await Task.Delay(300, TestContext.Current.CancellationToken);
        }
    }

    /// <summary>
    /// Helper to enter selection mode via right-click and verify it worked.
    /// </summary>
    private async Task<bool> EnterSelectionModeAsync(AutomationElement[] pasukElements)
    {
        _fixture.MainWindow.Focus();
        _fixture.Click(pasukElements[0], MouseButton.Right);
        await Task.Delay(800, TestContext.Current.CancellationToken);

        // Verify selection mode is active by checking for count label
        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        return countLabel != null;
    }

    [Fact]
    public async Task DoubleTap_ShowsOnlyFocusedPasuk_AndBackRestoresChapter()
    {
        await ExitSelectionModeAsync();
        await WaitForPasukimLoadedAsync();
        var pasuk = GetPasukElements()[0];
        var original = pasuk.Name;
        _fixture.Click(pasuk, doubleClick: true);
        await Task.Delay(700, TestContext.Current.CancellationToken);
        var focused = _fixture.FindByAutomationId("FocusedPasukText");
        focused.Should().NotBeNull();
        focused!.Name.Should().Be(original);
        _fixture.FindByAutomationId("SelectionCountLabel").Should().BeNull();
        _fixture.FindByAutomationId("SelectionCopyButton").Should().BeNull();
        _fixture.FindByAutomationId("SelectionShareButton").Should().BeNull();
        await ExitSelectionModeAsync();
        _fixture.FindByAutomationId("FocusedPasukText").Should().BeNull();
        GetPasukElements().Should().NotBeEmpty();
    }

    [Fact]
    public async Task SelectionMode_ShowsSelectionCount()
    {
        // Arrange
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300, TestContext.Current.CancellationToken);

        var pasukElements = GetPasukElements();
        pasukElements.Should().HaveCountGreaterThan(1, "need at least 2 pasukim for this test");

        // Act - Right-click to select first pasuk
        var entered = await EnterSelectionModeAsync(pasukElements);
        entered.Should().BeTrue("should enter selection mode");

        // Assert - Count should be 1
        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel.Should().NotBeNull("selection count label should exist");
        countLabel!.Name.Should().Be("1", "count should be 1 after selecting one pasuk");

        // Act - Click to select second pasuk
        _fixture.Click(pasukElements[1]);
        await Task.Delay(500, TestContext.Current.CancellationToken);

        // Assert - Count should be 2
        countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel!.Name.Should().Be("2", "count should be 2 after selecting another pasuk");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task SelectionMode_ClickSelectedPasuk_DeselectsIt()
    {
        // Arrange
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300, TestContext.Current.CancellationToken);

        var pasukElements = GetPasukElements();

        // Act - Right-click to select first pasuk
        var entered = await EnterSelectionModeAsync(pasukElements);
        entered.Should().BeTrue("should enter selection mode");

        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel!.Name.Should().Be("1");

        // Act - Click first pasuk again to deselect
        _fixture.Click(pasukElements[0]);
        await Task.Delay(500, TestContext.Current.CancellationToken);

        // Assert - Count label should no longer be visible (selection mode exited)
        countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        // Either null or offscreen
        if (countLabel != null)
        {
            countLabel.Properties.IsOffscreen.ValueOrDefault.Should().BeTrue(
                "selection bar should be hidden when no pasukim selected");
        }
    }

    [Fact]
    public async Task SelectionMode_BackButton_ExitsSelectionMode()
    {
        // Arrange
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300, TestContext.Current.CancellationToken);

        var pasukElements = GetPasukElements();

        // Act - Right-click to enter selection mode
        var entered = await EnterSelectionModeAsync(pasukElements);
        entered.Should().BeTrue("should enter selection mode");

        // Verify we're in selection mode
        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel.Should().NotBeNull();

        // Act - Click back button
        var backButton = _fixture.FindByAutomationId("SelectionBackButton");
        backButton.Should().NotBeNull("back button should exist in selection bar");
        backButton!.AsButton()?.Invoke();
        await Task.Delay(500, TestContext.Current.CancellationToken);

        // Assert - Count label should no longer be visible
        countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        if (countLabel != null)
        {
            countLabel.Properties.IsOffscreen.ValueOrDefault.Should().BeTrue(
                "selection bar should be hidden after clicking back");
        }
    }

    [Fact]
    public async Task SelectionMode_CopyButton_Exists()
    {
        // Arrange
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300, TestContext.Current.CancellationToken);

        var pasukElements = GetPasukElements();

        // Act - Right-click to enter selection mode
        var entered = await EnterSelectionModeAsync(pasukElements);
        entered.Should().BeTrue("should enter selection mode");

        // Assert - Copy button should exist
        var copyButton = _fixture.FindByAutomationId("SelectionCopyButton");
        copyButton.Should().NotBeNull("copy button should exist in selection bar");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task SelectionMode_ShareButton_Exists()
    {
        // Arrange
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300, TestContext.Current.CancellationToken);

        var pasukElements = GetPasukElements();

        // Act - Right-click to enter selection mode
        var entered = await EnterSelectionModeAsync(pasukElements);
        entered.Should().BeTrue("should enter selection mode");

        // Assert - Share button should exist
        var shareButton = _fixture.FindByAutomationId("SelectionShareButton");
        shareButton.Should().NotBeNull("share button should exist in selection bar");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task SelectionMode_MultipleSelections_CountIsCorrect()
    {
        // Arrange
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300, TestContext.Current.CancellationToken);

        var pasukElements = GetPasukElements();
        pasukElements.Should().HaveCountGreaterThan(2, "need at least 3 pasukim for this test");

        // Act - Select pasukim in order 1, 3, 2
        var entered = await EnterSelectionModeAsync(pasukElements);
        entered.Should().BeTrue("should enter selection mode");

        _fixture.Click(pasukElements[2]);
        await Task.Delay(500, TestContext.Current.CancellationToken);
        _fixture.Click(pasukElements[1]);
        await Task.Delay(500, TestContext.Current.CancellationToken);

        // Assert - Count should be 3
        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel!.Name.Should().Be("3", "count should be 3 after selecting three pasukim");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task QuickTap_OnPasuk_DoesNotEnterSelectionMode()
    {
        // Arrange
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(500, TestContext.Current.CancellationToken);

        var pasukElements = GetPasukElements();

        // Act - Quick tap (short click)
        _fixture.Click(pasukElements[0]);
        await Task.Delay(500, TestContext.Current.CancellationToken);

        // Assert - Selection count label should NOT appear
        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        if (countLabel != null)
        {
            countLabel.Properties.IsOffscreen.ValueOrDefault.Should().BeTrue(
                "selection bar should not appear on quick tap outside selection mode");
        }
    }
}
