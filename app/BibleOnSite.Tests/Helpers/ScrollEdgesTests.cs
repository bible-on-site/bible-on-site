using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class ScrollEdgesTests
{
    [Fact]
    public void HasAbove_AtTop_IsBoundary() => Assert.False(ScrollEdges.HasAbove(0));

    [Fact]
    public void HasAbove_ScrolledDown_IsAvailable() => Assert.True(ScrollEdges.HasAbove(1));

    [Fact]
    public void HasBelow_LastItemVisible_IsBoundary()
    {
        // תהלים has 150 perakim; index 149 visible → bottom reached
        Assert.False(ScrollEdges.HasBelow(149, 150));
    }

    [Fact]
    public void HasBelow_BeforeEnd_IsAvailable() => Assert.True(ScrollEdges.HasBelow(10, 150));

    [Fact]
    public void HasBelow_EmptyList_IsBoundary() => Assert.False(ScrollEdges.HasBelow(0, 0));

    [Fact]
    public void HasBelow_NoScrollInfoYet_IsBoundary() => Assert.False(ScrollEdges.HasBelow(-1, 47));

    [Fact]
    public void HasBelowEstimate_ContentFits_IsBoundary() => Assert.False(ScrollEdges.HasBelowEstimate(300, 240));

    [Fact]
    public void HasBelowEstimate_ContentOverflows_IsAvailable() => Assert.True(ScrollEdges.HasBelowEstimate(300, 47 * 40));

    [Fact]
    public void HasBelowEstimate_UnmeasuredViewport_IsBoundary() => Assert.False(ScrollEdges.HasBelowEstimate(0, 1000));
}
