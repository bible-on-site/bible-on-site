using System.Security.Cryptography;
using System.Text;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Shared range→clip planning: mid-verse Masoretic edges must bound clips to
/// exact canonical words, multi-perek and repeated ranges must keep their
/// order, and unaligned tracks must only ever play whole-perek slices (#3260).
/// </summary>
public class RecitationRangePlannerTests
{
    private static string Hash(byte[] value) => Convert.ToHexStringLower(SHA256.HashData(value));

    // A perek whose first pasuk breaks mid-verse at a ptuha marker (canonical
    // segment index 2): words live at canonical 1-based segments 1,2 and 4.
    private static List<Pasuk> CanonicalPerek() =>
    [
        new() { PasukNum = 1, Text = "א ב ג", Segments =
        [
            new() { Type = SegmentType.Qri, Value = "א" },
            new() { Type = SegmentType.Qri, Value = "ב" },
            new() { Type = SegmentType.Ptuha },
            new() { Type = SegmentType.Qri, Value = "ג" },
        ] },
        new() { PasukNum = 2, Text = "ד ה", Segments =
        [
            new() { Type = SegmentType.Qri, Value = "ד" },
            new() { Type = SegmentType.Qri, Value = "ה" },
        ] },
        new() { PasukNum = 3, Text = "ו", Segments =
        [
            new() { Type = SegmentType.Qri, Value = "ו" },
        ] },
    ];

    private static RecitationTrack Track(int perekId, string status = "ready")
    {
        var words = new List<RecitationWord>();
        var t = 100.0;
        foreach (var (pasuk, segment, text) in new[]
        {
            (1, 1, "א"), (1, 2, "ב"), (1, 4, "ג"), (2, 1, "ד"), (2, 2, "ה"), (3, 1, "ו"),
        })
        {
            words.Add(new RecitationWord(pasuk, segment, text, t, t + 600));
            t += 700;
        }
        var textHash = Hash(Encoding.UTF8.GetBytes("1:1:א\n1:2:ב\n1:4:ג\n2:1:ד\n2:2:ה\n3:1:ו"));
        return new RecitationTrack(perekId, $"https://example.com/{perekId}.mp3", "deadbeef",
            textHash, 5000, status, status == "ready" ? words : []);
    }

    private static MasoraUnitText.PerekSlice Slice(int perekId, int startPasuk, int endPasuk,
        int? startSegment = null, int? endSegment = null) => new()
    {
        PerekId = perekId, StartPasuk = startPasuk, EndPasuk = endPasuk,
        StartSegmentIndex = startSegment, EndSegmentIndex = endSegment,
    };

    [Fact]
    public void MidVerseSlice_StartSegmentBoundary_ClipsToCanonicalWords()
    {
        var track = Track(5);

        // The unit begins mid-verse at the ptuha break — the words before the
        // break (canonical segments 1-2) must not play.
        var words = RecitationRangePlanner.WordsForSlice(
            Slice(5, startPasuk: 1, endPasuk: 3, startSegment: 2), track, 3);

        words.Select(w => (w.Pasuk, w.Segment)).Should().Equal(
            (1, 4), (2, 1), (2, 2), (3, 1));
    }

    [Fact]
    public void MidVerseSlice_EndSegmentBoundary_ClipsToCanonicalWords()
    {
        var track = Track(5);

        // The unit ends mid-verse: only the words up to canonical segment 2
        // (0-based index 1) of the boundary pasuk play.
        var words = RecitationRangePlanner.WordsForSlice(
            Slice(5, startPasuk: 1, endPasuk: 1, endSegment: 1), track, 3);

        words.Select(w => w.Segment).Should().Equal(1, 2);
    }

    [Fact]
    public void ClippedRow_BothBounds_PlayExactlyTheUnitsWords()
    {
        var track = Track(5);

        // A row clipped to canonical segments 2..3 keeps the single word at
        // segment 4 (the post-break part of the pasuk).
        var words = RecitationRangePlanner.WordsForClippedRow(track, 1, 2, int.MaxValue);

        words.Select(w => w.Segment).Should().Equal(4);
    }

    [Fact]
    public void SegmentsForSlices_MultiPerekAndRepeatedRanges_KeepOrderAndBounds()
    {
        var tracks = new Dictionary<int, RecitationTrack> { [5] = Track(5), [9] = Track(9) };
        var pasukim = CanonicalPerek();
        var slices = new[]
        {
            Slice(9, startPasuk: 2, endPasuk: 3),
            Slice(5, startPasuk: 1, endPasuk: 3),
            Slice(9, startPasuk: 2, endPasuk: 3), // an intentionally repeated range stays
        };

        var segments = RecitationRangePlanner.SegmentsForSlices(
            slices, _ => pasukim, id => tracks.GetValueOrDefault(id),
            tracks.ContainsKey, versePause: false);

        segments.Select(s => s.PerekId).Should().Equal(9, 5, 9);
        // The partial perek 9 slices bound to pesukim 2-3 only — the clip
        // starts at pasuk 2's first word and ends at pasuk 3's last.
        segments[0].Ranges.Should().Equal([(2200.0, 4200.0)]);
    }

