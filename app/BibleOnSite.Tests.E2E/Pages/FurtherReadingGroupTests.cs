using BibleOnSite.Tests.E2E.Fixtures;
using FlaUI.Core.AutomationElements;
using FlaUI.Core.Conditions;
using FlaUI.Core.Capturing;

namespace BibleOnSite.Tests.E2E.Pages;

/// <summary>API-backed app instance booted onto בראשית ב — the test
/// database gives it no primary article but one verified covering source
/// (article 1, owned by בראשית א), so its articles view is the לקריאה
/// נוספת section alone (#3752).</summary>
public sealed class FurtherReadingSecondaryFixture : AppFixture
{
    protected override IEnumerable<KeyValuePair<string, string>> LaunchEnvironment =>
        [new("BIBLE_E2E_PEREK", "2")];
}

/// <summary>API-backed app instance booted onto בראשית א — the mirror
/// case: primary articles but no secondary coverage, so the articles list
/// stays flat and untitled (#3752).</summary>
public sealed class FurtherReadingPrimaryFixture : AppFixture
{
    protected override IEnumerable<KeyValuePair<string, string>> LaunchEnvironment =>
        [new("BIBLE_E2E_PEREK", "1")];
}

[CollectionDefinition("Further reading secondary", DisableParallelization = true)]
public sealed class FurtherReadingSecondaryCollection : ICollectionFixture<FurtherReadingSecondaryFixture>;

[CollectionDefinition("Further reading primary", DisableParallelization = true)]
public sealed class FurtherReadingPrimaryCollection : ICollectionFixture<FurtherReadingPrimaryFixture>;

/// <summary>Shared probes for the articles-view group assertions — the
/// visibility tree + real bounds are the honest "the app renders this"
/// signal: a collapsed row keeps a stale peer in the raw tree.</summary>
public abstract class FurtherReadingViewProbe(AppFixture fixture)
{
    /// <summary>Opens the articles view and returns its live root.</summary>
    protected async Task<AutomationElement> OpenArticlesViewAsync()
    {
        await InvokeButtonAsync("ArticlesButton");
        var articles = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId("ReaderArticlesView"))
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Height: > 200 }),
            TimeSpan.FromSeconds(15));
        articles.Should().NotBeNull("the articles button must swap in the article catalogue");
        await DismissFlyoutAsync();
        return articles!;
    }

    /// <summary>The Shell flyout sometimes surfaces over the reader (a
    /// covering desktop window refocuses the app mid-gesture); a live
    /// destination row means it is presented — the hamburger toggles it
    /// closed so it cannot occlude the captured view.</summary>
    private async Task DismissFlyoutAsync()
    {
        var flyoutRow = fixture.MainWindow.FindAllDescendants(fixture.CF.ByName("העדפות"))
            .FirstOrDefault(element => IsVisibleInTree(element)
                && element.BoundingRectangle is { Width: > 0, Height: > 0 });
        if (flyoutRow is null)
        {
            return;
        }

        await InvokeButtonAsync("ReaderNavigationButton");
        await fixture.WaitForElementAsync(_ =>
            fixture.MainWindow.FindAllDescendants(fixture.CF.ByName("העדפות"))
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Width: > 0, Height: > 0 }) is null
                ? fixture.MainWindow : null,
            TimeSpan.FromSeconds(5));
    }

    /// <summary>Polls for a live descendant matching the condition under the
    /// given root — presence in the tree is not proof, only real bounds and
    /// an on-screen ancestry are.</summary>
    protected async Task<AutomationElement?> LiveDescendantAsync(
        AutomationElement root, ConditionBase condition) =>
        await fixture.WaitForElementAsync(_ =>
            root.FindAllDescendants(condition)
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Width: > 0, Height: > 0 }),
            TimeSpan.FromSeconds(15));

    /// <summary>Fires a live button's Invoke pattern — it drives the real
    /// handler without needing the desktop foreground.</summary>
    protected async Task InvokeButtonAsync(string automationId)
    {
        var button = await fixture.WaitForElementAsync(window =>
            window.FindAllDescendants(fixture.CF.ByAutomationId(automationId))
                .FirstOrDefault(element => IsVisibleInTree(element)
                    && element.BoundingRectangle is { Width: > 0, Height: > 0 }),
            TimeSpan.FromSeconds(30));
        button.Should().NotBeNull($"{automationId} must render in every content mode");
        if (button!.Patterns.Invoke.TryGetPattern(out var invoke))
        {
            invoke.Invoke();
            return;
        }
        fixture.MainWindow.SetForeground();
        fixture.Click(button!);
    }

    /// <summary>Writes the main window's rendered pixels to the E2E artifacts
    /// directory — the grouped-header and flat-list frames are this issue's
    /// visual evidence (#3752). The capture reads the screen region, so the
    /// window is raised first: a covering desktop window would otherwise
    /// paint over the app's pixels.</summary>
    protected async Task CaptureScreenshotAsync(string name)
    {
        fixture.MainWindow.SetForeground();
        await Task.Delay(600);
        var artifacts = Path.GetFullPath(Path.Join(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".artifacts"));
        Directory.CreateDirectory(artifacts);
        using var capture = Capture.Element(fixture.MainWindow);
        capture.ToFile(Path.Join(artifacts, name));
    }

    /// <summary>The element itself and every ancestor report on-screen and
    /// enabled — a hidden row keeps a stale peer whose parent chain still
    /// reports the last state.</summary>
    protected static bool IsVisibleInTree(AutomationElement element)
    {
        for (var node = (AutomationElement?)element; node != null; node = node.Parent)
        {
            if ((node.Properties.IsOffscreen.TryGetValue(out var offscreen) && offscreen)
                || (node.Properties.IsEnabled.TryGetValue(out var enabled) && !enabled))
            {
                return false;
            }
        }
        return true;
    }
}

