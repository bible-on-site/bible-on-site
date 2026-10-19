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
}
