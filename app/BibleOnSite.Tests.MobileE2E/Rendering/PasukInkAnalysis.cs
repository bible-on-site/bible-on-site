using StbImageSharp;

namespace BibleOnSite.Tests.MobileE2E.Rendering;

/// <summary>
/// Measures where text ink lands inside a captured PasukText element so a test
/// can assert the rendered short-line direction, not just declared properties.
/// A justified line always draws ink up to the right text edge; a short final
/// line must anchor to that same right edge for RTL (#3380). On the defect's
/// rendering the short line flushes left instead, leaving a right-side gap —
/// detected here as rows whose ink never reaches the edge.
/// </summary>
internal static class PasukInkAnalysis
{
    /// <summary>
    /// A captured element's per-line ink coverage summary.
    /// </summary>
    /// <param name="InkRows">Rows containing any text ink.</param>
    /// <param name="RightGapRows">Rows whose ink stops short of the right edge —
    /// the signature of a left-flushed short line (the #3380 defect).</param>
    /// <param name="LeftGapRows">Rows whose ink starts right of the left edge —
    /// the signature of a correctly right-anchored short line.</param>
    public sealed record InkProfile(int InkRows, int RightGapRows, int LeftGapRows)
    {
        /// <summary>At least one real line left a right-side ink gap — the defect.</summary>
        public bool HasLeftFlushedLine => RightGapRows >= Math.Max(3, InkRows / 12);

        /// <summary>The element rendered a short final line worth verifying.</summary>
        public bool HasShortFinalLine => RightGapRows + LeftGapRows >= 5;
    }

    // Ink is whatever deviates enough in luminance from the sampled background,
    // so dark text on parchment, a muted {פ}/{ס} marker, a highlight tint or an
    // inverted dark theme all still count.
    private const double MinInkDeviation = 0.18;

    // A reached edge still keeps a few pixels clear: antialiasing fades and
    // glyph side bearings sit inside the advance, so "edge" means within this
    // width-scaled band.
    private const double RightEdgeFraction = 0.06;
    private const double LeftEdgeFraction = 0.12;
    private const int EdgeTolerancePixels = 8;

    public static InkProfile Measure(byte[] pngBytes)
    {
        var image = ImageResult.FromMemory(pngBytes, ColorComponents.RedGreenBlueAlpha);
        return MeasurePixels(image.Width, image.Height, image.Data);
    }

    // Unit tests feed synthetic RGBA buffers here directly so the analysis is
    // exercised without a PNG round-trip.
    internal static InkProfile MeasurePixels(int width, int height, byte[] rgba)
    {
        var background = BackgroundLuminance(width, height, rgba);
        var rightEdge = width - Math.Max(EdgeTolerancePixels, (int)(width * RightEdgeFraction));
        var leftEdge = Math.Max(EdgeTolerancePixels, (int)(width * LeftEdgeFraction));
        int inkRows = 0, rightGapRows = 0, leftGapRows = 0;
        for (var y = 0; y < height; y++)
        {
            var row = y * width * 4;
            int left = -1, right = -1;
            for (var x = 0; x < width; x++)
            {
                if (IsInk(rgba, row + x * 4, background))
                {
                    left = x;
                    break;
                }
            }
            if (left < 0)
            {
                continue;
            }
            for (var x = width - 1; x > left; x--)
            {
                if (IsInk(rgba, row + x * 4, background))
                {
                    right = x;
                    break;
                }
            }
            if (right < 0)
            {
                right = left;
            }
            inkRows++;
            if (right < rightEdge)
            {
                rightGapRows++;
            }
            else if (left > leftEdge)
            {
                leftGapRows++;
            }
        }
        return new InkProfile(inkRows, rightGapRows, leftGapRows);
    }

    private static bool IsInk(byte[] rgba, int offset, double background) =>
        Math.Abs(Luminance(rgba, offset) - background) > MinInkDeviation;

    private static double Luminance(byte[] rgba, int offset) =>
        (rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114) / 255.0;

    private static double BackgroundLuminance(int width, int height, byte[] rgba)
    {
        // Pasuk ink never covers every edge sample at once, so the median of a
        // spread of border pixels is the label's background — a highlight tint
        // counts as background too when the whole element is highlighted.
        var right = width - 1;
        var bottom = height - 1;
        Span<int> points =
        [
            0, right, bottom * width, bottom * width + right,
            right / 2, bottom * width + right / 2,
            bottom / 2 * width, bottom / 2 * width + right,
        ];
        Span<double> samples = stackalloc double[8];
        for (var i = 0; i < points.Length; i++)
        {
            samples[i] = Luminance(rgba, points[i] * 4);
        }
        samples.Sort();
        return (samples[3] + samples[4]) / 2;
    }
}
