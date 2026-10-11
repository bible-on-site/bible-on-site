using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

public class MasoraUnitTextTests
{
    private static MasoraUnit Unit(params MasoraUnitRange[] ranges) => new()
    {
        UnitId = 1,
        Slug = "1",
        SeferId = 1,
        SeferName = "בראשית",
        UnitOrder = 1,
        Heading = "בראשית א א",
        Ranges = ranges.ToList()
    };

    private static MasoraUnitRange Range(int startPerek, int startPasuk, int? startSeg,
        int endPerek, int endPasuk, int? endSeg) => new()
        {
            StartPerekId = startPerek,
            StartPasuk = startPasuk,
            StartSegmentIndex = startSeg,
            EndPerekId = endPerek,
            EndPasuk = endPasuk,
            EndSegmentIndex = endSeg
        };

    private static Pasuk PasukOf(int num, params PasukSegment[] segments) =>
        new() { PasukNum = num, Text = string.Join(' ', segments.Select(s => s.Value)), Segments = segments.ToList() };

    private static PasukSegment Word(string value) => new() { Type = SegmentType.Ktiv, Value = value };

    [Fact]
    public void PerekSlicesForRange_SamePerek_ReturnsSingleBoundedSlice()
    {
        var slices = MasoraUnitText.PerekSlicesForRange(Range(1, 3, null, 1, 7, null));

        slices.Should().ContainSingle().Which.Should().BeEquivalentTo(new
        {
            PerekId = 1,
            StartPasuk = 3,
            EndPasuk = 7,
            StartSegmentIndex = (int?)null,
            EndSegmentIndex = (int?)null
        });
    }

    [Fact]
    public void PerekSlicesForRange_CrossPerek_FillsInteriorPerakimWhole()
    {
        var slices = MasoraUnitText.PerekSlicesForRange(Range(1, 20, null, 3, 5, null));

        slices.Should().HaveCount(3);
        slices[0].PerekId.Should().Be(1);
        slices[0].StartPasuk.Should().Be(20);
        slices[0].EndPasuk.Should().Be(int.MaxValue); // through perek end
        slices[1].PerekId.Should().Be(2);
        slices[1].StartPasuk.Should().Be(1);
        slices[1].EndPasuk.Should().Be(int.MaxValue);
        slices[2].PerekId.Should().Be(3);
        slices[2].EndPasuk.Should().Be(5);
    }

    [Fact]
    public void PerekSlicesForRange_IntraPasukBounds_AttachOnlyToBoundaryPerakim()
    {
        var slices = MasoraUnitText.PerekSlicesForRange(Range(1, 5, 2, 2, 3, 4));

        slices.Should().HaveCount(2);
        slices[0].StartSegmentIndex.Should().Be(2);
        slices[0].EndSegmentIndex.Should().BeNull();
        slices[1].StartSegmentIndex.Should().BeNull();
        slices[1].EndSegmentIndex.Should().Be(4);
    }

    [Fact]
    public void PerekIdsForUnit_MultiRange_KeepsFirstAppearanceOrder()
    {
        var unit = Unit(Range(5, 1, null, 6, 2, null), Range(9, 4, null, 9, 8, null));

        MasoraUnitText.PerekIdsForUnit(unit).Should().Equal(5, 6, 9);
    }

    [Fact]
    public void IsMultiPerek_DetectsCrossingUnits()
    {
        MasoraUnitText.IsMultiPerek(Unit(Range(1, 1, null, 2, 1, null))).Should().BeTrue();
        MasoraUnitText.IsMultiPerek(Unit(Range(1, 1, null, 1, 9, null))).Should().BeFalse();
    }

    [Fact]
    public void ClipPasuk_StartSegment_DropsLeadingSegments()
    {
        var pasuk = PasukOf(1, Word("בראשית"), Word("ברא"), Word("אלהים"));

        var clipped = MasoraUnitText.ClipPasuk(pasuk, 1, null);

        clipped.Segments.Should().HaveCount(2);
        clipped.Text.Should().Be("ברא אלהים");
        clipped.PasukNum.Should().Be(1);
    }

