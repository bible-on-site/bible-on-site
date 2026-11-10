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
        ReadingProgressEngine.Fraction([], totalWords: 100, anchorUnitIndex: 0, insideUnitFraction: 0, contentEndVisible: false).Should().Be(0);
        ReadingProgressEngine.Fraction([], totalWords: 100, anchorUnitIndex: 0, insideUnitFraction: 0, contentEndVisible: true).Should().Be(0);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0)]
    public void UnknownTotals_StayAtZero(int? totalWords)
    {
        var units = Units(("1", 30, 30), ("2", 40, 70));
        ReadingProgressEngine.Fraction(units, totalWords, anchorUnitIndex: 1, insideUnitFraction: 0, contentEndVisible: false).Should().Be(0);
    }

    [Fact]
    public void RestPosition_ReadsZero()
    {
        var units = Units(("1", 30, 30), ("2", 40, 70), ("3", 30, 100));
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: 0, insideUnitFraction: 0, contentEndVisible: false).Should().Be(0);
    }

    [Fact]
    public void AnchorUnit_ContributesItsWordsBefore()
    {
        var units = Units(("1", 30, 30), ("2", 40, 70), ("3", 30, 100));
        // Anchored at pasuk 2: only the 30 words of pasuk 1 have passed.
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: 1, insideUnitFraction: 0, contentEndVisible: false)
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
        ReadingProgressEngine.Fraction(units, totalWords: 100, anchorUnitIndex: -5, insideUnitFraction: 0, contentEndVisible: false).Should().Be(0);
        // Beyond the last unit clamps to it: all but the last unit's words passed.
        ReadingProgressEngine.Fraction(units, totalWords: 70, anchorUnitIndex: 99, insideUnitFraction: 0, contentEndVisible: false)
            .Should().BeApproximately(30.0 / 70, 1e-9);
    }

    [Fact]
    public void IndexOfPasuk_ResolvesPasukKeys()
    {
        var pasukUnits = Units(("1", 30, 30), ("2", 40, 70), ("10", 30, 100));
        ReadingProgressEngine.IndexOfPasuk(pasukUnits, 2).Should().Be(1);
        ReadingProgressEngine.IndexOfPasuk(pasukUnits, 10).Should().Be(2);
        ReadingProgressEngine.IndexOfPasuk(pasukUnits, 42).Should().Be(-1);
    }

    #region ScrollView extent variant — counted-child readers (article/entry)

    /// Children span 0–400 (30 words) and 400–1000 (70 words) inside a
    /// 2000-high scrollable body; the viewport is 200.
    private static List<CountedProgressRegion> TwoRegions() =>
        [new(0, 1, 0, 30), new(1, 1, 30, 70)];

    private static List<(double Top, double Bottom)> TwoExtents() => [(0, 400), (400, 1000)];

    [Fact]
    public void ScrollExtent_Rest_ReadsZero()
    {
        ReadingProgressEngine.Fraction(TwoRegions(), totalWords: 100,
            scrollY: 0, viewportHeight: 200, scrollContentHeight: 2000, TwoExtents())
            .Should().Be(0);
    }

    [Fact]
    public void ScrollExtent_MaxScroll_ReadsComplete()
    {
        ReadingProgressEngine.Fraction(TwoRegions(), totalWords: 100,
            scrollY: 1800, viewportHeight: 200, scrollContentHeight: 2000, TwoExtents())
            .Should().Be(1);
    }

    [Fact]
    public void ScrollExtent_IsWordWeighted_NotPixelLinear()
    {
        // scrollY 360/1800 → ratio 0.2 → anchor at 200: halfway through child 0
        // (15 of its 30 words), not 20% of the pixels.
        ReadingProgressEngine.Fraction(TwoRegions(), totalWords: 100,
            scrollY: 360, viewportHeight: 200, scrollContentHeight: 2000, TwoExtents())
            .Should().BeApproximately(0.15, 1e-9);
        // scrollY 900/1800 → ratio 0.5 → anchor at 500: 30 + (100/600)·70 of 100 ≈ 0.417.
        ReadingProgressEngine.Fraction(TwoRegions(), totalWords: 100,
            scrollY: 900, viewportHeight: 200, scrollContentHeight: 2000, TwoExtents())
            .Should().BeApproximately((30.0 + 100.0 / 600 * 70) / 100.0, 1e-9);
    }

    [Fact]
    public void ScrollExtent_BackScrolling_LowersTheFraction()
    {
        var forward = ReadingProgressEngine.Fraction(TwoRegions(), 100,
            scrollY: 1200, viewportHeight: 200, scrollContentHeight: 2000, TwoExtents());
        var back = ReadingProgressEngine.Fraction(TwoRegions(), 100,
            scrollY: 400, viewportHeight: 200, scrollContentHeight: 2000, TwoExtents());
        back.Should().BeLessThan(forward);
    }

    [Fact]
    public void ScrollExtent_NonScrollable_ReadsComplete()
    {
        // ContentHeight <= viewport → the whole body is already in view.
        ReadingProgressEngine.Fraction(TwoRegions(), 100,
            scrollY: 0, viewportHeight: 1200, scrollContentHeight: 1000, TwoExtents())
            .Should().Be(1);
    }

    [Fact]
    public void ScrollExtent_ZeroHeightContent_ReadsComplete()
    {
        ReadingProgressEngine.Fraction(TwoRegions(), 100,
            scrollY: 0, viewportHeight: 200, scrollContentHeight: 2000, [(0, 0), (0, 0)])
            .Should().Be(1);
    }

    [Fact]
    public void ScrollExtent_UnmeasuredContent_StaysZero()
    {
        // scrollContentHeight 0 = the ScrollView has not measured — reporting
        // "complete" here would flash a full bar during first layout.
        ReadingProgressEngine.Fraction(TwoRegions(), 100,
            scrollY: 0, viewportHeight: 200, scrollContentHeight: 0, TwoExtents())
            .Should().Be(0);
    }

    [Fact]
    public void ScrollExtent_ChromeStaysOffTheAxis()
    {
        // A 500px header above the counted region and a footer below: the
        // anchor still sweeps exactly the counted extent, so progress is 0
        // while the header holds the viewport and 1 at content end.
        var regions = TwoRegions();
        var extents = new List<(double Top, double Bottom)> { (500, 900), (900, 1500) };
        ReadingProgressEngine.Fraction(regions, 100,
            scrollY: 0, viewportHeight: 200, scrollContentHeight: 2500, extents)
            .Should().Be(0, "the anchor sits at the counted top at rest");
        ReadingProgressEngine.Fraction(regions, 100,
            scrollY: 2300, viewportHeight: 200, scrollContentHeight: 2500, extents)
            .Should().Be(1, "max scroll drives the anchor to the counted bottom");
    }

    [Fact]
    public void ScrollExtent_MediaGap_DoesNotAdvanceProgress()
    {
        // Child 1 is media-free text starting at 500; the 400–500 gap is a
        // video — anchors inside it report child 0 fully passed, nothing more.
        var regions = TwoRegions();
        var extents = new List<(double Top, double Bottom)> { (0, 400), (500, 1100) };
        var fraction = ReadingProgressEngine.Fraction(regions, 100,
            scrollY: 720, viewportHeight: 200, scrollContentHeight: 2000, extents);
        // ratio 0.4 → anchor 440 inside the gap → exactly child 0's 30 words.
        fraction.Should().BeApproximately(0.3, 1e-9);
    }

    [Fact]
    public void ScrollExtent_Empty_Inputs_StayAtZero()
    {
        ReadingProgressEngine.Fraction([], 100, 0, 200, 2000, [(0, 100)])
            .Should().Be(0);
        ReadingProgressEngine.Fraction(TwoRegions(), 100, 0, 200, 2000, [])
            .Should().Be(0);
        ReadingProgressEngine.Fraction(TwoRegions(), null, 0, 200, 2000, TwoExtents())
            .Should().Be(0, "a null total with no region words reads 0");
        ReadingProgressEngine.Fraction(TwoRegions(), 0, 0, 200, 2000, TwoExtents())
            .Should().Be(0);
    }

    [Fact]
    public void ScrollExtent_StaleExtents_StayAtZero()
    {
        // Extents measured before every counted child laid out — no honest
        // axis exists yet, so nothing reports rather than a fabricated read.
        ReadingProgressEngine.Fraction(TwoRegions(), 100,
            scrollY: 900, viewportHeight: 200, scrollContentHeight: 2000, [(0, 400)])
            .Should().Be(0);
    }

    [Fact]
    public void ScrollExtent_NullTotal_FallsBackToRegionWords()
    {
        // Stored metric row missing but units exist: total = last region's
        // cumulative words — progress still maps correctly.
        ReadingProgressEngine.Fraction(TwoRegions(), null,
            scrollY: 1800, viewportHeight: 200, scrollContentHeight: 2000, TwoExtents())
            .Should().Be(1);
    }

    #endregion
}
