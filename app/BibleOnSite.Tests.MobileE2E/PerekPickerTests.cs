using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using OpenQA.Selenium.Interactions;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Chapter picker (בחירת פרק): full-height lists with boundary arrows (#2475)
// and reader state cleanup after confirmation (#2476).
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class PerekPickerTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    private const string MoreAbove = "יש עוד פריטים למעלה";
    private const string MoreBelow = "יש עוד פריטים למטה";
    private const string TopBoundary = "תחילת הרשימה";
    private const string BottomBoundary = "סוף הרשימה";

    [Fact]
    public void ConfirmReturnsToUndimmedReader_AndListsFillTheirColumns() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        OpenPicker();

        // כתובים's first sefer is תהילים — a long chapter list that must overflow.
        TapItem("PickerGroupItem", "כתובים");
        var perekList = Page.WaitFor("PerekPickerPerekList");
        // PerekPickerPopup is the full-screen overlay (scrim included); the card
        // is the bordered panel whose columns the lists must fill.
        var card = Page.WaitFor("PerekPickerCard");

        // #2475: the list uses the available column height, not a fixed band.
        var listFrame = MobilePlatformAdapter.ReadFrame(perekList);
        var cardFrame = MobilePlatformAdapter.ReadFrame(card);
        Assert.True(listFrame.Size.Height > cardFrame.Size.Height * 0.5,
            $"list height {listFrame.Size.Height} should fill most of the card height {cardFrame.Size.Height}");

        // At the top of a long list: up is a boundary, down reports more content.
        // WaitForSpoken returns the arrow's announced state inside the poll's
        // own snapshot — no second GetAttribute round-trip per read on iOS.
        Assert.Equal(TopBoundary, Page.WaitForSpoken("PerekPickerPerekUp"));
        Assert.Equal(MoreBelow, Page.WaitForSpoken("PerekPickerPerekDown"));
        // The 3-item group column fits entirely: both directions are boundaries.
        Assert.Equal(TopBoundary, Page.WaitForSpoken("PerekPickerGroupUp"));
        Assert.Equal(BottomBoundary, Page.WaitForSpoken("PerekPickerGroupDown"));

        // Scrolling down opens the upward direction.
        FlickList("PerekPickerPerekList", fromFraction: 0.8, toFraction: 0.2);
        Page.WaitForSpoken("PerekPickerPerekUp", spoken => spoken == MoreAbove);
        Assert.Equal(MoreBelow, Page.WaitForSpoken("PerekPickerPerekDown"));

        // A short book fits entirely: both arrows return to boundary state.
        TapItem("PickerSeferItem", "איכה");
        Page.WaitForSpoken("PerekPickerPerekDown", spoken => spoken == BottomBoundary);
        Assert.Equal(TopBoundary, Page.WaitForSpoken("PerekPickerPerekUp"));

        // #2476: confirming completes navigation — no leftover dim or open menu.
        Page.Tap("PerekPickerConfirm");
        Page.WaitForHidden("PerekPickerPopup");
        Page.WaitForHidden("CircularMenuScrim");
        AssertRegularReader();
    });

    [Fact]
    public void CancelLeavesTheRadialMenuOpen() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        OpenPicker();
        Page.Tap("PerekPickerCancel");
        Page.WaitForHidden("PerekPickerPopup");
        // Cancel is not a navigation: the menu the picker came from stays as it was.
        Assert.NotEmpty(Page.RenderedElements("CircularMenuScrim"));
        Page.Tap("CircularMenuButton");
        Page.WaitForHidden("CircularMenuScrim");
        AssertRegularReader();
    });

    // #3400: opening the picker positions the chapter column at the current
    // perek — selected and fully inside the column viewport without any
    // manual scrolling. תהילים קיט sits ~120 items into a 150-item column, so
    // it cannot possibly fit the initial top-of-list viewport.
    [Fact]
    public void OpenCentersTheCurrentPerekInsideItsColumn() => Scenario(() =>
    {
        NavigateToPerek("תהילים", 119, "קיט");
        OpenPicker();

        AssertItemFullyInsidePerekColumn("קיט");
        // Centered, not just inside: realized items flank the selection on
        // both sides, so an edge-pinned landing cannot pass this test.
        var rendered = Page.RenderedElements("PickerPerekItem").ToList();
        var target = rendered.First(element => element.Text == "קיט");
        Assert.Contains(rendered, element => element.Frame.Location.Y < target.Frame.Location.Y);
        Assert.Contains(rendered, element => element.Frame.Location.Y > target.Frame.Location.Y);
        // The preselection is real — the confirm button only enables once a
        // perek is selected.
        Page.WaitFor("PerekPickerConfirm", element => element.Enabled);
        // Mid-list both directions keep content: the arrows track the new
        // viewport, not the stale top of the list.
        Page.WaitForSpoken("PerekPickerPerekUp", spoken => spoken == MoreAbove);
        Page.WaitForSpoken("PerekPickerPerekDown", spoken => spoken == MoreBelow);

        Page.Tap("PerekPickerConfirm");
        Page.WaitForHidden("PerekPickerPopup");
        Assert.Equal("תהילים קיט", Page.Source);
    });

    [Fact]
    public void ReopenAfterScrollingAwayRepositionsAtTheCurrentPerek() => Scenario(() =>
    {
        NavigateToPerek("תהילים", 119, "קיט");
        OpenPicker();
        AssertItemFullyInsidePerekColumn("קיט");

        // Drag the column several screens back toward א and dismiss — the
        // abandoned scroll position must not leak into the next opening.
        var scrolledAway = DateTime.UtcNow.AddSeconds(20);
        while (DateTime.UtcNow < scrolledAway
            && Page.RenderedElements("PickerPerekItem").Any(element => element.Text == "קיט"))
        {
            FlickList("PerekPickerPerekList", fromFraction: 0.2, toFraction: 0.8);
        }
        Assert.DoesNotContain(Page.RenderedElements("PickerPerekItem"), element => element.Text == "קיט");
        Page.Tap("PerekPickerCancel");
        Page.WaitForHidden("PerekPickerPopup");
        // Cancel is not a navigation: the radial menu it came from is still open.
        Page.Tap("CircularMenuButton");
        Page.WaitForHidden("CircularMenuScrim");

        OpenPicker();
        AssertItemFullyInsidePerekColumn("קיט");
        Page.Tap("PerekPickerCancel");
        Page.WaitForHidden("PerekPickerPopup");
        Page.Tap("CircularMenuButton");
        Page.WaitForHidden("CircularMenuScrim");
        AssertRegularReader();
    });

    [Fact]
    public void OpenPositionsAtShortBookAndClampsAtTheListEnd() => Scenario(() =>
    {
        // איכה's five chapters fit their column whole — the current perek is
        // inside with no scroll at all and both arrows stay at the boundary.
        NavigateToPerek("איכה", 5, "ה");
        OpenPicker();
        AssertItemFullyInsidePerekColumn("ה");
        Assert.Equal(TopBoundary, Page.WaitForSpoken("PerekPickerPerekUp"));
        Assert.Equal(BottomBoundary, Page.WaitForSpoken("PerekPickerPerekDown"));
        Page.Tap("PerekPickerCancel");
        Page.WaitForHidden("PerekPickerPopup");
        Page.Tap("CircularMenuButton");
        Page.WaitForHidden("CircularMenuScrim");

        // A current-perek change: the long list's end clamps the centering —
        // קנ lands fully inside the bottom edge with only upward content left.
        NavigateToPerek("תהילים", 150, "קנ");
        OpenPicker();
        AssertItemFullyInsidePerekColumn("קנ");
        Page.WaitForSpoken("PerekPickerPerekUp", spoken => spoken == MoreAbove);
        Assert.Equal(BottomBoundary, Page.WaitForSpoken("PerekPickerPerekDown"));
        Page.Tap("PerekPickerConfirm");
        Page.WaitForHidden("PerekPickerPopup");
        Assert.Equal("תהילים קנ", Page.Source);
    });

    /// <summary>
    /// Jumps the reader straight to the perek through the search bar —
    /// deterministic setup regardless of which perek the day opens on. The
    /// index resolves "תהילים 119" to its "תהילים קיט" row no matter how deep
    /// that chapter sits inside the picker's column, so the setup does not
    /// spend the device budget scrolling 150 rows.
    /// </summary>
    private void NavigateToPerek(string sefer, int perekNumber, string perek)
    {
        var title = $"{sefer} {perek}";
        if (!Driver!.FindElements(Platform.AutomationId("PerekSearchInput"))
                .Any(element => element.Displayed))
        {
            Page.Tap("PerekSource");
        }
        var bar = Page.WaitFor("PerekSearchInput", element => element.Enabled);
        Platform.Tap(Driver!, bar);
        var input = bar.TagName.Contains("TextView", StringComparison.Ordinal)
            || bar.TagName.Contains("EditText", StringComparison.Ordinal)
            || bar.TagName.Contains("SearchField", StringComparison.Ordinal)
            || bar.TagName.Contains("TextField", StringComparison.Ordinal)
            ? bar
            : bar.FindElement(By.XPath(".//*[@class='android.widget.EditText' or @class='android.widget.AutoCompleteTextView' or @type='XCUIElementTypeSearchField' or @type='XCUIElementTypeTextField']"));
        input.Clear();
        input.SendKeys($"{sefer} {perekNumber}");

        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (DateTime.UtcNow < deadline)
        {
            var row = Page.RenderedElements("SearchResultTitle")
                .FirstOrDefault(element => element.Text == title);
            if (row.Element != null)
            {
                Platform.Tap(Driver!, row.Element);
                Page.WaitFor("PerekSource", element => element.Text == title);
                Assert.NotEmpty(Page.FirstPasuk);
                return;
            }
            Thread.Sleep(250);
        }
        throw new WebDriverTimeoutException($"The '{title}' search row never rendered.");
    }

    /// <summary>
    /// Polls the rendered items — a perek outside the column viewport is not
    /// realized at all — until the target renders with its complete bounds
    /// inside the list frame. No swipe or scroll helper runs here: whatever
    /// position the picker opens with is what gets judged.
    /// </summary>
    private void AssertItemFullyInsidePerekColumn(string text)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        var last = "no frames read";
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var list = Page.RenderedElements("PerekPickerPerekList").FirstOrDefault();
                var item = Page.RenderedElements("PickerPerekItem").FirstOrDefault(element => element.Text == text);
                if (item.Element != null && list.Element != null && FullyInside(list.Frame, item.Frame))
                {
                    return;
                }
                last = $"item={(item.Element == null ? "absent" : FrameText(item.Frame))}, " +
                    $"list={(list.Element == null ? "absent" : FrameText(list.Frame))}";
            }
            catch (StaleElementReferenceException)
            {
                // The column re-realizes while the open scroll lands — retry.
            }
            Thread.Sleep(200);
        }
        Assert.Fail($"chapter '{text}' never rendered fully inside the perek column viewport ({last}).");
    }

    /// <summary>Every edge of the inner frame lies inside the outer frame.</summary>
    private static bool FullyInside(
        (System.Drawing.Point Location, System.Drawing.Size Size) outer,
        (System.Drawing.Point Location, System.Drawing.Size Size) inner) =>
        inner.Size.Width > 0 && inner.Size.Height > 0
        && inner.Location.X >= outer.Location.X
        && inner.Location.Y >= outer.Location.Y
        && inner.Location.X + inner.Size.Width <= outer.Location.X + outer.Size.Width
        && inner.Location.Y + inner.Size.Height <= outer.Location.Y + outer.Size.Height;

    private static string FrameText((System.Drawing.Point Location, System.Drawing.Size Size) frame) =>
        $"({frame.Location.X},{frame.Location.Y} {frame.Size.Width}x{frame.Size.Height})";

    private void OpenPicker()
    {
        Page.OpenCircularMenu();
        Page.Tap("PerekPickerButton");
        Page.WaitFor("PerekPickerPopup");
    }

    private void AssertRegularReader()
    {
        Page.WaitFor("PerekSource", element => !string.IsNullOrEmpty(element.Text));
        Assert.NotEmpty(Page.FirstPasuk);
    }

    private void TapItem(string automationId, string text)
    {
        var item = Page.WaitFor(automationId, element => element.Text == text);
        Platform.Tap(Driver!, item);
    }

    private void FlickList(string automationId, double fromFraction, double toFraction)
    {
        // RenderedElements returns the frame inside the same lookup, so the
        // gesture's geometry costs no second read on iOS.
        var (location, size) = Page.RenderedElements(automationId).First().Frame;
        var x = location.X + size.Width / 2;
        var fromY = location.Y + (int)(size.Height * fromFraction);
        var toY = location.Y + (int)(size.Height * toFraction);
        var finger = new PointerInputDevice(PointerKind.Touch, "finger");
        var sequence = new ActionSequence(finger, 0);
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, fromY, TimeSpan.Zero));
        sequence.AddAction(finger.CreatePointerDown(MouseButton.Left));
        sequence.AddAction(finger.CreatePointerMove(CoordinateOrigin.Viewport, x, toY, TimeSpan.FromMilliseconds(350)));
        sequence.AddAction(finger.CreatePointerUp(MouseButton.Left));
        Driver!.PerformActions([sequence]);
    }
}
