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
    public void a_word_clip_starts_at_zero_and_unapproved_chapters_never_highlight()
    {
        new RecitationTimeline(Track(), [(1900, 2300)]).WordAt(0).Should().BeSameAs(Second);
        new RecitationTimeline(Track("needs_review")).WordAt(1200).Should().BeNull();
        new RecitationTimeline(null).WordAt(1200).Should().BeNull();
    }
}
