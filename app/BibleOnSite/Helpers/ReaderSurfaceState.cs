namespace BibleOnSite.Helpers;

/// <summary>
/// The reader's transient surfaces: a pesukim selection, the chapter
/// recitation mode, a focused pasuk, or an in-flight clip. The same set keeps
/// the selection bar visible and consumes a Back press — Android enables its
/// Back callback on that bar, so playback alone must still stop here instead
/// of navigating mid-clip.
/// </summary>
public static class ReaderSurfaceState
{
    public static bool IsActive(int selectedPasukCount, bool chapterRecitation, bool focusedPasuk, bool playing) =>
        selectedPasukCount > 0 || chapterRecitation || focusedPasuk || playing;

    /// <summary>
    /// Whether the transient surface presents the selection bar rather than the
    /// shared reader toolbar. The focused pasuk uses the shared toolbar — its
    /// playback control sits beside the verse — so only a real selection, the
    /// chapter recitation mode, or an unfocused in-flight clip shows the bar.
    /// </summary>
    public static bool ShowsSelectionBar(int selectedPasukCount, bool chapterRecitation, bool focusedPasuk, bool playing) =>
        (selectedPasukCount > 0 || chapterRecitation || playing) && !focusedPasuk;
}
