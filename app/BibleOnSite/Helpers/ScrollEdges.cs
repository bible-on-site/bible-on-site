namespace BibleOnSite.Helpers;

/// <summary>
/// Computes whether a vertically scrollable list has more content above or
/// below its current viewport — drives the boundary arrows in picker lists.
/// </summary>
public static class ScrollEdges
{
    private const double Epsilon = 1.0;

    /// <summary>More items exist above when the first item isn't visible.</summary>
    public static bool HasAbove(int firstVisibleIndex) => firstVisibleIndex > 0;

    /// <summary>More items exist below when the last item isn't visible.</summary>
    public static bool HasBelow(int lastVisibleIndex, int itemCount) =>
        itemCount > 0 && lastVisibleIndex >= 0 && lastVisibleIndex < itemCount - 1;

    /// <summary>
    /// Estimate for when no scroll event has fired yet: content taller than
    /// the viewport means more exists below (list starts at the top).
    /// </summary>
    public static bool HasBelowEstimate(double viewportHeight, double contentHeight) =>
        viewportHeight > 0 && contentHeight > viewportHeight + Epsilon;
}
