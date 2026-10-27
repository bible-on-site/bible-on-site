using BibleOnSite.Helpers;
using BibleOnSite.Models;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Word-weighted reading-position fractions over the stored unit metrics
/// (#2607) — item-granularity twin of the website's anchor rule: units before
/// the anchor count fully, the tail-in-viewport end state reads complete,
/// and unknown totals never invent percentages.
/// </summary>
public sealed class ReadingProgressEngineTests
{
    private static List<ReadingProgressUnit> Units(params (string Key, int Words, int Cumulative)[] rows) =>
        rows.Select(r => new ReadingProgressUnit
        {
            Key = r.Key,
            WordCount = r.Words,
            CumulativeWords = r.Cumulative
        }).ToList();

    [Fact]
    public void EmptyUnits_StayAtZero()
    {
        ReadingProgressEngine.Fraction([], totalWords: 100, anchorUnitIndex: 0).Should().Be(0);
        ReadingProgressEngine.Fraction([], totalWords: 100, anchorUnitIndex: 0, insideUnitFraction: 0, contentEndVisible: true).Should().Be(0);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    public void UnknownTotals_StayAtZero(int? totalWords)
    {
        var units = Units(("1", 30, 30), ("2", 40, 70));
        ReadingProgressEngine.Fraction(units, totalWords, anchorUnitIndex: 1).Should().Be(0);
    }

    [Fact]
    public void RestPosition_ReadsZero()
    {
        var units = Units(("1", 30, 30), ("2", 40, 70), ("3", 30, 100));
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: 0).Should().Be(0);
    }

    [Fact]
    public void AnchorUnit_ContributesItsWordsBefore()
    {
        var units = Units(("1", 30, 30), ("2", 40, 70), ("3", 30, 100));
        // Anchored at pasuk 2: only the 30 words of pasuk 1 have passed.
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: 1)
            .Should().BeApproximately(0.3, 1e-9);
    }

    [Fact]
    public void InsideUnitFraction_InterpolatesTheAnchorUnitsWords()
    {
        var units = Units(("1", 30, 30), ("2", 40, 70), ("3", 30, 100));
        // Halfway through pasuk 2: 30 + 20 of 100 words.
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: 1, insideUnitFraction: 0.5, contentEndVisible: false)
            .Should().BeApproximately(0.5, 1e-9);
    }

    [Fact]
    public void ContentTailInViewport_ReadsComplete()
    {
        var units = Units(("1", 30, 30), ("2", 40, 70), ("3", 30, 100));
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: 0, insideUnitFraction: 0, contentEndVisible: true)
            .Should().Be(1);
    }

    [Fact]
    public void OutOfRangeAnchors_ClampIntoTheUnitList()
    {
        var units = Units(("1", 30, 30), ("2", 40, 70));
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: -5).Should().Be(0);
        // Beyond the last unit clamps to it: all but the last unit's words passed.
        ReadingProgressEngine.Fraction(units, totalWords: 70, anchorUnitIndex: 99)
            .Should().BeApproximately(30.0 / 70, 1e-9);
    }

    [Fact]
    public void IndexOfPasuk_ResolvesPasukAndNoteKeys()
    {
        var pasukUnits = Units(("1", 30, 30), ("2", 40, 70), ("10", 30, 100));
        ReadingProgressEngine.IndexOfPasuk(pasukUnits, 2).Should().Be(1);
        ReadingProgressEngine.IndexOfPasuk(pasukUnits, 10).Should().Be(2);
        ReadingProgressEngine.IndexOfPasuk(pasukUnits, 42).Should().Be(-1);

        var noteUnits = Units(("1:0", 10, 10), ("1:1", 10, 20), ("2:0", 40, 60));
        ReadingProgressEngine.IndexOfPasuk(noteUnits, 1).Should().Be(0);
        ReadingProgressEngine.IndexOfPasuk(noteUnits, 2).Should().Be(2);
        ReadingProgressEngine.IndexOfPasuk(noteUnits, 3).Should().Be(-1);
    }
}
