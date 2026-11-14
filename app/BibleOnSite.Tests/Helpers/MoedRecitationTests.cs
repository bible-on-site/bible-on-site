using System.Security.Cryptography;
using System.Text;
using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

public class MoedRecitationTests
{
    private static List<Pasuk> Canonical() =>
    [
        new() { PasukNum = 1, Text = "א", Segments = [new() { Type = SegmentType.Qri, Value = "א" }] },
        new() { PasukNum = 2, Text = "ב", Segments = [new() { Type = SegmentType.Qri, Value = "ב" }] }
    ];

    private static RecitationTrack Track(int id) => new(id, "u", "h",
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes("1:1:א\n2:1:ב"))),
        1500, "ready", [new(1, 1, "א", 100, 500), new(2, 1, "ב", 700, 1100)]);

    private static MoedDisplayRow Row(int perek, int pasuk, int section = 7, int range = 11) =>
        MoedDisplayRow.PasukRow(section, new Pasuk { PasukNum = pasuk, Text = "א" },
            perek, 18, 10, 0, int.MaxValue, range);

    [Fact]
    public void Selection_FollowsDisplayOrderWhenAPerekIsRevisited()
    {
        var rows = new[] { Row(1, 1), Row(2, 1), Row(1, 2) };
        var segments = MoedRecitation.SelectedSegments(rows,
            [(1, 2), (1, 1), (2, 1)], _ => Canonical(), Track, _ => true);

        segments.Select(segment => segment.PerekId).Should().Equal(1, 2, 1);
        segments.SelectMany(segment => segment.Ranges!).Should().Equal((100, 500), (100, 500), (700, 1100));
    }

    [Fact]
    public void Selection_KeepsRepeatedRangesAndTheirHighlightIdentities()
    {
        var rows = new[] { Row(1, 1), Row(1, 2), Row(1, 1, range: 12), Row(1, 1, section: 8, range: 13) };
        var segments = MoedRecitation.SelectedSegments(rows,
            [(1, 1), (1, 2)], _ => Canonical(), Track, _ => true);

        segments.Select(segment => (segment.SectionId, segment.RangeId)).Should().Equal((7, 11), (7, 12), (8, 13));
        segments.Select(segment => segment.Ranges!.Count).Should().Equal(2, 1, 1);
        segments.SelectMany(segment => segment.Ranges!).Should().Equal((100, 500), (700, 1100), (100, 500), (100, 500));
    }

    [Theory]
    [InlineData("no-track")]
    [InlineData("pending")]
    [InlineData("no-text")]
    [InlineData("no-audio")]
    [InlineData("mismatch")]
    [InlineData("no-words")]
    public void Selection_SkipsUnavailableOrUnalignedRows(string condition)
    {
        var segments = MoedRecitation.SelectedSegments(
            [MoedDisplayRow.SectionHeader(7, "header", ""), Row(1, condition == "no-words" ? 3 : 1)],
            [(1, 1), (1, 3)],
            _ => condition == "no-text" ? null : Canonical(),
            id => condition switch
            {
                "no-track" => null,
                "pending" => Track(id) with { AlignmentStatus = "pending" },
                "mismatch" => Track(id) with { TextSha256 = "different" },
                _ => Track(id)
            },
            _ => condition != "no-audio");

        segments.Should().BeEmpty();
    }

    [Fact]
    public void Selection_EmptySelectionHasNoClips()
    {
        MoedRecitation.SelectedSegments([Row(1, 1)], [], _ => Canonical(), Track, _ => true)
            .Should().BeEmpty();
    }
}
