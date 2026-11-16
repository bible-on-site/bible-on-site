using Xunit;

namespace BibleOnSite.Tests.MobileE2E.Rendering;

[Trait("Category", "Unit")]
public sealed class PasukInkAnalysisTests
{
    private static readonly byte[] Parchment = [0xF8, 0xEF, 0xD8, 0xFF];
    private static readonly byte[] Ink = [0x33, 0x29, 0x1F, 0xFF];

    // Each entry is an ink run: (top row, bottom row inclusive, left, right).
    private sealed record Line(int Top, int Bottom, int Left, int Right);

    private static byte[] BuildPixels(int width, int height, params Line[] lines)
    {
        var rgba = new byte[width * height * 4];
        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                Parchment.CopyTo(rgba, (y * width + x) * 4);
            }
        }
        foreach (var line in lines)
        {
            for (var y = line.Top; y <= line.Bottom && y < height; y++)
            {
                for (var x = line.Left; x <= line.Right && x < width; x++)
                {
                    Ink.CopyTo(rgba, (y * width + x) * 4);
                }
            }
        }
        return rgba;
    }

    private static PasukInkAnalysis.InkProfile Measure(int width, int height, params Line[] lines) =>
        PasukInkAnalysis.MeasurePixels(width, height, BuildPixels(width, height, lines));

    [Fact]
    public void FullyJustifiedLinesHaveNoShortFinalLineAndNoDefect()
    {
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 0, 99),
            new Line(30, 38, 0, 99));

        Assert.False(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.Equal("full", profile.LastLine);
        Assert.Equal("full,full,full", profile.BandKinds);
        Assert.Equal(3, profile.LineBands);
    }

    [Fact]
    public void RightAnchoredShortFinalLineQualifiesWithoutDefect()
    {
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 0, 99),
            new Line(30, 38, 55, 99));

        Assert.True(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.False(profile.HasMissingLines);
        Assert.Equal("right", profile.LastLine);
    }

    [Fact]
    public void LeftFlushedShortFinalLineReportsTheDefect()
    {
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 0, 99),
            new Line(30, 38, 0, 45));

        Assert.True(profile.HasShortFinalLine);
        Assert.True(profile.HasLeftFlushedLine);
        Assert.Equal("left", profile.LastLine);
    }

    [Fact]
    public void SingleRightAnchoredLineQualifiesWithoutDefect()
    {
        var profile = Measure(100, 40, new Line(15, 30, 50, 99));

        Assert.True(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.Equal("right", profile.LastLine);
    }

    [Fact]
    public void SingleLeftAnchoredLineReportsTheDefect()
    {
        var profile = Measure(100, 40, new Line(15, 30, 0, 50));

        Assert.True(profile.HasShortFinalLine);
        Assert.True(profile.HasLeftFlushedLine);
        Assert.Equal("left", profile.LastLine);
    }

    [Fact]
    public void BackgroundOnlyImageHasNoInk()
    {
        var profile = Measure(100, 40);

        Assert.Equal(0, profile.InkRows);
        Assert.Equal("none", profile.LastLine);
        Assert.False(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.False(profile.HasMissingLines);
    }

    [Fact]
    public void SparseMarkRowsInsideAFullLineNeverReadAsLeftFlushed()
    {
        // The real CI failure family: a justified line's taamim/nikud rows
        // begin at the left edge yet stop far short of the right edge. Judged
        // per row they look like left-flushed lines; banded with their line
        // they are absorbed into the line's full-width bounds.
        var profile = Measure(100, 40,
            new Line(2, 4, 0, 99),
            new Line(5, 7, 0, 45),
            new Line(8, 12, 0, 99),
            new Line(16, 26, 0, 99),
            new Line(30, 38, 55, 99));

        Assert.Equal("full,full,right", profile.BandKinds);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.True(profile.HasShortFinalLine);
    }

    [Fact]
    public void DetachedAccentClusterBelowTheLastLineStaysFloating()
    {
        // A short detached cluster of marks below a right-anchored final line
        // is too few rows to be a text line, so it cannot fabricate the defect
        // or shadow the real last line from the verdict.
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 55, 99),
            new Line(30, 33, 0, 60));

        Assert.Equal("full,right,floating", profile.BandKinds);
        Assert.Equal("right", profile.LastLine);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.True(profile.HasShortFinalLine);
    }

    [Fact]
    public void InteriorLeftFragmentDoesNotFlagWhenLastLineIsRight()
    {
        // Interior bands of a justified paragraph are definitionally full; a
        // left-anchored band above the last line is overlay/stray ink, not the
        // #3380 signature, and must not fail the element.
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 45),
            new Line(16, 26, 0, 99),
            new Line(30, 38, 55, 99));

        Assert.Equal("left", profile.BandKinds.Split(',')[0]);
        Assert.Equal("right", profile.LastLine);
        Assert.False(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void MergedBandHidingALeftFlushedTailFlagsViaTrailingRun()
    {
        // When line spacing is too tight for bands to split, a justified line
        // merges with a left-flushed final line and the band reads "full",
        // masking the defect. The trailing run of right-gap rows still exposes
        // the final line's own anchor.
        var profile = Measure(100, 50,
            new Line(2, 24, 0, 99),
            new Line(25, 44, 0, 45));

        Assert.Equal("full", profile.LastLine);
        Assert.True(profile.TrailingLeftRun);
        Assert.True(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void MergedBandWithRightAnchoredTailDoesNotFlag()
    {
        var profile = Measure(100, 50,
            new Line(2, 24, 0, 99),
            new Line(25, 44, 55, 99));

        Assert.Equal("full", profile.LastLine);
        Assert.False(profile.TrailingLeftRun);
        Assert.False(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void MultiLineElementWithEmptyTailReportsMissingLines()
    {
        // If TextKit lays out fewer lines than the label was measured for, the
        // drawn text stops high and leaves an empty tail at the bottom.
        var profile = Measure(100, 60,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 0, 99));

        Assert.True(profile.HasMissingLines);
    }

    [Fact]
    public void SingleShortLineSkipsTheMissingLineCheck()
    {
        // A one-line pasuk element keeps slack below its only line by design,
        // so even a large empty tail is not a missing-line signal there.
        var profile = Measure(100, 60, new Line(10, 24, 50, 99));

        Assert.False(profile.HasMissingLines);
    }

    [Fact]
    public void MidAnchoredLineIsUnverifiableNotADefect()
    {
        // A text band that reaches neither edge cannot confirm an RTL anchor.
        // It is neither the defect signature nor a qualifying short line.
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 30, 80));

        Assert.Equal("floating", profile.LastLine);
        Assert.False(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void ShortSliverStaysBelowTheTextGate()
    {
        // A clipped sliver of a line has too few rows to be a text band.
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(30, 33, 50, 99));

        Assert.Equal("full,floating", profile.BandKinds);
        Assert.Equal("full", profile.LastLine);
        Assert.False(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void LightInkOnDarkBackgroundStillCountsAsInk()
    {
        // An inverted theme must not silently empty the analysis: light ink on
        // a dark field deviates from the sampled background just as much.
        var rgba = new byte[100 * 40 * 4];
        byte[] dark = [0x20, 0x1A, 0x14, 0xFF];
        byte[] light = [0xE8, 0xE0, 0xD0, 0xFF];
        for (var i = 0; i < rgba.Length; i += 4)
        {
            dark.CopyTo(rgba, i);
        }
        for (var y = 15; y <= 30; y++)
        {
            for (var x = 50; x <= 99; x++)
            {
                light.CopyTo(rgba, (y * 100 + x) * 4);
            }
        }

        var profile = PasukInkAnalysis.MeasurePixels(100, 40, rgba);

        Assert.True(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
    }
}
