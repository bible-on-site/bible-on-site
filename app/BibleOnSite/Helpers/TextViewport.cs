namespace BibleOnSite.Helpers;

/// <summary>The visible slice of an inline document in its own coordinates.</summary>
public readonly record struct TextViewport(double Offset, double Height)
{
    public static TextViewport Clip(double contentHeight, double visibleTop, double visibleBottom)
    {
        if (!double.IsFinite(contentHeight) || contentHeight <= 0 ||
            !double.IsFinite(visibleTop) || !double.IsFinite(visibleBottom))
        {
            return default;
        }
        var top = Math.Clamp(visibleTop, 0, contentHeight);
        var bottom = Math.Clamp(visibleBottom, 0, contentHeight);
        return new(top, Math.Max(0, bottom - top));
    }
}