    [Fact]
    public void SegmentsForSlices_UnalignedTrack_PartialSliceSkippedWholePerekPlays()
    {
        var tracks = new Dictionary<int, RecitationTrack>
        {
            [5] = Track(5, "pending"),
            [9] = Track(9, "pending"),
        };
        var pasukim = CanonicalPerek();
        var slices = new[] { Slice(9, startPasuk: 2, endPasuk: 2), Slice(5, startPasuk: 1, endPasuk: 3) };

        var segments = RecitationRangePlanner.SegmentsForSlices(
            slices, _ => pasukim, id => tracks.GetValueOrDefault(id),
            tracks.ContainsKey, versePause: false);

        // A partial slice on an unaligned track has no approved boundary —
        // only the whole-perek slice plays, unbounded.
        segments.Should().ContainSingle();
        segments[0].PerekId.Should().Be(5);
        segments[0].Ranges.Should().BeNull();
    }

    [Fact]
    public void SegmentsForSlices_MissingAudio_SkipsThatSlice()
    {
        var tracks = new Dictionary<int, RecitationTrack> { [5] = Track(5) };
        var pasukim = CanonicalPerek();
        var slices = new[] { Slice(9, startPasuk: 1, endPasuk: 3), Slice(5, startPasuk: 1, endPasuk: 3) };

        var segments = RecitationRangePlanner.SegmentsForSlices(
            slices, _ => pasukim, id => tracks.GetValueOrDefault(id),
            id => id == 5, versePause: false);

        segments.Should().ContainSingle().Which.PerekId.Should().Be(5);
    }

    [Fact]
    public void SegmentsForSlices_VersePause_GroupsRangesPerPasukInsideSlice()
    {
        var tracks = new Dictionary<int, RecitationTrack> { [5] = Track(5) };
        var pasukim = CanonicalPerek();
        var slices = new[] { Slice(5, startPasuk: 2, endPasuk: 3) };

        var segments = RecitationRangePlanner.SegmentsForSlices(
            slices, _ => pasukim, id => tracks.GetValueOrDefault(id),
            tracks.ContainsKey, versePause: true);

        segments.Should().ContainSingle();
        // Two pasuk ranges — the verse-pause decoder joins them with silence.
        segments[0].Ranges.Should().HaveCount(2);
        segments[0].Ranges![0].Start.Should().Be(Track(5).GetWords(2)[0].StartMs);
        segments[0].Ranges![1].End.Should().Be(Track(5).GetWords(3)[^1].EndMs);
    }

    [Fact]
    public void SegmentsForSlices_SliceWithNoApprovedWords_SkipsThatSlice()
    {
        var tracks = new Dictionary<int, RecitationTrack> { [5] = Track(5), [9] = Track(9) };
        var pasukim = CanonicalPerek();
        // The boundary starts past the pasuk's last canonical word — a unit
        // edge on a break marker with no recited text produces no clip.
        var slices = new[]
        {
            Slice(5, startPasuk: 1, endPasuk: 1, startSegment: 10),
            Slice(9, startPasuk: 1, endPasuk: 3),
        };

        var segments = RecitationRangePlanner.SegmentsForSlices(
            slices, _ => pasukim, id => tracks.GetValueOrDefault(id),
            tracks.ContainsKey, versePause: false);

        segments.Should().ContainSingle().Which.PerekId.Should().Be(9);
    }

    [Fact]
    public void SegmentsForSlices_EndClippedSlice_IsNotWholePerek()
    {
        var tracks = new Dictionary<int, RecitationTrack> { [5] = Track(5, "pending") };
        var pasukim = CanonicalPerek();
        // The slice spans the whole perek's pesukim but clips its last
        // pasuk's segments — not a whole-perek read for the raw-file fallback.
        pasukim[^1].Text = "ו ז";
        pasukim[^1].Segments.Add(new() { Type = SegmentType.Qri, Value = "ז" });
        var slices = new[] { Slice(5, startPasuk: 1, endPasuk: 3, endSegment: 0) };

        var segments = RecitationRangePlanner.SegmentsForSlices(
            slices, _ => pasukim, id => tracks.GetValueOrDefault(id),
            tracks.ContainsKey, versePause: false);

        segments.Should().BeEmpty(
            "an unaligned track has no approved boundary for a segment-clipped tail");
    }

    [Fact]
    public void SegmentsForSlices_StartClippedSlice_IsNotWholePerek()
    {
        var tracks = new Dictionary<int, RecitationTrack> { [5] = Track(5, "pending") };
        var pasukim = CanonicalPerek();
        // Same shape on the leading edge — the clip starts mid-pasuk.
        var slices = new[] { Slice(5, startPasuk: 1, endPasuk: 3, startSegment: 2) };

        var segments = RecitationRangePlanner.SegmentsForSlices(
            slices, _ => pasukim, id => tracks.GetValueOrDefault(id),
            tracks.ContainsKey, versePause: false);

        segments.Should().BeEmpty();
    }
    [Fact]
    public void SegmentsForSlices_WholeVerseSpanWithAPartialWordBoundary_RequiresAlignment()
    {
        var segments = RecitationRangePlanner.SegmentsForSlices(
            [Slice(5, startPasuk: 1, endPasuk: 3, startSegment: 1)],
            _ => CanonicalPerek(),
            id => Track(id, "unaligned"),
            _ => true,
            versePause: false);

        segments.Should().BeEmpty();
    }

    [Fact]
    public void SegmentsForSlices_MissingCanonicalTextOrDownloadedAudio_SkipsThatSlice()
    {
        var pasukim = CanonicalPerek();
        var segments = RecitationRangePlanner.SegmentsForSlices(
            [Slice(1, 1, 3), Slice(2, 1, 3), Slice(3, 1, 3)],
            id => id == 1 ? null : pasukim,
            id => Track(id),
            id => id == 3,
            versePause: false);

        segments.Should().ContainSingle().Which.PerekId.Should().Be(3);
    }

}
