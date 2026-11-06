using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Attribution of ordered stored block units to rendered counted children
/// (issue #2607): aligned counts slice the units in order, a mismatch
/// collapses to one region, and empty inputs never fabricate progress.
/// </summary>
public sealed class CountedContentUnitsTests
{
    private static List<ReadingProgressUnit> Units(params (int Words, int Cumulative)[] rows) =>
        rows.Select((r, i) => new ReadingProgressUnit
        {
            Key = i.ToString(),
            WordCount = r.Words,
            CumulativeWords = r.Cumulative
        }).ToList();

    [Fact]
    public void Empty_Inputs_Return_No_Regions()
    {
        CountedContentUnits.Attribute([], Units((10, 10))).Should().BeEmpty();
        CountedContentUnits.Attribute([1], []).Should().BeEmpty();
        CountedContentUnits.Attribute([0], Units((10, 10))).Should().BeEmpty();
    }

    [Fact]
    public void Aligned_Counts_Slice_Units_In_Child_Order()
    {
        // Child 0 covers blocks 0-1 (30 words), child 1 covers block 2 (40).
        var regions = CountedContentUnits.Attribute([2, 1], Units((10, 10), (20, 30), (40, 70)));

        regions.Should().HaveCount(2);
        regions[0].Should().Be(new CountedProgressRegion(0, 1, 0, 30));
        regions[1].Should().Be(new CountedProgressRegion(1, 1, 30, 40));
    }

    [Fact]
    public void Zero_Block_Child_Gets_No_Words()
    {
        // A text child that produced no stored block (e.g. whitespace-only)
        // owns nothing and does not advance the anchor.
        var regions = CountedContentUnits.Attribute([1, 0, 1], Units((10, 10), (5, 15)));

        regions.Should().HaveCount(3);
        regions[1].Words.Should().Be(0);
        regions[2].WordsBefore.Should().Be(10);
        regions[2].Words.Should().Be(5);
    }

    [Fact]
    public void Trailing_Zero_Block_Child_After_Exhaustion_Gets_No_Words()
    {
        // An article ending in wordless HTML after media renders a trailing
        // zero-block child once earlier children consumed every stored unit —
        // it must not index past the unit list (issue #2607).
        var regions = CountedContentUnits.Attribute([1, 0], Units((10, 10)));

        regions.Should().HaveCount(2);
        regions[1].WordsBefore.Should().Be(10);
        regions[1].Words.Should().Be(0);
    }

    [Fact]
    public void Mismatched_Total_Collapses_To_One_Region()
    {
        var regions = CountedContentUnits.Attribute([1, 1], Units((10, 10), (20, 30), (40, 70)));

        regions.Should().ContainSingle();
        regions[0].Should().Be(new CountedProgressRegion(0, 2, 0, 70));
    }

    [Fact]
    public void Single_Child_Owns_Every_Unit()
    {
        // The Tanahpedia entry body renders as one HtmlView — that child
        // owns all stored blocks regardless of its inner segmentation.
        var regions = CountedContentUnits.Attribute([1], Units((10, 10), (20, 30), (40, 70)));

        regions.Should().ContainSingle();
        regions[0].Should().Be(new CountedProgressRegion(0, 1, 0, 70));
    }
}
