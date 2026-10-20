namespace BibleOnSite.Helpers;

/// <summary>
/// Computes whether a vertically scrollable list has more content above or
/// below its current viewport — drives the boundary arrows in picker lists.
/// </summary>
public static class ScrollEdges
{
    // A fraction of a pixel of hidden content reads as fully reached.
    private const double Epsilon = 1.0;

    /// <summary>True when content exists above the current scroll offset.</summary>
    public static bool CanScrollUp(double scrollOffset) => scrollOffset > Epsilon;

    /// <summary>
    /// True when content extends below the viewport. An unmeasured viewport
    /// (height 0 before first layout) reports false rather than flashing a
    /// false "more below" arrow.
    /// </summary>
    public static bool CanScrollDown(double scrollOffset, double viewportHeight, double contentHeight)
    {
        if (viewportHeight <= 0 || contentHeight <= viewportHeight)
        {
            return false;
        }

        return contentHeight - viewportHeight - scrollOffset > Epsilon;
    }
}
