using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// MoedUnitText (#3261): the moed's ordered labelled sections decompose into
/// canonical per-perek slices and clipped display rows — section/range order
/// preserved, deliberate range repeats kept, no scripture copied.
/// </summary>
public class MoedUnitTextTests
{
    private static MoedRange Range(int position, int startPerek, int startPasuk,
        int endPerek, int endPasuk) => new()
        {
            Id = position,
            Position = position,
            StartPerekId = startPerek,
            StartPasuk = startPasuk,
            EndPerekId = endPerek,
            EndPasuk = endPasuk
        };

    private static MoedSection Section(int id, int position, string label, params MoedRange[] ranges) =>
        new() { Id = id, Position = position, Label = label, Ranges = ranges.ToList() };

    private static MoedUnit Moed(params MoedSection[] sections) => new()
    {
        Id = 1,
        Slug = "tisha-bav",
        Name = "תשעה באב",
        Sections = sections.ToList()
    };

    private static Pasuk PasukOf(int num, params PasukSegment[] segments) =>
        new() { PasukNum = num, Text = string.Join(' ', segments.Select(s => s.Value)), Segments = segments.ToList() };

    private static PasukSegment Word(string value) => new() { Type = SegmentType.Ktiv, Value = value };

    private static Func<int, Task<List<Pasuk>>> LoaderFor(params (int PerekId, int Count)[] perakim) =>
        perekId =>
        {
            var (_, count) = perakim.Single(p => p.PerekId == perekId);
            return Task.FromResult(Enumerable.Range(1, count)
                .Select(n => PasukOf(n, Word($"w{n}")))
                .ToList());
        };

    private static string? PerekSource(int perekId) => perekId switch
    {
        1 => "בראשית א",
        2 => "בראשית ב",
        3 => "בראשית ג",
        700 => "איכה א",
        _ => null
    };

    private static (string SeferName, int PerekNumber, int? Additional)? PerekInfo(int perekId) =>
        perekId switch
        {
            1 => ("בראשית", 1, null),
            2 => ("בראשית", 2, null),
            3 => ("בראשית", 3, null),
            700 => ("איכה", 1, null),
            _ => null
        };

    [Fact]
    public void PerekSlicesForSection_DecomposesOrderedRanges_InDeclaredOrder()
    {
        var section = Section(1, 1, "קריאה", Range(1, 2, 3, 2, 5), Range(2, 1, 1, 1, 4));

        var slices = MoedUnitText.PerekSlicesForSection(section);

        // Slices follow the DB's declared range order, not perek order.
        slices.Select(s => (s.PerekId, s.StartPasuk, s.EndPasuk)).Should().Equal(
            (2, 3, 5), (1, 1, 4));
    }

    [Fact]
    public void PerekSlicesForSection_OrdersRangesByPosition_NotListOrder()
    {
        var section = Section(1, 1, "קריאה", Range(2, 1, 1, 1, 4), Range(1, 2, 3, 2, 5));

        // Position 1 reads before position 2 regardless of payload order.
        MoedUnitText.PerekSlicesForSection(section).Select(s => s.PerekId)
            .Should().Equal(2, 1);
    }

    [Fact]
    public void PerekSlicesForUnit_FlattensSectionsInPositionOrder()
    {
        var moed = Moed(
            Section(2, 2, "מפטיר", Range(1, 3, 1, 3, 3)),
            Section(1, 1, "קריאת התורה", Range(1, 1, 1, 2, 4)));

        var slices = MoedUnitText.PerekSlicesForUnit(moed);

        // Section 2's ranges follow section 1's — the API's wheel order wins.
        slices.Select(s => (s.PerekId, s.StartPasuk, s.EndPasuk)).Should().Equal(
            (1, 1, int.MaxValue), (2, 1, 4), (3, 1, 3));
    }

    [Fact]
    public void PerekIdsForUnit_DedupesRepeatedPerakim_InFirstAppearanceOrder()
    {
        var moed = Moed(
            Section(1, 1, "קריאה", Range(1, 1, 1, 2, 4)),
            // מפטיר-style repeat: the second section re-reads the same perek's tail.
            Section(2, 2, "מפטיר", Range(1, 2, 2, 2, 4)));

        MoedUnitText.PerekIdsForUnit(moed).Should().Equal(1, 2);
    }

