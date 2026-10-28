using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>Windows window placement math (#2766).</summary>
public class WindowPlacementPlanTests
{
    private static readonly DesktopRect WorkArea = new(0, 0, 1920, 1040);

    [Fact]
    public void InitialPlacement_CentersDefaultSizeInWorkArea()
    {
        var rect = WindowPlacementPlan.InitialPlacement(WorkArea);

        rect.Width.Should().Be(WindowPlacementPlan.DefaultWindowWidth);
        rect.Height.Should().Be(WindowPlacementPlan.DefaultWindowHeight);
        rect.X.Should().BeApproximately((1920 - rect.Width) / 2, 0.001);
        rect.Y.Should().BeApproximately((1040 - rect.Height) / 2, 0.001);
    }

    [Fact]
    public void InitialPlacement_SmallWorkArea_ShrinksToFitButNeverBelowMinimum()
    {
        var tiny = new DesktopRect(0, 0, 500, 600);
        var rect = WindowPlacementPlan.InitialPlacement(tiny);

        rect.Width.Should().BeGreaterThanOrEqualTo(WindowPlacementPlan.MinWindowWidth);
        rect.Height.Should().BeGreaterThanOrEqualTo(WindowPlacementPlan.MinWindowHeight);
        rect.Width.Should().BeLessThanOrEqualTo(WindowPlacementPlan.DefaultWindowWidth);
    }

    [Fact]
    public void InitialPlacement_WorkAreaSmallerThanMinimum_StillUsesMinimum()
    {
        // A degenerate work area (e.g. extreme scaling) must not produce a
        // window below the usable minimum.
        var rect = WindowPlacementPlan.InitialPlacement(new DesktopRect(0, 0, 300, 300));
        rect.Width.Should().Be(WindowPlacementPlan.MinWindowWidth);
        rect.Height.Should().Be(WindowPlacementPlan.MinWindowHeight);
    }

    [Fact]
    public void ClampToWorkArea_OnScreenBounds_PassesThrough()
    {
        var bounds = new DesktopRect(100, 80, 1200, 800);
        var result = WindowPlacementPlan.ClampToWorkArea(bounds, WorkArea);
        result.Should().Be(bounds);
    }

    [Fact]
    public void ClampToWorkArea_OffScreenRight_PullsBackInside()
    {
        var bounds = new DesktopRect(1900, 50, 800, 700);
        var result = WindowPlacementPlan.ClampToWorkArea(bounds, WorkArea);
        // At least MinVisibleEdge of the window must remain reachable.
        (result.X + result.Width).Should().BeLessThanOrEqualTo(1920 + 800 - WindowPlacementPlan.MinVisibleEdge);
        result.X.Should().BeLessThanOrEqualTo(1920 - WindowPlacementPlan.MinVisibleEdge);
    }

    [Fact]
    public void ClampToWorkArea_OffScreenLeft_PullsBackInside()
    {
        var bounds = new DesktopRect(-750, 50, 800, 700);
        var result = WindowPlacementPlan.ClampToWorkArea(bounds, WorkArea);
        result.X.Should().BeGreaterThanOrEqualTo(WindowPlacementPlan.MinVisibleEdge - 800);
        // Some title-bar area stays visible for grabbing.
        (result.X + result.Width).Should().BeGreaterThanOrEqualTo(WindowPlacementPlan.MinVisibleEdge);
    }

    [Fact]
    public void ClampToWorkArea_Oversized_ShrinksToWorkArea()
    {
        var bounds = new DesktopRect(0, 0, 4000, 2000);
        var result = WindowPlacementPlan.ClampToWorkArea(bounds, WorkArea);
        result.Width.Should().Be(1920);
        result.Height.Should().Be(1040);
    }

    [Fact]
    public void ClampToWorkArea_Undersized_GrowsToMinimum()
    {
        var bounds = new DesktopRect(100, 100, 200, 150);
        var result = WindowPlacementPlan.ClampToWorkArea(bounds, WorkArea);
        result.Width.Should().Be(WindowPlacementPlan.MinWindowWidth);
        result.Height.Should().Be(WindowPlacementPlan.MinWindowHeight);
    }

    [Fact]
    public void ClampToWorkArea_TitleBarBelowWorkArea_PullsUp()
    {
        var bounds = new DesktopRect(100, 1200, 800, 600);
        var result = WindowPlacementPlan.ClampToWorkArea(bounds, WorkArea);
        result.Y.Should().BeLessThanOrEqualTo(1040 - WindowPlacementPlan.MinVisibleEdge);
    }

    [Fact]
    public void Serialize_TryParse_RoundTrips()
    {
        var bounds = new DesktopRect(-320.5, 48, 1140, 840.25);
        var text = WindowPlacementPlan.Serialize(bounds, maximized: true);

        WindowPlacementPlan.TryParse(text, out var parsed, out var maximized).Should().BeTrue();
        parsed.Should().Be(bounds);
        maximized.Should().BeTrue();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("1,2,3")]
    [InlineData("1,2,3,4")]
    [InlineData("1,2,3,4|2")]
    [InlineData("a,b,c,d|0")]
    [InlineData("1,2,0,4|0")]
    [InlineData("1,2,-4,4|0")]
    [InlineData("1,2,4,4|0|extra")]
    [InlineData("1,2,NaN,4|0")]
    public void TryParse_Malformed_ReturnsFalse(string? value)
    {
        WindowPlacementPlan.TryParse(value, out _, out _).Should().BeFalse();
    }

    [Fact]
    public void Intersects_OverlapAndTouch_True()
    {
        var a = new DesktopRect(0, 0, 100, 100);
        WindowPlacementPlan.Intersects(a, new DesktopRect(50, 50, 100, 100)).Should().BeTrue();
    }

    [Fact]
    public void Intersects_Disjoint_False()
    {
        var a = new DesktopRect(0, 0, 100, 100);
        WindowPlacementPlan.Intersects(a, new DesktopRect(200, 0, 100, 100)).Should().BeFalse();
        WindowPlacementPlan.Intersects(a, new DesktopRect(0, 200, 100, 100)).Should().BeFalse();
    }

    [Fact]
    public void IntersectionArea_PartialOverlap_ReturnsCoveredArea()
    {
        var a = new DesktopRect(0, 0, 100, 100);
        WindowPlacementPlan.IntersectionArea(a, new DesktopRect(50, 50, 100, 100))
            .Should().Be(2500);
    }

    [Fact]
    public void IntersectionArea_Disjoint_ReturnsZero()
    {
        var a = new DesktopRect(0, 0, 100, 100);
        WindowPlacementPlan.IntersectionArea(a, new DesktopRect(200, 0, 100, 100)).Should().Be(0);
        WindowPlacementPlan.IntersectionArea(a, new DesktopRect(0, 200, 100, 100)).Should().Be(0);
    }

    [Fact]
    public void ClampToBestDisplay_BoundsInsideDisplay_PassesThrough()
    {
        var second = new DesktopRect(1920, 0, 1920, 1040);
        var bounds = new DesktopRect(2000, 100, 800, 700);
        WindowPlacementPlan.ClampToBestDisplay(bounds, [WorkArea, second], WorkArea)
            .Should().Be(bounds);
    }

    [Fact]
    public void ClampToBestDisplay_OnePixelOverlapOnDisconnectedEdge_KeepsVisibleEdge()
    {
        // Saved from a second monitor that no longer exists: only 1px would
        // intersect the primary display, so the restore must still guarantee
        // MinVisibleEdge of title bar instead of trusting the intersection.
        var bounds = new DesktopRect(1919, 50, 800, 700);
        var result = WindowPlacementPlan.ClampToBestDisplay(bounds, [WorkArea], WorkArea);
        result.X.Should().BeLessThanOrEqualTo(1920 - WindowPlacementPlan.MinVisibleEdge);
    }

    [Fact]
    public void ClampToBestDisplay_SpanningTwoDisplays_ClampsToDominantDisplay()
    {
        var second = new DesktopRect(1920, 0, 1920, 1040);
        // Mostly on the second display; its own left edge pokes 1px past it.
        var bounds = new DesktopRect(1919, 50, 900, 700);
        var result = WindowPlacementPlan.ClampToBestDisplay(bounds, [WorkArea, second], WorkArea);
        result.X.Should().BeGreaterThanOrEqualTo(second.X + WindowPlacementPlan.MinVisibleEdge - result.Width);
        result.X.Should().BeLessThanOrEqualTo(second.X + second.Width - WindowPlacementPlan.MinVisibleEdge);
    }

    [Fact]
    public void ClampToBestDisplay_NoIntersection_FallsBackToPrimaryWorkArea()
    {
        var farAway = new DesktopRect(5000, 5000, 800, 700);
        var result = WindowPlacementPlan.ClampToBestDisplay(farAway, [WorkArea], WorkArea);
        result.X.Should().BeLessThanOrEqualTo(WorkArea.X + WorkArea.Width - WindowPlacementPlan.MinVisibleEdge);
        result.Y.Should().BeLessThanOrEqualTo(WorkArea.Y + WorkArea.Height - WindowPlacementPlan.MinVisibleEdge);
    }
}
