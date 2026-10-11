using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// Regression for #2117: device Back while a MediaElement video plays
// fullscreen must leave fullscreen, not navigate the app out from under the
// reparented player. The e2e fixture runs no API, so BIBLE_E2E_VIDEO=1 — an
// Android launch-intent extra — makes the app push a bare MediaElement page
// over the reader, exercising the same toolkit fullscreen path articles use.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Android")]
public sealed class VideoFullscreenBackTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions)
    : MobileDeviceTest(output, sessions)
{
    private static readonly By FullscreenIcon = By.Id("com.tanah.daily929:id/exo_fullscreen");
    private static readonly By Video = By.Id("com.tanah.daily929:id/E2eVideo");

    protected override AppiumOptions CreateOptions()
    {
        var options = Platform.CreateOptions(Configuration);
        options.AddAdditionalAppiumOption("optionalIntentArguments", "--es BIBLE_E2E_VIDEO 1");
        return options;
    }

    // BIBLE_E2E_VIDEO pushes the video page over the reader during startup, so
    // the reader's PerekSource never appears; the surface itself is the gate.
    protected override void AwaitStartup() =>
        Page.WaitFor("E2eVideo", element => element.Displayed);

    [Fact]
    public void BackClosesVideoFullscreenBeforeNavigating() => Scenario(() =>
    {
        var video = Page.WaitFor("E2eVideo", element => element.Displayed);
        Platform.Tap(Driver!, video);
        Page.WaitFor(FullscreenIcon, element => element.Displayed).Click();

        // Toolkit fullscreen reparents the PlayerView onto the DecorView — the
        // E2eVideo node leaves the automation tree entirely while it is up.
        WaitUntil(() => !VideoVisible(), "the player to enter fullscreen");

        Platform.GoBack(Driver!);

        // Back must close fullscreen, not navigate: the player re-embeds and
        // the video node returns to the still-present page.
        WaitUntil(VideoVisible, "the player to leave fullscreen");

        // Once fullscreen is gone the next Back follows normal navigation —
        // here it pops the e2e page back onto the reader.
        Platform.GoBack(Driver!);
        Page.WaitFor("PerekSource", element => !string.IsNullOrWhiteSpace(element.Text));
    });

    private bool VideoVisible()
    {
        try
        {
            return Driver!.FindElements(Video).Any(element => element.Displayed);
        }
        catch (StaleElementReferenceException)
        {
            // The node is mid-reparent (entering or leaving fullscreen).
            return false;
        }
    }

    private void WaitUntil(Func<bool> condition, string what)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (DateTime.UtcNow < deadline)
        {
            if (condition())
            {
                return;
            }
            Thread.Sleep(200);
        }
        Assert.Fail($"Timed out waiting for {what}.");
    }
}