    [Fact]
    public void ClipPasuk_EndSegment_DropsTrailingSegments_AndBreaks()
    {
        var pasuk = PasukOf(1,
            Word("אחד"), Word("שניים"),
            new PasukSegment { Type = SegmentType.Stuma, Value = "ס" },
            Word("שלושה"));

        var clipped = MasoraUnitText.ClipPasuk(pasuk, null, 2);

        clipped.Segments.Should().HaveCount(3);
        clipped.Text.Should().Be("אחד שניים");
    }

    [Fact]
    public void ClipPasuk_StartAndEnd_KeepsMiddleSlice()
    {
        var pasuk = PasukOf(1, Word("א"), Word("ב"), Word("ג"), Word("ד"));

        var clipped = MasoraUnitText.ClipPasuk(pasuk, 1, 2);

        clipped.Segments.Select(s => s.Value).Should().Equal("ב", "ג");
    }

    [Fact]
    public void BuildText_JoinsLikePerekReader_NewlinesAndMaqaf()
    {
        var segments = new List<PasukSegment>
        {
            Word("בראשית"), Word("ברא־"),
            new PasukSegment { Type = SegmentType.Ptuha, Value = "פ" },
            Word("אלהים")
        };

        // Space skipped after maqaf, no double newline after a break, no space after newline.
        MasoraUnitText.BuildText(segments).Should().Be("בראשית ברא־\nאלהים");
    }

    [Fact]
    public async Task BuildRows_SamePerekUnit_NoPerekLabels()
    {
        var unit = Unit(Range(1, 1, null, 1, 2, null));
        var pasukim = new List<Pasuk> { PasukOf(1, Word("א")), PasukOf(2, Word("ב")), PasukOf(3, Word("ג")) };

        var rows = await MasoraUnitText.BuildRowsAsync(unit, _ => Task.FromResult(pasukim), _ => "בראשית א", 1.0);

        rows.Should().HaveCount(2);
        rows.Should().OnlyContain(r => !r.HasPerekLabel);
        rows.Select(r => r.PasukNum).Should().Equal(1, 2);
        rows[0].FontSize.Should().Be(PasukDisplayItems.PasukFontSizeBase);
    }

    [Fact]
    public async Task BuildRows_CrossPerekUnit_LabelsFirstRowOfEachPerek()
    {
        var unit = Unit(Range(1, 2, null, 2, 1, null));
        var perakim = new Dictionary<int, List<Pasuk>>
        {
            [1] = new() { PasukOf(1, Word("א")), PasukOf(2, Word("ב")) },
            [2] = new() { PasukOf(1, Word("ג")) }
        };

        var rows = await MasoraUnitText.BuildRowsAsync(
            unit, id => Task.FromResult(perakim[id]), id => $"ספר {id}", 1.0);

        rows.Should().HaveCount(2);
        rows[0].PerekLabel.Should().Be("ספר 1");
        rows[1].PerekLabel.Should().Be("ספר 2");
        rows[1].PerekId.Should().Be(2);
    }

    [Fact]
    public async Task BuildRows_IntraPasukUnit_ClipsBoundaryPasuk()
    {
        var unit = Unit(Range(1, 1, 1, 1, 1, null));
        var pasukim = new List<Pasuk> { PasukOf(1, Word("א"), Word("ב"), Word("ג")) };

        var rows = await MasoraUnitText.BuildRowsAsync(unit, _ => Task.FromResult(pasukim), _ => null, 1.0);

        rows.Should().ContainSingle();
        rows[0].Pasuk.Segments.Select(s => s.Value).Should().Equal("ב", "ג");
    }

    [Fact]
    public async Task BuildRows_SinglePerekSliceInsideMultiPerekUnit_KeepsPerPerekScoping()
    {
        // Unit covering only the tail of perek 1 (a unit that starts mid-perek).
        var unit = Unit(Range(1, 2, null, 1, 3, null));
        var pasukim = new List<Pasuk> { PasukOf(1, Word("א")), PasukOf(2, Word("ב")), PasukOf(3, Word("ג")) };

        var rows = await MasoraUnitText.BuildRowsAsync(unit, _ => Task.FromResult(pasukim), _ => "בראשית א", 1.0);

        rows.Select(r => r.PasukNum).Should().Equal(2, 3);
        // Single-perek unit → no perek labels even though it starts mid-perek.
        rows.Should().OnlyContain(r => !r.HasPerekLabel);
    }
}
