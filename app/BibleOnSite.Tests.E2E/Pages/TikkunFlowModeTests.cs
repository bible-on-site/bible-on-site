using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>Offline app instance booted straight into תיקון קוראים mode —
/// driving the mode through the reader menu is unreliable under UIA
/// (CarouselView leaves stale peers claiming the same AutomationIds), so
/// the suite presets the flags at launch instead.</summary>
public sealed class TikkunModeFixture : AppFixture
{
    protected override bool RequiresApi => false;

    protected override IEnumerable<KeyValuePair<string, string>> LaunchEnvironment =>
        [new("BIBLE_E2E_TIKKUN", "1"), new("BIBLE_E2E_PEREK", "10")];
}

[CollectionDefinition("Tikkun reader", DisableParallelization = true)]
public sealed class TikkunReaderCollection : ICollectionFixture<TikkunModeFixture>;

/// <summary>
/// #2839: enabling תיקון קוראים (with שניים מקרא) swaps the pasuk list for the
/// continuous canvas flow. Captures the rendered flow — the 34-Hebrew-letter
/// line cap is a layout rule, so the frame is the device-level evidence.
/// </summary>
[Collection("Tikkun reader")]
public sealed class TikkunFlowModeTests(TikkunModeFixture fixture)
{
    [Fact]
    public async Task TikkunKorimMode_RendersTheContinuousFlow()
    {
        // The fixture boots straight into תיקון קוראים on בראשית י — no
        // navigation, so the first painted flow surface is the live one.
        var flow = await WaitForTikkunFlowAsync(TimeSpan.FromSeconds(30));
        if (flow == null)
        {
            DumpTikkunDiagnostics("flow-fail.png");
        }
        flow.Should().NotBeNull("תיקון קוראים must replace the pasuk list with the continuous flow");

        // The canvas draws words, not UIA text — the capture is the checkable
        // artifact that lines honor the letter cap and stay intact.
        CaptureScreenshot("tikkun-linecap.png");

        // #3265: tapping the flow hides niqqud/taamim. The marked geometry is
        // the layout reference, so the scroll surface must stay put and only
        // the painted marks change — the second frame is the artifact. The
        // repaint is asynchronous, so wait for the flow's own word band to
        // differ before capturing (the canvas exposes no UIA text to poll).
        var offsetBefore = ReadScrollPercent(flow!);
        offsetBefore.Should().NotBe(double.NaN,
            "the flow's scroll surface must expose UIA scroll state");
        // The flow wait already proved the tap point answers FromPoint with
        // the live scroll view, so one click lands — re-tapping would mask
        // a genuinely dead surface.
        using var shownCapture = Capture.Element(flow!);
        fixture.ClickAt(FlowTapPoint(flow!));
        var repaintedInPlace = await WaitForRepaintAsync(flow!, shownCapture.Bitmap);
        if (!repaintedInPlace)
        {
            DumpTikkunDiagnostics("repaint-fail.png");
        }
        repaintedInPlace.Should().BeTrue("tapping the flow must repaint it in place with the marks hidden");

        // Geometry stability: the painted marks changed but the scroll
        // surface must not move a single dip.
        var repainted = await WaitForTikkunFlowAsync(TimeSpan.FromSeconds(15));
        repainted.Should().NotBeNull("the תיקון flow must stay in place across the marks toggle");
        ReadScrollPercent(repainted!).Should().Be(offsetBefore,
            "the marks toggle repaints in place — the scroll offset must not move");

        CaptureScreenshot("tikkun-marks-hidden.png");
    }

