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

        // כתובים's first sefer is תהלים — a long chapter list that must overflow.
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
