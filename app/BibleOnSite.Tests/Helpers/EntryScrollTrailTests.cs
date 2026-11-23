using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

public class EntryScrollTrailTests
{
    [Fact]
    public void RevisitFrames_KeepDistinctOffsetsPerVisit()
    {
        // שמשון -> דלילה -> שמשון -> Back -> Back: each visit keeps its own
        // frame, so revisiting an entry at the top never overwrites the first
        // visit's offset (#2640).
        var trail = new EntryScrollTrail();
        trail.PushOutgoing("שמשון", 600);
        trail.PushOutgoing("דלילה", 40);

        trail.PopForReplay("דלילה").Should().Be(40.0);
        trail.PopForReplay("שמשון").Should().Be(600.0,
            "the first visit's offset survives the later visit at the top");
        trail.PopForReplay("שמשון").Should().BeNull("the drained trail replays nothing");
    }

    [Fact]
    public void EmptyOutgoingName_RecordsNoFrame()
    {
        // The route-applied first entry leaves no outgoing visit behind.
        var trail = new EntryScrollTrail();
        trail.PushOutgoing(string.Empty, 250);

        trail.Count.Should().Be(0);
        trail.PopForReplay("שמשון").Should().BeNull();
    }

    [Fact]
    public void DesyncedFrame_DropsWithoutRestoring()
    {
        // A frame that does not match the restored name restores nothing but
        // still pops, keeping the count aligned with the entry trail.
        var trail = new EntryScrollTrail();
        trail.PushOutgoing("שמשון", 600);

        trail.PopForReplay("דלילה").Should().BeNull();
        trail.Count.Should().Be(0);
    }
}