    [Fact]
    public void SectionRefsText_JoinsTheSectionRanges_InDeclaredOrder()
    {
        var section = Section(1, 1, "קריאה", Range(2, 1, 2, 1, 10), Range(1, 1, 3, 1, 8));

        var refs = MoedUnitText.SectionRefsText(section, PerekSource, PerekInfo);

        refs.Should().Be("בראשית א ג-ח · בראשית א ב-י");
    }

    [Fact]
    public void SectionRefsText_CrossSeferRange_NamesBothPerakim()
    {
        var section = Section(1, 1, "קריאה", Range(1, 700, 1, 1, 5));

        var refs = MoedUnitText.SectionRefsText(section, PerekSource, PerekInfo);

        refs.Should().Be("איכה א א - בראשית א ה");
    }

    [Fact]
    public async Task BuildRows_EmitsSectionHeader_ThenPerPerekSubheadersAndClippedRows()
    {
        var moed = Moed(
            Section(7, 1, "מגילה", Range(1, 1, 2, 2, 2)),
            Section(8, 2, "הפטרה", Range(1, 3, 1, 3, 1)));

        var rows = await MoedUnitText.BuildRowsAsync(moed,
            LoaderFor((1, 5), (2, 5), (3, 3)), PerekSource, PerekInfo, fontFactor: 1.0);

        rows[0].IsSectionHeader.Should().BeTrue();
        rows[0].SectionId.Should().Be(7);
        rows[0].Text.Should().Be("מגילה");
        rows[1].IsPerekHeader.Should().BeTrue();
        rows[1].Text.Should().Be("בראשית א");
        // Range 1:2..2:2 → perek 1 pesukim 2..5, then perek 2 pesukim 1..2.
        rows.Skip(2).Take(4).Select(r => (r.PerekId, r.PasukNum))
            .Should().Equal((1, 2), (1, 3), (1, 4), (1, 5));
        rows[6].IsPerekHeader.Should().BeTrue();
        rows[6].Text.Should().Be("בראשית ב");
        rows.Skip(7).Take(2).Select(r => (r.PerekId, r.PasukNum))
            .Should().Equal((2, 1), (2, 2));
        rows[9].IsSectionHeader.Should().BeTrue();
        rows[9].Text.Should().Be("הפטרה");
        rows[11].PasukNum.Should().Be(1);
        rows.Should().HaveCount(12);
    }

    [Fact]
    public async Task BuildRows_RepeatedRange_RendersItsRowsTwice_InPlace()
    {
        var moed = Moed(Section(7, 1, "קריאה", Range(1, 1, 1, 1, 2), Range(2, 1, 1, 1, 2)));

        var rows = await MoedUnitText.BuildRowsAsync(moed,
            LoaderFor((1, 4)), PerekSource, PerekInfo, fontFactor: 1.0);

        var pesukim = rows.Where(r => r.Pasuk != null).Select(r => (r.PerekId, r.PasukNum)).ToList();
        // A curated repeated range reads twice — מפטיר repeats, alternative readings stay.
        pesukim.Should().Equal((1, 1), (1, 2), (1, 1), (1, 2));
    }

    [Fact]
    public async Task BuildRows_RangeClipBounds_StayOnTheRow()
    {
        // A range bounded inside the perek clips to whole pesukim — the API's
        // contract is pasuk-granular, so both clip indexes stay at the edges.
        var moed = Moed(Section(7, 1, "קריאה", Range(1, 1, 2, 1, 3)));

        var rows = await MoedUnitText.BuildRowsAsync(moed,
            LoaderFor((1, 5)), PerekSource, PerekInfo, fontFactor: 1.0);

        var pesukim = rows.Where(r => r.Pasuk != null).ToList();
        pesukim.Select(r => r.PasukNum).Should().Equal(2, 3);
        pesukim.Should().OnlyContain(r => r.ClipStartIndex == 0 && r.ClipEndIndex == int.MaxValue,
            "the moed API has no segment granularity — every row reads its whole pasuk");
    }
}
