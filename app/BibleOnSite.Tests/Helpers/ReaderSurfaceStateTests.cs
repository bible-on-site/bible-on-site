using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// The reader's transient surfaces — selection, chapter recitation, a focused
/// pasuk, or an in-flight clip — all keep the selection bar up, and each must
/// consume an Android/Windows Back press before navigation sees it (#2368).
/// </summary>
public class ReaderSurfaceStateTests
{
    [Fact]
    public void a_bare_reader_has_no_surface_so_back_navigates()
    {
        ReaderSurfaceState.IsActive(selectedPasukCount: 0, chapterRecitation: false,
            focusedPasuk: false, playing: false).Should().BeFalse();
    }

    [Fact]
    public void playback_without_any_selection_is_a_surface_back_must_consume()
    {
        // Regression: the bar stays up for a playing clip, so Back here stops
        // playback instead of navigating away mid-clip.
        ReaderSurfaceState.IsActive(selectedPasukCount: 0, chapterRecitation: false,
            focusedPasuk: false, playing: true).Should().BeTrue();
    }

    [Theory]
    [InlineData(2, false, false)]
    [InlineData(0, true, false)]
    [InlineData(0, false, true)]
    public void selection_surfaces_stay_active_without_playback(int selectedPasukCount,
        bool chapterRecitation, bool focusedPasuk)
    {
        ReaderSurfaceState.IsActive(selectedPasukCount, chapterRecitation,
            focusedPasuk, playing: false).Should().BeTrue();
    }

    [Fact]
    public void surfaces_stay_active_while_a_clip_is_playing()
    {
        ReaderSurfaceState.IsActive(selectedPasukCount: 0, chapterRecitation: false,
            focusedPasuk: true, playing: true).Should().BeTrue();
    }

    [Fact]
    public void focused_pasuk_shows_the_shared_toolbar_not_the_selection_bar()
    {
        // #2466: the focused pasuk dropped its Back-only bar for the shared
        // reader toolbar, even while its clip keeps playing.
        ReaderSurfaceState.ShowsSelectionBar(selectedPasukCount: 0, chapterRecitation: false,
            focusedPasuk: true, playing: true).Should().BeFalse();
        ReaderSurfaceState.ShowsSelectionBar(selectedPasukCount: 0, chapterRecitation: false,
            focusedPasuk: true, playing: false).Should().BeFalse();
    }

    [Theory]
    [InlineData(2, false, false)]
    [InlineData(0, true, false)]
    [InlineData(0, false, true)]
    public void other_surfaces_still_show_the_selection_bar(int selectedPasukCount,
        bool chapterRecitation, bool playing)
    {
        ReaderSurfaceState.ShowsSelectionBar(selectedPasukCount, chapterRecitation,
            focusedPasuk: false, playing).Should().BeTrue();
    }
}
