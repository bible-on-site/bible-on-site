using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class ScrollEdgesTests
{
    [Fact]
    public void AtTop_UpIsBoundary()
    {
        ScrollEdges.CanScrollUp(0).Should().BeFalse();
        ScrollEdges.CanScrollUp(0.4).Should().BeFalse();
    }

    [Fact]
    public void ScrolledDown_UpIsAvailable()
    {
        ScrollEdges.CanScrollUp(40).Should().BeTrue();
    }

    [Fact]
    public void AllContentFits_DownIsBoundary()
    {
        // 3 items of ~44px in a 300px viewport: nothing to scroll to.
        ScrollEdges.CanScrollDown(0, viewportHeight: 300, contentHeight: 132).Should().BeFalse();
    }

    [Fact]
    public void MoreContentBelow_DownIsAvailable()
    {
        // תהלים: 150 chapters never fit the viewport.
        ScrollEdges.CanScrollDown(0, viewportHeight: 300, contentHeight: 6600).Should().BeTrue();
    }

    [Fact]
    public void AtBottom_DownIsBoundary()
    {
        ScrollEdges.CanScrollDown(6300, viewportHeight: 300, contentHeight: 6600).Should().BeFalse();
        // Overshoot past the end (bounce) still counts as the boundary.
        ScrollEdges.CanScrollDown(6350, viewportHeight: 300, contentHeight: 6600).Should().BeFalse();
    }

    [Fact]
    public void InMiddle_BothDirectionsAvailable()
    {
        ScrollEdges.CanScrollUp(200).Should().BeTrue();
        ScrollEdges.CanScrollDown(200, viewportHeight: 300, contentHeight: 6600).Should().BeTrue();
    }

    [Fact]
    public void EmptyList_BothDirectionsAreBoundary()
    {
        ScrollEdges.CanScrollUp(0).Should().BeFalse();
        ScrollEdges.CanScrollDown(0, viewportHeight: 300, contentHeight: 0).Should().BeFalse();
    }

    [Fact]
    public void UnmeasuredViewport_DownIsBoundary()
    {
        // Height 0 before first layout must not flash a false "more below" arrow.
        ScrollEdges.CanScrollDown(0, viewportHeight: 0, contentHeight: 6600).Should().BeFalse();
    }

    [Fact]
    public void SubPixelRemainder_DownIsBoundary()
    {
        // A fraction of a pixel of hidden content reads as fully reached.
        ScrollEdges.CanScrollDown(0, viewportHeight: 299.4, contentHeight: 300).Should().BeFalse();
    }
}
