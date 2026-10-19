using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class RecitationPlaybackCursorTests
{
    private static readonly RecitationWord First = new(1, 1, "א", 1200, 1800);
    private static readonly RecitationWord Second = new(1, 2, "ב", 1900, 2300);
    private static readonly RecitationWord Last = new(3, 1, "ג", 5000, 5500);
    private static RecitationTrack Track() => new(1, "", "", "", 10000, "ready", [First, Second, Last]);

    [Fact]
    public void no_playback_is_not_bar_issued_and_has_no_bookmark()
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.BarIssued.Should().BeFalse();
        cursor.PlayingKey.Should().BeNull();
        cursor.HasBookmarkFor(1).Should().BeFalse();
    }

    [Theory]
    [InlineData("chapter:1", true)]
    [InlineData("verses:1:1,2", true)]
    [InlineData("pasuk:1:3", true)]
    [InlineData("word:1:1:2", false)]
    public void the_bar_owns_every_playback_except_a_word_preview(string key, bool barIssued)
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.Begin(key, continuous: key.StartsWith("chapter:", StringComparison.Ordinal));
        cursor.BarIssued.Should().Be(barIssued);
    }

    [Fact]
    public void a_tapped_word_marks_where_the_next_continuous_playback_resumes()
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.MarkResume(1, 1900);
        cursor.HasBookmarkFor(1).Should().BeTrue();
        cursor.PendingSeekFor(1, continuous: true, new RecitationTimeline(Track())).Should().Be(1900);
    }

    [Fact]
    public void pending_seek_maps_the_bookmark_into_the_joined_clip()
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.MarkResume(1, 5000);
        // Pasuk 3's word resumes at its position inside the joined clip.
        cursor.PendingSeekFor(1, continuous: true,
            new RecitationTimeline(Track(), [(1200, 2300), (5000, 5500)])).Should().Be(1100);
    }

    [Fact]
    public void bounded_playback_never_seeks_to_the_bookmark()
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.MarkResume(1, 1900);
        cursor.PendingSeekFor(1, continuous: false, new RecitationTimeline(Track())).Should().BeNull();
    }

    [Fact]
    public void the_bookmark_survives_preview_end_and_is_consumed_only_by_a_completed_chapter()
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.MarkResume(1, 1900);
        cursor.Begin("word:1:1:2", continuous: false);
        cursor.End();
        // The word preview ended — the bookmark still waits for continuous Play.
        cursor.HasBookmarkFor(1).Should().BeTrue();
        cursor.PlayingKey.Should().BeNull();

        cursor.Begin("chapter:1", continuous: true);
        cursor.End();
        // Reaching the chapter's end consumes the bookmark.
        cursor.HasBookmarkFor(1).Should().BeFalse();
    }

    [Fact]
    public void an_explicit_stop_keeps_the_bookmark_but_a_session_reset_drops_it()
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.MarkResume(1, 1900);
        cursor.Begin("pasuk:1:1", continuous: false);
        cursor.Stop();
        cursor.HasBookmarkFor(1).Should().BeTrue();
        cursor.PlayingKey.Should().BeNull();

        cursor.MarkResume(1, 5000);
        cursor.Reset();
        cursor.HasBookmarkFor(1).Should().BeFalse();
    }

    [Fact]
    public void the_bookmark_never_leaks_into_another_perek()
    {
        var cursor = new RecitationPlaybackCursor();
        cursor.MarkResume(1, 1900);
        cursor.HasBookmarkFor(2).Should().BeFalse();
        cursor.PendingSeekFor(2, continuous: true, new RecitationTimeline(Track())).Should().BeNull();
    }
}
