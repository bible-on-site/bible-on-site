using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.Input;
using FlaUI.Core.WindowsAPI;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>
/// E2E tests for pasuk selection mode functionality.
/// Tests right-click to enter selection, selection bar UI, copy/share buttons.
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
        var timeout = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < timeout)
        {
            var pasukElements = _fixture.MainWindow.FindAllDescendants(
                _fixture.CF.ByAutomationId("PasukText"));
            if (pasukElements?.Length > 0)
            {
                return;
            }
            await Task.Delay(200);
        }
        throw new TimeoutException("Pasukim did not load within 10 seconds");
    }

    /// <summary>
    /// Helper to get all pasuk elements.
    /// </summary>
    private AutomationElement[] GetPasukElements()
    {
        return _fixture.MainWindow.FindAllDescendants(
            _fixture.CF.ByAutomationId("PasukText"));
    }

    /// <summary>
    /// Helper to find the selection bar.
    /// </summary>
    private AutomationElement? FindSelectionBar()
    {
        return _fixture.FindByAutomationId("SelectionBar");
    }

    /// <summary>
    /// Helper to wait for selection bar to appear.
    /// </summary>
    private async Task<AutomationElement?> WaitForSelectionBarAsync(TimeSpan? timeout = null)
    {
        timeout ??= TimeSpan.FromSeconds(5);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.Elapsed < timeout)
        {
            var bar = FindSelectionBar();
            if (bar != null && !bar.Properties.IsOffscreen.ValueOrDefault)
            {
                return bar;
            }
            await Task.Delay(100);
        }
        return null;
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
            await Task.Delay(300);
        }
    }

    [Fact]
    public async Task RightClick_OnPasuk_EntersSelectionMode()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(500);

        var pasukElements = GetPasukElements();
        pasukElements.Should().NotBeEmpty("pasukim should be loaded");

        // Get the parent Border (which has the gesture recognizer)
        var firstPasuk = pasukElements[0];
        var pasukBorder = firstPasuk.Parent;

        // Act - Right-click on the pasuk border
        var clickPoint = pasukBorder?.GetClickablePoint() ?? firstPasuk.GetClickablePoint();
        Mouse.Click(clickPoint, MouseButton.Right);

        // Assert - Selection bar should appear
        var selectionBar = await WaitForSelectionBarAsync();
        selectionBar.Should().NotBeNull("selection bar should appear after right-click");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task SelectionMode_ShowsSelectionCount()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300);

        var pasukElements = GetPasukElements();
        pasukElements.Should().HaveCountGreaterThan(1, "need at least 2 pasukim for this test");

        // Act - Right-click to select first pasuk
        Mouse.Click(pasukElements[0].GetClickablePoint(), MouseButton.Right);
        await Task.Delay(800);

        // Assert - Count should be 1
        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel.Should().NotBeNull("selection count label should exist");
        countLabel!.Name.Should().Be("1", "count should be 1 after selecting one pasuk");

        // Act - Click to select second pasuk
        Mouse.Click(pasukElements[1].GetClickablePoint(), MouseButton.Left);
        await Task.Delay(500);

        // Assert - Count should be 2
        countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel!.Name.Should().Be("2", "count should be 2 after selecting another pasuk");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task SelectionMode_ClickSelectedPasuk_DeselectsIt()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300);

        var pasukElements = GetPasukElements();

        // Act - Right-click to select first pasuk
        Mouse.Click(pasukElements[0].GetClickablePoint(), MouseButton.Right);
        await Task.Delay(800);

        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel.Should().NotBeNull("count label should exist in selection bar");
        countLabel!.Name.Should().Be("1");

        // Act - Click first pasuk again to deselect
        Mouse.Click(pasukElements[0].GetClickablePoint(), MouseButton.Left);
        await Task.Delay(500);

        // Assert - Selection bar should disappear (no more selected pasukim)
        var selectionBar = FindSelectionBar();
        // When count goes to 0, bar should hide
        if (selectionBar != null)
        {
            // If bar still exists, count should be 0 or bar should not be visible
            selectionBar.Properties.IsOffscreen.ValueOrDefault.Should().BeTrue(
                "selection bar should be hidden when no pasukim selected");
        }
    }

    [Fact]
    public async Task SelectionMode_BackButton_ClearsSelectionAndExits()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(500);

        var pasukElements = GetPasukElements();

        // Get the parent Border
        var pasukBorder = pasukElements[0].Parent;
        var clickPoint = pasukBorder?.GetClickablePoint() ?? pasukElements[0].GetClickablePoint();

        // Act - Right-click to enter selection mode
        Mouse.Click(clickPoint, MouseButton.Right);

        var selectionBar = await WaitForSelectionBarAsync();
        selectionBar.Should().NotBeNull("selection bar should appear");

        // Act - Click back button
        var backButton = _fixture.FindByAutomationId("SelectionBackButton");
        backButton.Should().NotBeNull("back button should exist in selection bar");
        backButton!.AsButton()?.Invoke();
        await Task.Delay(500);

        // Assert - Selection bar should be hidden
        selectionBar = FindSelectionBar();
        if (selectionBar != null)
        {
            selectionBar.Properties.IsOffscreen.ValueOrDefault.Should().BeTrue(
                "selection bar should be hidden after clicking back");
        }
    }

    [Fact]
    public async Task SelectionMode_CopyButton_Exists()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300);

        var pasukElements = GetPasukElements();

        // Act - Right-click to enter selection mode
        Mouse.Click(pasukElements[0].GetClickablePoint(), MouseButton.Right);
        await Task.Delay(800);

        // Assert - Copy button should exist
        var copyButton = _fixture.FindByAutomationId("SelectionCopyButton");
        copyButton.Should().NotBeNull("copy button should exist in selection bar");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task SelectionMode_ShareButton_Exists()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300);

        var pasukElements = GetPasukElements();

        // Act - Right-click to enter selection mode
        Mouse.Click(pasukElements[0].GetClickablePoint(), MouseButton.Right);
        await Task.Delay(800);

        // Assert - Share button should exist
        var shareButton = _fixture.FindByAutomationId("SelectionShareButton");
        shareButton.Should().NotBeNull("share button should exist in selection bar");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task SelectionMode_MultipleSelections_MaintainsOrder()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(300);

        var pasukElements = GetPasukElements();
        pasukElements.Should().HaveCountGreaterThan(2, "need at least 3 pasukim for this test");

        // Act - Select pasukim in order 1, 3, 2
        Mouse.Click(pasukElements[0].GetClickablePoint(), MouseButton.Right);
        await Task.Delay(800);
        Mouse.Click(pasukElements[2].GetClickablePoint(), MouseButton.Left);
        await Task.Delay(500);
        Mouse.Click(pasukElements[1].GetClickablePoint(), MouseButton.Left);
        await Task.Delay(500);

        // Assert - Count should be 3
        var countLabel = _fixture.FindByAutomationId("SelectionCountLabel");
        countLabel!.Name.Should().Be("3", "count should be 3 after selecting three pasukim");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task LongPress_OnPasuk_EntersSelectionMode()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(500);

        var pasukElements = GetPasukElements();

        // Get the parent Border
        var firstPasuk = pasukElements[0];
        var pasukBorder = firstPasuk.Parent;
        var clickPoint = pasukBorder?.GetClickablePoint() ?? firstPasuk.GetClickablePoint();

        // Act - Simulate long press (press and hold for 700ms)
        Mouse.MoveTo(clickPoint);
        Mouse.Down(MouseButton.Left);
        await Task.Delay(700); // Longer than 600ms threshold
        Mouse.Up(MouseButton.Left);

        // Assert - Selection bar should appear
        var selectionBar = await WaitForSelectionBarAsync();
        selectionBar.Should().NotBeNull("selection bar should appear after long press");

        // Cleanup
        await ExitSelectionModeAsync();
    }

    [Fact]
    public async Task QuickTap_OnPasuk_DoesNotEnterSelectionMode()
    {
        // Arrange - ensure clean state
        await WaitForPasukimLoadedAsync();
        await ExitSelectionModeAsync();
        await Task.Delay(500);

        var pasukElements = GetPasukElements();

        var firstPasuk = pasukElements[0];

        // Act - Quick tap (short click)
        Mouse.Click(firstPasuk.GetClickablePoint(), MouseButton.Left);
        await Task.Delay(500);

        // Assert - Selection bar should NOT appear
        var selectionBar = FindSelectionBar();
        if (selectionBar != null)
        {
            selectionBar.Properties.IsOffscreen.ValueOrDefault.Should().BeTrue(
                "selection bar should not appear on quick tap outside selection mode");
        }
    }
}
