using StbImageSharp;

namespace BibleOnSite.Tests.MobileE2E.Rendering;

/// <summary>
/// Measures where text ink lands inside a captured PasukText element so a test
/// can assert the rendered short-line direction, not just declared properties.
/// Rows are grouped into line bands before judging edges: Hebrew taamim and
/// nikud scatter sparse rows through a justified line that begin near the left
/// edge yet never reach the right, so a per-row verdict fabricates left-flush
/// defects the rendered text does not have. A whole line band's bounds — its
/// dense rows carry the letters, its sparse rows are marks that stay inside
/// the band — is the unit that separates a real left-flushed line from accent
/// noise. A justified line always draws ink up to the right text edge; a short
/// final line must anchor to that same right edge for RTL (#3380).
/// </summary>
internal static class PasukInkAnalysis
{
    /// <summary>
    /// A captured element's ink-line summary.
    /// </summary>
    /// <param name="InkRows">Rows containing any ink.</param>
    /// <param name="Bands">Ink bands found (rows grouped across small
    /// vertical gaps).</param>
    /// <param name="LineBands">Bands tall, dense and wide enough to be a
    /// rendered text line — detached accent clusters and overlay fragments
    /// stay below the gate.</param>
    /// <param name="BandKinds">Comma-separated anchor class per band, in row
    /// order: "full" (reaches both edges — justified), "right" (right-anchored
    /// short), "left" (left-flushed short — the #3380 defect), "floating"
    /// (below the text gate or reaching neither edge).</param>
    /// <param name="LastLine">Anchor class of the last text line band —
    /// "full"/"right"/"left"/"floating", or "none" when no band passed the
    /// text gate.</param>
    /// <param name="TrailingLeftRun">True when the rows ending at the last
    /// inked row form a tall, dense, left-anchored run that stops short of the
    /// right edge — catches a left-flushed last line that merged into the band
    /// above when inter-line spacing is too tight to split.</param>
    /// <param name="EmptyTailRows">Element rows below the last row containing
    /// any ink.</param>
    /// <param name="Height">Captured element height in pixels.</param>
    /// <param name="MaxBandRows">Row count of the tallest text band — a full
    /// rendered line's height inside this element; a tail at least that tall
    /// could hide a dropped line even under a single band.</param>
    public sealed record InkProfile(int InkRows, int Bands, int LineBands, string BandKinds,
        string LastLine, bool TrailingLeftRun, int EmptyTailRows, int Height, int MaxBandRows)
    {
        /// <summary>
        /// The final text line flushed left — the #3380 defect. Interior bands
        /// are justified lines by construction, so only the last line band (or
        /// a merged-band trailing run) can carry the signature.
        /// </summary>
        public bool HasLeftFlushedLine => LastLine == "left" || TrailingLeftRun;

        /// <summary>The element rendered a short final line worth verifying.</summary>
        public bool HasShortFinalLine => LastLine is "right" or "left";

        /// <summary>
        /// The typesetter drew fewer lines than the label measured for, leaving
        /// the element's bottom empty — PasukUILabel draws through TextKit while
        /// UILabel measures, so a real mismatch would surface as missing text.
        /// A correct last line's slack stays small even without descenders; a
        /// single band still flags when the tail could hold another whole
        /// line, which is the same mismatch with only one line drawn. No line
        /// bands at all is the extreme mismatch — the draw produced nothing
        /// the gate recognizes, and the tail swallows the element.
        /// </summary>
        public bool HasMissingLines =>
            EmptyTailRows > Math.Max(14, (int)(Height * 0.30))
            && (LineBands >= 2 || LineBands == 0
                || (LineBands == 1 && EmptyTailRows >= MaxBandRows));
    }

    // Ink is whatever deviates enough in luminance from the sampled background,
    // so dark text on parchment, a muted {פ}/{ס} marker, a highlight tint or an
    // inverted dark theme all still count.
    private const double MinInkDeviation = 0.18;

