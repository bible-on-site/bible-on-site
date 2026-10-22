using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class RecitationTimelineTests
{
    private static readonly RecitationWord First = new(1, 1, "א", 1200, 1800);
    private static readonly RecitationWord Second = new(1, 2, "ב", 1900, 2300);
    private static readonly RecitationWord Last = new(3, 1, "ג", 5000, 5500);
    private static RecitationTrack Track(string status = "ready") => new(1, "", "", "", 10000, status, [First, Second, Last]);

    [Theory]
    [InlineData(0, null)]
    [InlineData(1200, 1)]
    [InlineData(1799.9, 1)]
    [InlineData(1800, null)]
    [InlineData(1900, 2)]
    [InlineData(2300, null)]
    [InlineData(5000, 1)]
    [InlineData(5500, null)]
    [InlineData(double.NaN, null)]
    public void chapter_clock_uses_half_open_intervals_and_clears_in_silence(double position, int? segment)
    {
        new RecitationTimeline(Track()).WordAt(position)?.Segment.Should().Be(segment);
    }

    [Fact]
    public void joined_nonconsecutive_verses_keep_internal_gaps_and_canonical_identity()
    {
        var timeline = new RecitationTimeline(Track(), [(1200, 2300), (5000, 5500)]);
        timeline.WordAt(0).Should().BeSameAs(First);
        timeline.WordAt(600).Should().BeNull();
        timeline.WordAt(700).Should().BeSameAs(Second);
        timeline.WordAt(1100).Should().BeSameAs(Last);
        timeline.WordAt(1600).Should().BeNull();
        // Seeking backwards and resuming do not depend on previous UI ticks.
        timeline.WordAt(100).Should().BeSameAs(First);
        First.StartMs.Should().Be(1200);
        Last.StartMs.Should().Be(5000);
    }

    [Fact]
    public void custom_verse_pause_has_no_highlight_and_preserves_original_word_intervals()
    {
        // At 2x, two source seconds of silence produce one real second of pause.
        var timeline = new RecitationTimeline(Track(), [(1200, 2300), (5000, 5500)], 2000);
        timeline.WordAt(700).Should().BeSameAs(Second);
        timeline.WordAt(1100).Should().BeNull();
        timeline.WordAt(3099.9).Should().BeNull();
        timeline.WordAt(3100).Should().BeSameAs(Last);
        timeline.WordAt(3600).Should().BeNull();
        Last.StartMs.Should().Be(5000);
    }

    [Fact]
    public void a_word_clip_starts_at_zero_and_unapproved_chapters_never_highlight()
    {
        new RecitationTimeline(Track(), [(1900, 2300)]).WordAt(0).Should().BeSameAs(Second);
        new RecitationTimeline(Track("needs_review")).WordAt(1200).Should().BeNull();
        new RecitationTimeline(null).WordAt(1200).Should().BeNull();
    }

    [Theory]
    [InlineData(1200.0, 0.0)]     // pasuk 1 opens the clip
    [InlineData(1900.0, 700.0)]   // tapped word mid-perek resumes inside the first pasuk range
    [InlineData(2000.0, 800.0)]   // a position inside a word keeps its offset
    [InlineData(5000.0, 1100.0)]  // pasuk 3's word resumes at its joined position
    [InlineData(2400.0, null)]    // silence between words is not a resume point
    [InlineData(5600.0, null)]    // past the last word
    [InlineData(double.NaN, null)]
    public void a_tapped_word_marks_the_clip_position_where_chapter_playback_resumes(double sourceMs, double? clipMs)
    {
        new RecitationTimeline(Track(), [(1200.0, 2300.0), (5000.0, 5500.0)]).PositionOf(sourceMs).Should().Be(clipMs);
    }

    [Fact]
    public void a_custom_verse_pause_shifts_resume_past_the_generated_silence()
    {
        new RecitationTimeline(Track(), [(1200, 2300), (5000, 5500)], 2000).PositionOf(5000).Should().Be(3100);
    }

    [Fact]
    public void the_whole_recording_resumes_at_the_words_own_timestamps()
    {
        var timeline = new RecitationTimeline(Track());
        timeline.PositionOf(1900).Should().Be(1900);
        timeline.PositionOf(5000).Should().Be(5000);
        new RecitationTimeline(Track("needs_review")).PositionOf(1900).Should().BeNull();
        new RecitationTimeline(null).PositionOf(1900).Should().BeNull();
    }
}