/// <summary>
/// #3752 rendered check: on a perek whose only article coverage is
/// secondary, the reader's articles view shows the לקריאה נוספת group
/// header above the recommended card — no untitled primary group precedes
/// it because the perek has none of its own.
/// </summary>
[Collection("Further reading secondary")]
public sealed class FurtherReadingGroupTests(FurtherReadingSecondaryFixture fixture)
    : FurtherReadingViewProbe(fixture)
{
    [Fact]
    public async Task SecondaryOnlyPerek_GroupsRecommendationUnderTitledHeader()
    {
        var articles = await OpenArticlesViewAsync();

        var header = await LiveDescendantAsync(articles, fixture.CF.ByName("לקריאה נוספת"));
        header.Should().NotBeNull(
            "a perek whose only coverage is secondary still renders the titled group (#3752)");

        var card = await LiveDescendantAsync(articles, fixture.CF.ByName("קרא עוד"));
        card.Should().NotBeNull("the recommended article reuses the regular card row");
        card!.BoundingRectangle.Top.Should().BeGreaterThanOrEqualTo(header!.BoundingRectangle.Bottom - 1,
            "the recommendation card sits below its לקריאה נוספת header");
        await CaptureScreenshotAsync("further-reading-secondary-only.png");
    }
}

/// <summary>
/// #3752 mirror check: a perek with primary articles but no secondary
/// coverage keeps the flat untitled list — no לקריאה נוספת header renders.
/// </summary>
[Collection("Further reading primary")]
public sealed class FurtherReadingFlatListTests(FurtherReadingPrimaryFixture fixture)
    : FurtherReadingViewProbe(fixture)
{
    [Fact]
    public async Task PrimaryOnlyPerek_KeepsFlatUntitledList()
    {
        var articles = await OpenArticlesViewAsync();

        var card = await LiveDescendantAsync(articles, fixture.CF.ByName("קרא עוד"));
        card.Should().NotBeNull("the perek's own articles still render");
        articles.FindAllDescendants(fixture.CF.ByName("לקריאה נוספת"))
            .Where(element => IsVisibleInTree(element)
                && element.BoundingRectangle is { Width: > 0, Height: > 0 })
            .Should().BeEmpty("nothing covers בראשית א, so no group header renders (#3752)");
        await CaptureScreenshotAsync("articles-flat-no-further-reading.png");
    }
}
