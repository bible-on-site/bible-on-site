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
        var popup = Page.WaitFor("PerekPickerPopup");

        // #2475: the list uses the available column height, not a fixed band.
        var listFrame = MobilePlatformAdapter.ReadFrame(perekList);
        var popupFrame = MobilePlatformAdapter.ReadFrame(popup);
        Assert.True(listFrame.Size.Height > popupFrame.Size.Height * 0.5,
            $"list height {listFrame.Size.Height} should fill most of the popup height {popupFrame.Size.Height}");

        // At the top of a long list: up is a boundary, down reports more content.
        Assert.Equal(TopBoundary, EdgeState(Page.WaitFor("PerekPickerPerekUp")));
        Assert.Equal(MoreBelow, EdgeState(Page.WaitFor("PerekPickerPerekDown")));
        // The 3-item group column fits entirely: both directions are boundaries.
        Assert.Equal(TopBoundary, EdgeState(Page.WaitFor("PerekPickerGroupUp")));
        Assert.Equal(BottomBoundary, EdgeState(Page.WaitFor("PerekPickerGroupDown")));

        // Scrolling down opens the upward direction.
        FlickList("PerekPickerPerekList", fromFraction: 0.8, toFraction: 0.2);
        Page.WaitFor("PerekPickerPerekUp", element => EdgeState(element) == MoreAbove);
        Assert.Equal(MoreBelow, EdgeState(Page.WaitFor("PerekPickerPerekDown")));

        // A short book fits entirely: both arrows return to boundary state.
        TapItem("PickerSeferItem", "איכה");
        Page.WaitFor("PerekPickerPerekDown", element => EdgeState(element) == BottomBoundary);
        Assert.Equal(TopBoundary, EdgeState(Page.WaitFor("PerekPickerPerekUp")));

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
        Assert.NotEmpty(Driver!.FindElements(Platform.AutomationId("CircularMenuScrim"))
            .Where(element => element.Displayed).ToList());
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
        var list = Page.WaitFor(automationId);
        var (location, size) = MobilePlatformAdapter.ReadFrame(list);
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

    // SemanticProperties.Description surfaces as content-desc on Android and
    // label on iOS; it carries the arrow's boundary/available state.
    private static string? EdgeState(AppiumElement element) =>
        element.GetAttribute("content-desc") ?? element.GetAttribute("label") ?? element.GetAttribute("name");
}
