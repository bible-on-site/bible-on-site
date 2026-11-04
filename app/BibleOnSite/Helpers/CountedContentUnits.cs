using BibleOnSite.Models;

namespace BibleOnSite.Helpers;

/// <summary>
/// A span of consecutive rendered counted children that own a share of the
/// stored counted words — the app granularity of the web progress engine's
/// positioned units (issue #2607). <see cref="FirstChild"/> and
/// <see cref="ChildCount"/> index into the page's ordered counted-child
/// list; <see cref="WordsBefore"/> is the cumulative stored words ahead of
/// this region and <see cref="Words"/> the words it covers.
/// </summary>
public readonly record struct CountedProgressRegion(
    int FirstChild,
    int ChildCount,
    double WordsBefore,
    double Words);

/// <summary>
/// Attributes ordered stored block units (<c>*_metric_block</c> rows) to the
/// counted children a page actually rendered (issue #2607). A child's share
/// is the stored words of the blocks its readable-block count covers, in
/// order — media-only children take zero blocks and never advance progress.
/// </summary>
public static class CountedContentUnits
{
    /// <summary>
    /// Slice <paramref name="storedUnits"/> across the counted children by
    /// <paramref name="childBlockCounts"/>. When the counts disagree with the
    /// stored unit total (sanitization dropped a block, markup drift, a
    /// single rendered view holding every block) the result collapses to one
    /// region spanning every counted child — the web component's documented
    /// fallback: honest position over the counted region, never a fabricated
    /// distribution.
    /// </summary>
    public static IReadOnlyList<CountedProgressRegion> Attribute(
        IReadOnlyList<int> childBlockCounts,
        IReadOnlyList<ReadingProgressUnit> storedUnits)
    {
        var totalWords = storedUnits.Count > 0 ? storedUnits[^1].CumulativeWords : 0;
        var totalBlocks = childBlockCounts.Sum();
        if (childBlockCounts.Count == 0 || totalWords <= 0 || totalBlocks == 0)
        {
            // No rendered child carries readable text — stored words with no
            // counted surface have no honest position to report.
            return [];
        }
        if (totalBlocks != storedUnits.Count)
        {
            return [new CountedProgressRegion(0, childBlockCounts.Count, 0, totalWords)];
        }
        var regions = new List<CountedProgressRegion>(childBlockCounts.Count);
        var unitIndex = 0;
        for (var child = 0; child < childBlockCounts.Count; child++)
        {
            // A zero-block child after every stored unit was assigned reads
            // past the unit list — report the stored total instead
            // (the region still owns zero words).
            var wordsBefore = unitIndex == storedUnits.Count
                ? totalWords
                : storedUnits[unitIndex].CumulativeWords - storedUnits[unitIndex].WordCount;
            var words = 0;
            for (var block = 0; block < childBlockCounts[child]; block++, unitIndex++)
            {
                words += storedUnits[unitIndex].WordCount;
            }
            regions.Add(new CountedProgressRegion(child, 1, wordsBefore, words));
        }
        return regions;
    }
}