    // A reached edge still keeps a few pixels clear: antialiasing fades and
    // glyph side bearings sit inside the advance, so "edge" means within this
    // width-scaled band. The left gate must stay inside justification slack —
    // a justified line's last word lands on the boundary — because a wider one
    // lets a genuinely short final line (ending a word inside the column)
    // read as "full" and escape verification (#3685: Al Heperek's metrics
    // pushed a line ending 11.9% short of the left edge into the old 12%
    // band, which zeroed the landscape qualifier).
    private const double RightEdgeFraction = 0.06;
    private const double LeftEdgeFraction = 0.04;
    private const int EdgeTolerancePixels = 8;

    // A text line — even a short one — spans a few words; a lone accent mark
    // under a justified line's leftmost letter is much narrower and must not
    // read as a left-flushed line.
    private const double MinLineSpanFraction = 0.05;
    private const int MinLineSpanPixels = 10;

    // Marks sit within a couple of empty rows of their line body while the gap
    // between rendered text lines is wider, so splitting a band only on a run
    // of three or more empty rows keeps accent rows attached to their line and
    // still separates Android's tight line spacing.
    private const int LineGapTolerance = 3;

    // A band must look like a rendered text line — several rows tall, dense,
    // and spanning multiple words — before its edge geometry is judged; a
    // detached accent cluster or an overlay sliver stays "floating".
    private const double MinLineRowsFraction = 0.08;
    private const int MinLineRowsPixels = 8;
    private const double MinLineCoverage = 0.07;

    // The trailing-run backstop for a last line merged into the band above: a
    // real line is a sizable fraction of the element's height, a dangling
    // accent tail is a few sparse rows.
    private const double MinRunRowsFraction = 0.10;
    private const int MinRunRowsPixels = 10;

    public static InkProfile Measure(byte[] pngBytes)
    {
        var image = ImageResult.FromMemory(pngBytes, ColorComponents.RedGreenBlueAlpha);
        return MeasurePixels(image.Width, image.Height, image.Data);
    }

    /// <summary>
    /// Decodes a full-frame capture once so every element's rectangle can be
    /// measured from it. XCUITest's element screenshots come back rotated in
    /// landscape — a 830x36-pt pasuk row arrived as a 104x2490-px portrait
    /// strip — so the test measures element frames inside one correctly
    /// oriented screen capture instead (#3380).
    /// </summary>
    public static ImageResult Decode(byte[] pngBytes) =>
        ImageResult.FromMemory(pngBytes, ColorComponents.RedGreenBlueAlpha);

    /// <summary>
    /// Measures an element's rectangle inside a decoded screen capture — the
    /// same verdict <see cref="Measure(byte[])"/> gives an element screenshot,
    /// without trusting the driver's screenshot orientation. The rectangle is
    /// clamped to the capture, so a frame that overshoots by a rounding pixel
    /// still measures what the element rendered.
    /// </summary>
    public static InkProfile Measure(ImageResult capture, int x, int y, int width, int height)
    {
        x = Math.Clamp(x, 0, capture.Width);
        y = Math.Clamp(y, 0, capture.Height);
        width = Math.Clamp(width, 0, capture.Width - x);
        height = Math.Clamp(height, 0, capture.Height - y);
        if (width <= 0 || height <= 0)
        {
            return new InkProfile(0, 0, 0, string.Empty, "none", false, height, height, 0);
        }
        var rgba = new byte[width * height * 4];
        for (var row = 0; row < height; row++)
        {
            Array.Copy(capture.Data, ((y + row) * capture.Width + x) * 4, rgba, row * width * 4, width * 4);
        }
        return MeasurePixels(width, height, rgba);
    }