    /// <summary>Waits for the realized תיקון scroll view. The "tsy:" semantic
    /// probe is an Android content-description channel — on Windows the live
    /// signal is a real bounding box plus the hit-test, which only the
    /// displayed page's ScrollViewer passes.</summary>
    private async Task<AutomationElement?> WaitForTikkunFlowAsync(TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            var window = fixture.MainWindow;
            // The pasuk list and the flow are bound to opposite mode flags, so
            // the realized mode is the pair of signals — a stale element can
            // fake presence, but a live list while the flow claims visibility
            // means the mode never actually flipped.
            // The loading overlay covers the carousel while a perek jump is in
            // flight — any flow found beneath it is stale. Its caption carries
            // no AutomationId; the label's text is its UIA Name.
            var loading = window
                .FindAllDescendants(fixture.CF.ByName("מתחבר לפרק..."))
                .Any(element => IsVisibleInTree(element));
            var pasukimVisible = !loading && window
                .FindAllDescendants(fixture.CF.ByAutomationId("PasukimCollection"))
                .Any(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Height: > 200 }
                    && RenderedAtCenter(element));
            if (!loading && !pasukimVisible)
            {
                var flow = window.FindAllDescendants(fixture.CF.ByAutomationId("TikkunScrollView"))
                    .FirstOrDefault(element => IsVisibleInTree(element)
                        && element.BoundingRectangle is { Height: > 200 });
                if (flow != null && RenderedAtCenter(flow) && RenderedAtPoint(flow, FlowTapPoint(flow)))
                {
                    // UIA state can claim a flow exists while the page is
                    // still covered by the load overlay — painted pixels in
                    // the element's own word band are the unfakeable check.
                    using var probe = Capture.Element(flow);
                    if (PaintedFraction(probe.Bitmap, WordBand(probe.Bitmap)) > 0.03)
                    {
                        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
                        Directory.CreateDirectory(artifacts);
                        probe.ToFile(Path.Join(artifacts, "flow-probe.png"));
                        return flow;
                    }
                }
            }
            await Task.Delay(300, TestContext.Current.CancellationToken);
        }
        return null;
    }

    /// <summary>The tap recognizer sits on the drawable at the scroll
    /// content's top — the viewport's dead space below a short flow is not
    /// a tap target (and the custom canvas exposes no UIA element of its
    /// own).</summary>
    private static System.Drawing.Point FlowTapPoint(AutomationElement element) =>
        new((int)(element.BoundingRectangle.Left + element.BoundingRectangle.Width / 2),
            (int)(element.BoundingRectangle.Top + 40));

    /// <summary>The element itself and every ancestor report on-screen and
    /// enabled. A hidden CarouselView page keeps its last bounds/state —
    /// including a stale IsOffscreen=false on the element — but the page
    /// root carries IsEnabled=false for the whole subtree (bound to
    /// IsOffscreenCarouselPage), so the chain walk catches peers UIA still
    /// enumerates with stale "live" state.</summary>
    private bool IsVisibleInTree(AutomationElement element)
    {
        for (var node = (AutomationElement?)element; node != null; node = node.Parent)
        {
            // The desktop root does not support IsOffscreen — missing means
            // treat as visible, not as an error.
            if ((node.Properties.IsOffscreen.TryGetValue(out var offscreen) && offscreen)
                || (node.Properties.IsEnabled.TryGetValue(out var enabled) && !enabled))
            {
                return false;
            }
        }
        return true;
    }

    /// <summary>Proves the element is what physically renders at its claimed
    /// bounds: UIA keeps removed elements enumerated with their last geometry
    /// and state, but a hit-test at the center lands on the real surface —
    /// the candidate is genuine only when it (or a child) answers FromPoint.
    /// </summary>
    private bool RenderedAtCenter(AutomationElement element)
    {
        var bounds = element.BoundingRectangle;
        if (bounds is not { Width: > 0, Height: > 0 })
        {
            return false;
        }
        return RenderedAtPoint(element, new System.Drawing.Point(
            (int)(bounds.Left + bounds.Width / 2),
            (int)(bounds.Top + bounds.Height / 2)));
    }

    /// <summary>Same hit-test proof at an arbitrary point — the tap point
    /// is not the center, so the click must be gated on its own coverage.
    /// </summary>
    private bool RenderedAtPoint(AutomationElement element, System.Drawing.Point point)
    {
        var hit = fixture.Automation.FromPoint(point);
        var wanted = element.Properties.RuntimeId.ValueOrDefault;
        for (var node = hit; node != null; node = node.Parent)
        {
            if (wanted is { Length: > 0 } && node.Properties.RuntimeId.ValueOrDefault is { } actual
                && actual.SequenceEqual(wanted))
            {
                return true;
            }
        }
        return false;
    }

    /// <summary>The flow's vertical scroll offset as UIA reports it — NaN when
    /// the element stopped exposing scroll state (collapsed, recycled). The
    /// -1 no-scroll sentinel and 0 both mean "resting at the top", so the
    /// sentinel is normalized away for comparison.</summary>
    private static double ReadScrollPercent(AutomationElement element) =>
        element.Patterns.Scroll.TryGetPattern(out var scroll)
            ? Math.Max(0, scroll.VerticalScrollPercent)
            : double.NaN;

    /// <summary>The rows where the flow's words paint: just under the content
    /// padding and well above the bottom action bar that overlays the element's
    /// lower strip. Sampling the whole element lets a bare action bar fake a
    /// painted flow — the band only counts rows real text covers.</summary>
    private static System.Drawing.Rectangle WordBand(System.Drawing.Bitmap bitmap) =>
        new(0, 8, bitmap.Width, Math.Min(160, bitmap.Height - 60) - 8);

    /// <summary>Fraction of pixels meaningfully different from the region's
    /// dominant color. UIA state in this app can claim "visible" for surfaces
    /// the compositor is not painting (stale carousel peers, overlay-covered
    /// content), so rendered pixels are the only honest proof that words are
    /// on screen. A painted text flow is several percent non-background; a
    /// blank or spinner-covered region stays under ~2%.</summary>
    private static double PaintedFraction(System.Drawing.Bitmap bitmap, System.Drawing.Rectangle region)
    {
        var full = new System.Drawing.Rectangle(0, 0, bitmap.Width, bitmap.Height);
        var data = bitmap.LockBits(full, System.Drawing.Imaging.ImageLockMode.ReadOnly,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        try
        {
            var bytes = new byte[Math.Abs(data.Stride) * bitmap.Height];
            System.Runtime.InteropServices.Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
            var stride = Math.Abs(data.Stride);
            var counts = new Dictionary<uint, int>();
            for (var y = region.Top; y < region.Bottom; y += 2)
            {
                for (var x = region.Left; x < region.Right; x += 2)
                {
                    var px = BitConverter.ToUInt32(bytes, y * stride + x * 4);
                    counts[px] = counts.TryGetValue(px, out var c) ? c + 1 : 1;
                }
            }
            var dominant = counts.MaxBy(pair => pair.Value).Key;
            var sampled = (region.Height / 2) * (region.Width / 2);
            var dr = (dominant >> 16) & 0xFF;
            var dg = (dominant >> 8) & 0xFF;
            var db = dominant & 0xFF;
            var painted = 0;
            foreach (var pair in counts)
            {
                var pr = (pair.Key >> 16) & 0xFF;
                var pg = (pair.Key >> 8) & 0xFF;
                var pb = pair.Key & 0xFF;
                if (Math.Abs((int)pr - dr) + Math.Abs((int)pg - dg) + Math.Abs((int)pb - db) > 24)
                {
                    painted += pair.Value;
                }
            }
            return (double)painted / sampled;
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    /// <summary>Polls until the word band shows directional mark-removal
    /// evidence — erased niqqud/taamim collapse onto the background color, so
    /// stripping produces many ink→background transitions and nearly none the
    /// other way. A bare "pixels changed" gate is not enough: a brightness/AA
    /// shift in the re-rendered frame produces exactly that without removing
    /// a single mark (#3265). Chrome outside the band is not the flow's
    /// repaint either.</summary>
    private static async Task<bool> WaitForRepaintAsync(AutomationElement element, System.Drawing.Bitmap before)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            using var current = Capture.Element(element);
            if (WordBandRemovedInk(current.Bitmap, before) >= 40)
            {
                return true;
            }
            await Task.Delay(150);
        }
        return false;
    }

    /// <summary>Count of word-band pixels that left the ink side and reached
    /// the background — the structural signature of marks actually being
    /// erased rather than the frame just shifting intensity. The direction is
    /// read off the captured frame, not assumed: under a dark theme marks are
    /// bright ink erased to dark; under a light theme they are dark ink
    /// erased to light. Hidden niqqud dots are only a few px wide, so every
    /// pixel is compared (no sampling stride), and only a real crossing into
    /// background territory counts as erased so antialiasing shimmer on
    /// surviving glyphs cannot accumulate into a pass.</summary>
    private static int WordBandRemovedInk(System.Drawing.Bitmap after, System.Drawing.Bitmap before)
    {
        if (after.Width != before.Width || after.Height != before.Height)
        {
            return 0;
        }
        var rect = new System.Drawing.Rectangle(0, 0, after.Width, after.Height);
        var dataA = after.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadOnly,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        var dataB = before.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadOnly,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        try
        {
            var bytesA = new byte[Math.Abs(dataA.Stride) * after.Height];
            var bytesB = new byte[Math.Abs(dataB.Stride) * before.Height];
            System.Runtime.InteropServices.Marshal.Copy(dataA.Scan0, bytesA, 0, bytesA.Length);
            System.Runtime.InteropServices.Marshal.Copy(dataB.Scan0, bytesB, 0, bytesB.Length);
            var stride = Math.Abs(dataA.Stride);
            var band = WordBand(after);
            // Ink direction follows the captured background, not a theme
            // assumption: a dark band means bright marks erased to dark; a
            // light band means dark marks erased to light.
            var lumaSum = 0L;
            var lumaSamples = 0;
            for (var y = band.Top; y < band.Bottom; y += 2)
            {
                var row = y * stride;
                for (var x = band.Left; x < band.Right; x += 2)
                {
                    var px = row + x * 4;
                    lumaSum += (bytesB[px] + bytesB[px + 1] + bytesB[px + 2]) / 3;
                    lumaSamples++;
                }
            }
            var inkIsBright = lumaSum / Math.Max(1, lumaSamples) < 128;
            var removed = 0;
            for (var y = band.Top; y < band.Bottom; y++)
            {
                var row = y * stride;
                for (var x = band.Left; x < band.Right; x++)
                {
                    var px = row + x * 4;
                    var lumaBefore = (bytesB[px] + bytesB[px + 1] + bytesB[px + 2]) / 3;
                    var lumaAfter = (bytesA[px] + bytesA[px + 1] + bytesA[px + 2]) / 3;
                    if (inkIsBright
                        ? lumaBefore > 110 && lumaAfter < 70
                        : lumaBefore < 145 && lumaAfter > 185)
                    {
                        removed++;
                    }
                }
            }
            return removed;
        }
        finally
        {
            after.UnlockBits(dataA);
            before.UnlockBits(dataB);
        }
    }

    /// <summary>Dumps every enumerated copy of the ambiguous elements with
    /// the state each ghost check reads — the tree says what the pixels
    /// cannot.</summary>
    private void DumpTikkunDiagnostics(string capture)
    {
        CaptureScreenshot(capture);
        foreach (var id in new[] { "TikkunScrollView", "PasukimCollection", "ReaderMenuOverlay", "ReaderMenuButton" })
        {
            var elements = fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId(id));
            foreach (var element in elements)
            {
                var chain = new List<string>();
                for (var node = element.Parent; node != null; node = node.Parent)
                {
                    chain.Add($"{node.Properties.AutomationId.ValueOrDefault ?? node.ControlType.ToString()}(off={node.Properties.IsOffscreen.ValueOrDefault},en={node.Properties.IsEnabled.ValueOrDefault})");
                }
                Console.WriteLine($"{id}: off={element.IsOffscreen} en={element.IsEnabled} rect={element.BoundingRectangle} " +
                                  $"centerHit={RenderedAtCenter(element)} chain={string.Join(">", chain)}");
            }
        }
    }

    private void CaptureScreenshot(string name)
    {
        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        using var capture = Capture.Element(fixture.MainWindow);
        capture.ToFile(Path.Join(artifacts, name));
    }
}
