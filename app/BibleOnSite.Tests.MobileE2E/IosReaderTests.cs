using System.Drawing;
using OpenQA.Selenium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Regression coverage for iPhone issues #1306 and #1308. The RTL navigation
// drawer must open on a right-edge swipe even though the perek carousel listens
// on the same touches, and the reader must span the window width in landscape
// instead of sitting inside symmetric safe-area bands.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "iOS")]
public sealed class IosReaderTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions)
    : MobileDeviceTest(output, sessions)
{
    [Fact]
    public void RightEdgeSwipeOpensAndScrimTapClosesTheFlyout() => Scenario(() =>
    {
        Platform.OpenFlyoutViaRightEdgeSwipe(Driver!);
        Assert.True(Page.WaitFor("FlyoutPreferences", element => element.Enabled).Displayed);
        Platform.DismissFlyoutViaScrim(Driver!);
        Page.WaitForHidden("FlyoutPreferences");
        Assert.NotEmpty(Page.Source);
    });

    [Fact]
    public void LandscapeReaderSpansTheWindowWidth() => Scenario(() =>
    {
        try
        {
            Driver!.Orientation = ScreenOrientation.Landscape;
            var window = WaitForLandscapeWindow();
            var frame = Page.WaitForStableFrame("PasukimCollection");
            Assert.True(frame.Location.X <= 24,
                $"PasukimCollection starts {frame.Location.X}pt from the left of a {window.Width}pt window: " +
                "the reader keeps its small page margin but must not sit inside the landscape safe-area band (#1308).");
            Assert.True(frame.Location.X + frame.Size.Width >= window.Width - 24,
                $"PasukimCollection ends {window.Width - frame.Location.X - frame.Size.Width}pt before the right of a {window.Width}pt window: " +
                "the reader keeps its small page margin but must not sit inside the landscape safe-area band (#1308).");
        }
        finally
        {
            Driver!.Orientation = ScreenOrientation.Portrait;
        }
    });

    private Size WaitForLandscapeWindow()
    {
        var timeout = TimeSpan.FromSeconds(15);
        var deadline = DateTime.UtcNow.Add(timeout);
        while (DateTime.UtcNow < deadline)
        {
            var size = Driver!.Manage().Window.Size;
            if (size.Width > size.Height)
            {
                return size;
            }
            Thread.Sleep(200);
        }
        throw new WebDriverTimeoutException($"The simulator never reported a landscape window within {timeout.TotalSeconds} seconds.");
    }
}
