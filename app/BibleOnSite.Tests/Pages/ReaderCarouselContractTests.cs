using FluentAssertions;
using System.Xml.Linq;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// Source-level contract for the shared reader carousel and display-sync
/// coordinators (#2573): every reader page hands its carousel interaction
/// plumbing — the programmatic-scroll guard, the rotation resnap and the
/// Android swipe settle — to <c>ReaderCarousel</c>, and its font/theme/notes
/// synchronization to <c>ReaderDisplaySync</c>, so a fix lands on all three
/// divisions at once. Pages keep only the division plugs; this suite fails if
/// a page drifts back to owning the plumbing. Behavioral coverage lives in
/// <c>ReaderCarouselTests</c> and <c>ReaderDisplaySyncTests</c>.
/// </summary>
public class ReaderCarouselContractTests
{
    private static readonly string AppRoot = FindAppRoot();

    private static string CodeBehind(string file) =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", file));

    // — Coordinator-owned plumbing: constructed, lifecycle-delegated ————————

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_carousel_delegates_to_the_shared_coordinator(string codeFile)
    {
        var code = CodeBehind(codeFile);
        code.Should().MatchRegex(@"private\s+ReaderCarousel\s+_carousel\b",
            "each reader keeps the shared carousel coordinator as a field (#2573)");
        code.Should().Contain("new ReaderCarousel(",
            "each reader supplies its surfaces and division plugs once");
        code.Should().Contain("_carousel.Appearing()",
            "the appearing slot attaches the native swipe plumbing");
        code.Should().Contain("_carousel.Disappearing()",
            "the disappearing slot releases it");
    }

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_display_sync_delegates_to_the_shared_coordinator(string codeFile)
    {
        var code = CodeBehind(codeFile);
        code.Should().MatchRegex(@"private\s+ReaderDisplaySync\s+_displaySync\b",
            "each reader keeps the shared display-sync coordinator as a field (#2573)");
        code.Should().Contain("new ReaderDisplaySync(",
            "each reader supplies its surfaces and division plugs once");
    }

    // — The plumbing must not drift back into page code ————————————————————
    // If this list trips, move the behavior into the shared coordinator
    // instead of resurrecting a page copy that can diverge (#2573).

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_keeps_no_per_page_carousel_plumbing(string codeFile)
    {
        var code = CodeBehind(codeFile);
        foreach (var forbidden in new[]
        {
            "_carouselInitializing", "_pendingCarouselResnap", "OnCarouselSizeChanged",
            "ResnapCarousel", "UnitIndexOf", "SettleSwipe",
            "OnTouchStarted", "OnTouchDispatched", "OnTouchMoved", "OnTouchReleased",
            "SwipeNavigationTracker", "ContainsTouch",
        })
        {
            code.Should().NotContain(forbidden,
                $"the carousel coordinator owns {forbidden} — a page copy would diverge");
        }
    }

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_keeps_no_per_page_display_sync_plumbing(string codeFile)
    {
        var code = CodeBehind(codeFile);
        foreach (var forbidden in new[]
        {
            "SetupFontSizeResources", "UpdateFontSizeResources",
            "SubscribeNotesMaterialization", "OnNotesOperationCompleted",
            "SubscribeThemeChange", "OnRequestedThemeChanged",
            "RefreshPerushimIfAvailabilityChangedAsync", "StatusBarBehavior",
        })
        {
            code.Should().NotContain(forbidden,
                $"the display-sync/platform coordinators own {forbidden} — a page copy would diverge");
        }
    }

    [Theory]
    [InlineData("PerekPage.xaml")]
    [InlineData("ParashaPage.xaml")]
    [InlineData("MasoraPage.xaml")]
    public void Inline_commentary_links_keep_native_reader_navigation(string xamlFile)
    {
        var page = XDocument.Load(Path.Join(AppRoot, "Pages", xamlFile));
        var inline = page.Descendants().Single(element => element.Name.LocalName == "InlinePerushimView");
        (inline.Attribute("LinkTapped")?.Value).Should().Be("OnContentLinkTapped",
            "extracting the shared template must preserve each reader's native link navigation");
        var template = XDocument.Load(Path.Join(AppRoot, "Controls", "InlinePerushimView.xaml"));
        (template.Descendants().Single(element => element.Name.LocalName == "HtmlView")
            .Attribute("LinkTapped")?.Value).Should().Be("OnContentLinkTapped",
                "rendered links must reach the shared control's forwarding handler");
    }

    private static string FindAppRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Join(dir, "BibleOnSite");
            if (Directory.Exists(candidate) && File.Exists(Path.Join(candidate, "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var siblingCandidate = Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite");
            if (Directory.Exists(siblingCandidate) && File.Exists(Path.Join(siblingCandidate, "BibleOnSite.csproj")))
            {
                return siblingCandidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException(
            "Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
    }
}
