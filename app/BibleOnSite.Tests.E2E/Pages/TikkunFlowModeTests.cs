using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Capturing;
using FlaUI.Core.Definitions;
using FlaUI.Core.Input;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>
/// #2839: enabling תיקון קוראים (with שניים מקרא) swaps the pasuk list for the
/// continuous canvas flow. Captures the rendered flow — the 34-Hebrew-letter
/// line cap is a layout rule, so the frame is the device-level evidence.
/// </summary>
[Collection("Offline reader")]
public sealed class TikkunFlowModeTests(OfflineReaderFixture fixture)
{
    [Fact]
    public async Task TikkunKorimMode_RendersTheContinuousFlow()
    {
        await NavigateToBereshitYudAsync();

        // Mode prefs persist across runs, so a blind row tap can toggle the
        // mode off instead of on — drive each checkbox to a confirmed state
        // through its own UIA Toggle instead.
        await SetMenuCheckBoxAsync("ShnayimMikraCheckBox", ToggleState.On);
        await SetMenuCheckBoxAsync("TikkunKorimCheckBox", ToggleState.On);

        var flow = await WaitForTikkunFlowAsync(TimeSpan.FromSeconds(30));
        if (flow == null)
        {
            CaptureScreenshot("flow-fail.png");
            var scrollViews = fixture.MainWindow
                .FindAllDescendants(fixture.CF.ByAutomationId("TikkunScrollView"));
            var probed = fixture.MainWindow
                .FindAllDescendants()
                .Count(e => (e.Properties.HelpText.ValueOrDefault ?? string.Empty)
                    .StartsWith("tsy:", StringComparison.Ordinal));
            Console.WriteLine($"tikkun-flow failed: scroll-views={scrollViews.Length} tsy-elements={probed} " +
                              $"states={string.Join(";", scrollViews.Select(e =>
                                  $"offscreen={e.IsOffscreen} help='{e.Properties.HelpText.ValueOrDefault}' rect={e.BoundingRectangle} " +
                                  $"scroll={(e.Patterns.Scroll.TryGetPattern(out var s) ? $"vert={s.VerticallyScrollable} pct={s.VerticalScrollPercent}" : "none")}"))}");
        }
        flow.Should().NotBeNull("תיקון קוראים must replace the pasuk list with the continuous flow");

        // The canvas draws words, not UIA text — the capture is the checkable
        // artifact that lines honor the letter cap and stay intact.
        CaptureScreenshot("tikkun-linecap.png");

        // #3265: tapping the flow hides niqqud/taamim. The marked geometry is
        // the layout reference, so the scroll surface must stay put and only
        // the painted marks change — the second frame is the artifact. The
        // repaint is asynchronous, so wait for the flow's own pixels to
        // differ before capturing (the canvas exposes no UIA text to poll).
        var offsetBefore = ReadScrollPercent(flow!);
        offsetBefore.Should().NotBe(double.NaN,
            "the flow's scroll surface must expose UIA scroll state");
        // The tap recognizer sits on the drawable at the scroll content's
        // top — the viewport's dead space below a short flow is not a tap
        // target (and the custom canvas exposes no UIA element of its own).
        // An overlay can swallow one click, so retry the tap bounded times.
        var shownPixels = Capture.Element(flow).Bitmap;
        var tapPoint = new System.Drawing.Point(
            (int)(flow!.BoundingRectangle.Left + flow.BoundingRectangle.Width / 2),
            (int)(flow.BoundingRectangle.Top + 40));
        var repaintedInPlace = false;
        for (var attempt = 0; attempt < 3 && !repaintedInPlace; attempt++)
        {
            fixture.ClickAt(tapPoint);
            repaintedInPlace = await WaitForRepaintAsync(flow!, shownPixels);
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
    /// probe is an Android content-description channel — on Windows the same
    /// "loaded and scrollable" signal is a real bounding box plus the native
    /// UIA scroll pattern, which only a live ScrollViewer exposes.</summary>
    private async Task<AutomationElement?> WaitForTikkunFlowAsync(TimeSpan timeout)
    {
        return await fixture.WaitForElementAsync(window =>
        {
            // The pasuk list and the flow are bound to opposite mode flags, so
            // the realized mode is the pair of signals — a stale element can
            // fake presence, but a live list while the flow claims visibility
            // means the mode never actually flipped.
            var pasukimVisible = window
                .FindAllDescendants(fixture.CF.ByAutomationId("PasukimCollection"))
                .Any(element => !element.IsOffscreen
                    && element.BoundingRectangle is { Height: > 200 }
                    && RenderedAtCenter(element));
            if (pasukimVisible)
            {
                return null;
            }
            return window.FindAllDescendants(fixture.CF.ByAutomationId("TikkunScrollView"))
                .FirstOrDefault(element => !element.IsOffscreen
                    && element.BoundingRectangle is { Height: > 200 }
                    && RenderedAtCenter(element));
        }, timeout);
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
        var hit = fixture.Automation.FromPoint(new System.Drawing.Point(
            (int)(bounds.Left + bounds.Width / 2),
            (int)(bounds.Top + bounds.Height / 2)));
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

    /// <summary>Drives a reader-menu checkbox to the wanted state and confirms
    /// the binding landed — the checkbox reflects the same view-model flag
    /// that shows or hides the flow, which is the honest signal the UIA tree
    /// cannot give (hidden copies stay enumerated with stale bounds). Reading
    /// the state first keeps the action idempotent under persisted prefs.
    /// </summary>
    private async Task SetMenuCheckBoxAsync(string checkBoxId, ToggleState wanted)
    {
        await OpenReaderMenuAsync();
        var overlay = await LiveMenuOverlayAsync(TimeSpan.FromSeconds(15));
        overlay.Should().NotBeNull("the reader menu overlay must be open before rows can be toggled");
        var checkbox = overlay!.FindAllDescendants(fixture.CF.ByAutomationId(checkBoxId))
            .FirstOrDefault(element => !element.IsOffscreen);
        checkbox.Should().NotBeNull($"the reader menu exposes {checkBoxId}");
        checkbox!.Patterns.Toggle.TryGetPattern(out var toggle)
            .Should().BeTrue($"{checkBoxId} must expose the UIA toggle pattern");
        if (toggle!.ToggleState != wanted)
        {
            toggle.Toggle();
        }
        // The confirm must stay inside the live overlay: dismissed menu copies
        // linger in the tree with their last toggle state, so a window-wide
        // query can "confirm" against a ghost while the real row never moved.
        var confirmed = await fixture.WaitForElementAsync(window =>
        {
            var live = window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuOverlay"))
                .FirstOrDefault(element => !element.IsOffscreen
                    && element.BoundingRectangle is { Width: > 50, Height: > 50 });
            return live?.FindAllDescendants(fixture.CF.ByAutomationId(checkBoxId))
                .FirstOrDefault(element => !element.IsOffscreen
                    && element.Patterns.Toggle.TryGetPattern(out var state)
                    && state.ToggleState == wanted);
        }, TimeSpan.FromSeconds(10));
        confirmed.Should().NotBeNull($"{checkBoxId} must reach {wanted}");
        // A row tap dismisses the dropdown; a pattern toggle leaves it up —
        // put it away so the overlay never covers the evidence capture.
        await CloseReaderMenuAsync();
    }

    /// <summary>The ReaderMenuPanel grid fills its row when shown; hidden
    /// copies keep reporting their last bounds, so the live signal is the
    /// physical hit-test at the overlay's own point.</summary>
    private async Task<AutomationElement?> LiveMenuOverlayAsync(TimeSpan timeout)
    {
        return await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuOverlay"))
                .FirstOrDefault(element => !element.IsOffscreen
                    && element.BoundingRectangle is { Width: > 50, Height: > 50 }
                    && RenderedAtCenter(element)),
            timeout);
    }

    /// <summary>Ensures the reader menu is open — the button toggles, so a
    /// blind click can close an already-open menu.</summary>
    private async Task OpenReaderMenuAsync()
    {
        AutomationElement? menuButton = null;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            if (await ReaderMenuIsOpenAsync(TimeSpan.FromSeconds(4)))
            {
                return;
            }
            // Re-fetch each attempt: a recycled page can leave the earlier
            // element detached, whose stale point clicks the wrong surface.
            // A real Button exposes UIA Invoke — firing its Clicked handler
            // without depending on what the physical point happens to hit.
            menuButton = await fixture.WaitForElementAsync(window =>
                window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuButton"))
                    .FirstOrDefault(button => !button.IsOffscreen), TimeSpan.FromSeconds(15));
            menuButton.Should().NotBeNull("the reader menu button opens the display modes");
            if (menuButton!.Patterns.Invoke.TryGetPattern(out var invoke))
            {
                invoke.Invoke();
            }
            else
            {
                fixture.MainWindow.Focus();
                fixture.Click(menuButton);
            }
        }
        if (!await ReaderMenuIsOpenAsync(TimeSpan.FromSeconds(10)))
        {
            CaptureScreenshot("menu-open-fail.png");
            var overlay = fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId("ReaderMenuOverlay")).FirstOrDefault();
            var shnayim = fixture.MainWindow.FindAllDescendants(fixture.CF.ByAutomationId("ShnayimMikraCheckBox")).FirstOrDefault();
            var rowLabel = fixture.MainWindow.FindAllDescendants(fixture.CF.ByName("שניים מקרא")).FirstOrDefault();
            Console.WriteLine($"menu-open failed: overlay={(overlay == null ? "absent" : $"offscreen={overlay.IsOffscreen} rect={overlay.BoundingRectangle}")} " +
                              $"shnayim={(shnayim == null ? "absent" : $"offscreen={shnayim.IsOffscreen} rect={shnayim.BoundingRectangle}")} " +
                              $"row-label={(rowLabel == null ? "absent" : $"offscreen={rowLabel.IsOffscreen} rect={rowLabel.BoundingRectangle}")} " +
                              $"button=rect:{menuButton!.BoundingRectangle} enabled={menuButton.IsEnabled}");
        }
        (await ReaderMenuIsOpenAsync(TimeSpan.FromSeconds(1)))
            .Should().BeTrue("the reader menu must open");
    }

    /// <summary>Dismisses the menu through its backdrop — a directional close:
    /// a ghost overlay still reporting stale bounds cannot invert this into an
    /// open the way re-invoking the toggle button can.</summary>
    private async Task CloseReaderMenuAsync()
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var overlay = await LiveMenuOverlayAsync(TimeSpan.FromSeconds(2));
            if (overlay == null)
            {
                return;
            }
            var bounds = overlay.BoundingRectangle;
            fixture.ClickAt(new System.Drawing.Point(
                (int)(bounds.Left + bounds.Width / 2),
                (int)(bounds.Top + bounds.Height / 2)));
        }
    }

    private async Task<bool> ReaderMenuIsOpenAsync(TimeSpan timeout)
    {
        // Dismissed menu rows can linger enumerated as on-screen, so the
        // checkbox/label signals can claim "open" while the overlay is
        // gone — the overlay's own geometry is the honest signal.
        return await LiveMenuOverlayAsync(timeout) != null;
    }

    /// <summary>Polls until the flow's painted pixels differ from the
    /// pre-toggle capture — the marks toggle repaints the canvas in place.
    /// </summary>
    private static async Task<bool> WaitForRepaintAsync(AutomationElement element, System.Drawing.Bitmap before)
    {
        var deadline = DateTime.UtcNow.AddSeconds(10);
        while (DateTime.UtcNow < deadline)
        {
            var current = Capture.Element(element).Bitmap;
            if (!ReferenceEquals(current, before) && !BitmapsEqual(current, before))
            {
                return true;
            }
            await Task.Delay(150);
        }
        return false;
    }

    /// <summary>Exact pixel comparison — hidden niqqud dots are only a few
    /// px wide, so a sampling stride can miss every change.</summary>
    private static bool BitmapsEqual(System.Drawing.Bitmap a, System.Drawing.Bitmap b)
    {
        if (a.Width != b.Width || a.Height != b.Height)
        {
            return false;
        }
        var rect = new System.Drawing.Rectangle(0, 0, a.Width, a.Height);
        var dataA = a.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadOnly,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        var dataB = b.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadOnly,
            System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        try
        {
            var bytesA = new byte[Math.Abs(dataA.Stride) * a.Height];
            var bytesB = new byte[Math.Abs(dataB.Stride) * b.Height];
            System.Runtime.InteropServices.Marshal.Copy(dataA.Scan0, bytesA, 0, bytesA.Length);
            System.Runtime.InteropServices.Marshal.Copy(dataB.Scan0, bytesB, 0, bytesB.Length);
            return bytesA.SequenceEqual(bytesB);
        }
        finally
        {
            a.UnlockBits(dataA);
            b.UnlockBits(dataB);
        }
    }

    private async Task NavigateToBereshitYudAsync()
    {
        // Same offline search path as PerekReselectScrollTests.
        var source = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSource"))
                .FirstOrDefault(title => !title.IsOffscreen), TimeSpan.FromSeconds(30));
        source.Should().NotBeNull("the reader must finish startup before search opens");
        fixture.MainWindow.Focus();
        fixture.Click(source!);
        var input = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
                .FirstOrDefault(field => !field.IsOffscreen && field.IsEnabled), TimeSpan.FromSeconds(30));
        input.Should().NotBeNull();
        // The entry can take the click before the search panel finishes
        // presenting — focus never lands. Re-click bounded times until the
        // native field reports keyboard focus.
        var focused = (AutomationElement?)null;
        for (var attempt = 0; attempt < 3 && focused == null; attempt++)
        {
            fixture.Click(input!);
            focused = await fixture.WaitForElementAsync(window =>
                window.FindAllDescendants(fixture.CF.ByAutomationId("PerekSearchInput"))
                    .FirstOrDefault(field => field.FrameworkAutomationElement.HasKeyboardFocus),
                TimeSpan.FromSeconds(8));
        }
        focused.Should().NotBeNull("typing starts after the native field receives focus");
        Keyboard.TypeSimultaneously(FlaUI.Core.WindowsAPI.VirtualKeyShort.CONTROL, FlaUI.Core.WindowsAPI.VirtualKeyShort.KEY_A);
        Keyboard.Type("בראשית 10");
        (await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchStatus")) is { } status
                && System.Text.RegularExpressions.Regex.IsMatch(status.Name, @"^\d+ תוצאות$") ? status : null,
            TimeSpan.FromSeconds(90))).Should().NotBeNull("search must finish before selecting a result");
        var result = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("SearchResults"))
                ?.FindFirstDescendant(fixture.CF.ByName("בראשית י")), TimeSpan.FromSeconds(45));
        result.Should().NotBeNull("the chapter result must appear for the query");
        fixture.MainWindow.Focus();
        fixture.Click(result!);
        var landed = await fixture.WaitForElementAsync(window =>
            window.FindFirstDescendant(fixture.CF.ByAutomationId("PerekSource").And(fixture.CF.ByName("בראשית י"))),
            TimeSpan.FromSeconds(30));
        landed.Should().NotBeNull("the reader opens בראשית י after the search result tap");
    }

    private void CaptureScreenshot(string name)
    {
        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        Capture.Element(fixture.MainWindow).ToFile(Path.Join(artifacts, name));
    }
}
