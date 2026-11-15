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
    public void FullyJustifiedLinesHaveNoShortLineAndNoRightGap()
    {
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 0, 99),
            new Line(30, 38, 0, 99));

        Assert.False(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.Equal(0, profile.RightGapRows);
        Assert.Equal(0, profile.LeftGapRows);
    }

    [Fact]
    public void RightAnchoredShortFinalLineCountsAsShortWithoutRightGap()
    {
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 0, 99),
            new Line(30, 38, 55, 99));

        Assert.True(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
        Assert.Equal(0, profile.RightGapRows);
        Assert.Equal(9, profile.LeftGapRows);
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
        Assert.Equal(9, profile.RightGapRows);
        Assert.Equal(0, profile.LeftGapRows);
    }

    [Fact]
    public void SingleRightAnchoredLineCountsAsShortWithoutRightGap()
    {
        var profile = Measure(100, 40, new Line(15, 30, 50, 99));

        Assert.True(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void SingleLeftAnchoredLineReportsTheDefect()
    {
        var profile = Measure(100, 40, new Line(15, 30, 0, 50));

        Assert.True(profile.HasShortFinalLine);
        Assert.True(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void BackgroundOnlyImageHasNoInk()
    {
        var profile = Measure(100, 40);

        Assert.Equal(0, profile.InkRows);
        Assert.False(profile.HasShortFinalLine);
        Assert.False(profile.HasLeftFlushedLine);
    }

    [Fact]
    public void StrayAccentRowUnderAJustifiedLineDoesNotTriggerTheDefect()
    {
        // A lone cantillation mark under the middle of a justified line can
        // form a row whose only ink sits mid-line; up to the threshold of such
        // strays must not read as a left-flushed line.
        var profile = Measure(100, 40,
            new Line(2, 12, 0, 99),
            new Line(16, 26, 0, 99),
            new Line(28, 29, 45, 52));

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
