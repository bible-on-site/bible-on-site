using BibleOnSite.Tests.MobileE2E.Configuration;
using BibleOnSite.Tests.MobileE2E.Pages;
using BibleOnSite.Tests.MobileE2E.Platforms;
using OpenQA.Selenium;
using OpenQA.Selenium.Appium;
using Xunit;
using Xunit.Abstractions;

namespace BibleOnSite.Tests.MobileE2E;

// Regression test for TestFlight crash 351F87DB (5.0.132): NSAttributedString's
// NSHTML import marshals the parse back to the main thread through
// performSelectorOnMainThread, so the worker-thread offload in #1991 never
// removed the UICollectionView reentrancy — scroll churn during perushim cell
// rendering still aborted the app. The fix replaces WebKit's import with the
// managed HtmlRuns parser; this test exercises perushim HtmlView cells under
// scroll stress. iOS simulator builds carry no ODR notes pack, so the app
// launches with BIBLE_E2E_PERUSHIM=1 which fabricates perushim notes.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "iOS")]
public sealed class PerushimHtmlScrollStabilityTests(ITestOutputHelper output, MobileDeviceSessionFactory sessions)
    : IAsyncLifetime
{
    private readonly MobileTestConfiguration _configuration = MobileTestConfiguration.FromEnvironment();
    private AppiumDriver? _driver;
    private MobilePlatformAdapter _platform = null!;
    private PerekPage _page = null!;

    public Task InitializeAsync()
    {
        _platform = MobilePlatformAdapter.For(_configuration.Platform);
        var options = _platform.CreateOptions(_configuration,
            new Dictionary<string, string> { ["BIBLE_E2E_PERUSHIM"] = "1" });
        _driver = sessions.Create(() => _platform.CreateDriver(_configuration.Server, options));
        _page = new(_driver, _platform);
        _page.WaitForStartup();
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        _driver?.Quit();
        _driver?.Dispose();
        return Task.CompletedTask;
    }

    [Fact]
    public void PerushimCellsSurviveScrollStorm()
    {
        var checkedCount = CheckAllPerushim();
        Assert.True(checkedCount > 0,
            "Synthetic perushim must render checkboxes — otherwise HtmlView cells are never created");

        var list = _page.WaitFor("PasukimCollection");
        var centerX = list.Location.X + list.Size.Width / 2;
        var topY = list.Location.Y + list.Size.Height / 5;
        var bottomY = list.Location.Y + list.Size.Height * 4 / 5;

        // Back-to-back flick storms maximize cell prefetch/recycle churn while
        // every pasuk cell renders several HtmlView commentary blocks.
        for (var round = 0; round < 3; round++)
        {
            StormOnce(bottomY, topY);
            StormOnce(topY, bottomY);
        }

        // WDA resolves every pointerMove against the app element's AX snapshot
        // during synthesis; launching another storm while the previous one's
        // scroll momentum and HtmlView re-layouts are still running can hit an
        // unresolvable frame (XCTest "point.x != INFINITY"). Splitting each
        // storm into short bursts gated on a hittable element both shrinks the
        // per-request synthesis window and waits for the app to settle.
        void StormOnce(int fromY, int toY)
        {
            for (var burst = 0; burst < 3; burst++)
            {
                _page.WaitFor("PasukimCollection", _platform.CanTap);
                _driver!.PerformActions([PerekScrollStabilityTests.CreateFlickSequence(
                    centerX, fromY, centerX, toY, 10)]);
            }
        }

        var appState = _driver!.ExecuteScript("mobile: queryAppState",
            new Dictionary<string, object> { ["bundleId"] = "com.tanah.daily929" });
        output.WriteLine($"App state after perushim scroll storm: {appState}");
        // 4 = running in foreground. A crashed app reports 1 (not running).
        Assert.Equal(4L, Convert.ToInt64(appState));
        Assert.NotEmpty(_page.Source);
        Assert.NotEmpty(_page.FirstPasuk);
    }

    // Opens the perushim panel and checks every synthetic commentary so each
    // pasuk cell renders HtmlView notes; returns how many were checked.
    private int CheckAllPerushim()
    {
        _page.Tap("PerushimChevronButton");

        // The panel animates up (~250 ms); poll briefly for rendered checkboxes.
        List<AppiumElement> checkboxes = [];
        for (var attempt = 0; attempt < 10 && checkboxes.Count == 0; attempt++)
        {
            Thread.Sleep(300);
            checkboxes = _driver!
                .FindElements(_platform.AutomationId("PerushCheckBox"))
                .Where(element => element.Displayed)
                .ToList();
        }

        foreach (var checkbox in checkboxes)
        {
            _platform.Tap(_driver!, checkbox);
        }
        output.WriteLine($"Checked {checkboxes.Count} synthetic perushim.");

        _page.Tap("PerushimChevronButton");
        return checkboxes.Count;
    }
}
