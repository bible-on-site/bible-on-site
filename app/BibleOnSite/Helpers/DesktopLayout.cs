namespace BibleOnSite.Helpers;

/// <summary>
/// Width constants for the Windows desktop layout. The app targets
/// touch-first mobile layouts; on a desktop monitor those layouts stretch
/// to the full window width, producing unreadable text lines and scattered
/// reader actions. These values cap the content column while leaving the
/// surrounding chrome (top bar, side gutters) untouched (#2766).
/// </summary>
public static class DesktopLayout
{
    /// <summary>
    /// Maximum width of the scripture/article content column on Windows.
    /// ~920 dips keeps Hebrew reading lines short enough to track with the
    /// eye on a maximized 24"+ monitor, while wide tables (perushim) still
    /// have room. Also used for search results and reader overlays.
    /// </summary>
    public static double ReaderColumnMaxWidth { get; } = 920;

    /// <summary>
    /// Maximum width of the floating reader bottom-bar on Windows. The bar
    /// positions its actions proportionally; capping it keeps the actions
    /// clustered under the column instead of scattered across the window.
    /// </summary>
    public static double ReaderBarMaxWidth { get; } = 560;

    /// <summary>
    /// Maximum width of the perushim bottom sheet on Windows.
    /// </summary>
    public static double ReaderSheetMaxWidth { get; } = 760;

    /// <summary>
    /// Maximum width of generic content columns on Windows (preferences,
    /// about-style pages, article/tanahpedia entry bodies).
    /// </summary>
    public static double ContentColumnMaxWidth { get; } = 960;
}