    // Unit tests feed synthetic RGBA buffers here directly so the analysis is
    // exercised without a PNG round-trip.
    internal static InkProfile MeasurePixels(int width, int height, byte[] rgba)
    {
        var background = BackgroundLuminance(width, height, rgba);
        var rightEdge = width - Math.Max(EdgeTolerancePixels, (int)(width * RightEdgeFraction));
        var leftEdge = Math.Max(EdgeTolerancePixels, (int)(width * LeftEdgeFraction));
        var minLineSpan = Math.Max(MinLineSpanPixels, (int)(width * MinLineSpanFraction));
        var minLineRows = Math.Max(MinLineRowsPixels, (int)(height * MinLineRowsFraction));
        var minRunRows = Math.Max(MinRunRowsPixels, (int)(height * MinRunRowsFraction));

        var hasInk = new bool[height];
        var rowLeft = new int[height];
        var rowRight = new int[height];
        var rowInk = new int[height];
        int inkRows = 0, lastInkRow = -1;
        for (var y = 0; y < height; y++)
        {
            var row = y * width * 4;
            int left = -1, right = -1, ink = 0;
            for (var x = 0; x < width; x++)
            {
                if (!IsInk(rgba, row + x * 4, background))
                {
                    continue;
                }
                if (left < 0)
                {
                    left = x;
                }
                right = x;
                ink++;
            }
            if (left < 0)
            {
                continue;
            }
            hasInk[y] = true;
            rowLeft[y] = left;
            rowRight[y] = right;
            rowInk[y] = ink;
            inkRows++;
            lastInkRow = y;
        }

        // Group ink rows into bands: rows separated by more than the gap
        // tolerance belong to different lines (or to no line).
        var bands = new List<(int Rows, int Left, int Right, long Ink)>();
        int bandRows = 0, bandLeft = 0, bandRight = 0, prevInk = -1;
        long bandInk = 0;
        for (var y = 0; y < height; y++)
        {
            if (!hasInk[y])
            {
                continue;
            }
            if (bandRows > 0 && y - prevInk > LineGapTolerance)
            {
                bands.Add((bandRows, bandLeft, bandRight, bandInk));
                bandRows = 0;
            }
            if (bandRows == 0)
            {
                bandLeft = rowLeft[y];
                bandRight = rowRight[y];
                bandInk = 0;
            }
            bandRows++;
            bandLeft = Math.Min(bandLeft, rowLeft[y]);
            bandRight = Math.Max(bandRight, rowRight[y]);
            bandInk += rowInk[y];
            prevInk = y;
        }
        if (bandRows > 0)
        {
            bands.Add((bandRows, bandLeft, bandRight, bandInk));
        }

        var kinds = new List<string>(bands.Count);
        var lineBands = 0;
        var maxBandRows = 0;
        var lastLine = "none";
        foreach (var band in bands)
        {
            var span = band.Right - band.Left;
            var coverage = band.Ink / ((double)band.Rows * Math.Max(1, span));
            var isText = band.Rows >= minLineRows && coverage >= MinLineCoverage && span >= minLineSpan;
            string kind;
            if (!isText)
            {
                kind = "floating";
            }
            else if (band.Right >= rightEdge)
            {
                kind = band.Left <= leftEdge ? "full" : "right";
            }
            else if (band.Left <= leftEdge)
            {
                kind = "left";
            }
            else
            {
                // Text that reaches neither edge cannot be judged for an RTL
                // anchor; it stays unverifiable rather than reading as a gap.
                kind = "floating";
            }
            kinds.Add(kind);
            if (isText)
            {
                lineBands++;
                maxBandRows = Math.Max(maxBandRows, band.Rows);
                lastLine = kind;
            }
        }

        // Backstop for a last line merged into the band above by tight line
        // spacing: walk up from the last inked row through rows that stop
        // short of the right edge. A real left-flushed tail forms a tall dense
        // run anchored at the left edge; a dangling accent tail is short and
        // sparse and stays below the run gate.
        int runRows = 0, runLeft = int.MaxValue, runRight = -1;
        long runInk = 0;
        for (var y = lastInkRow; y >= 0; y--)
        {
            if (!hasInk[y] || rowRight[y] >= rightEdge)
            {
                break;
            }
            runRows++;
            runLeft = Math.Min(runLeft, rowLeft[y]);
            runRight = Math.Max(runRight, rowRight[y]);
            runInk += rowInk[y];
        }
        var runSpan = runRows > 0 ? Math.Max(1, runRight - runLeft) : 0;
        var runCoverage = runRows > 0 ? runInk / ((double)runRows * runSpan) : 0;
        var trailingLeftRun = runRows >= minRunRows && runLeft <= leftEdge
            && runSpan >= minLineSpan && runCoverage >= MinLineCoverage;

        var emptyTailRows = lastInkRow < 0 ? height : height - 1 - lastInkRow;
        return new InkProfile(inkRows, bands.Count, lineBands, string.Join(',', kinds),
            lastLine, trailingLeftRun, emptyTailRows, height, maxBandRows);
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
