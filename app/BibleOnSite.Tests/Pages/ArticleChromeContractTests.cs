using System.Text.RegularExpressions;
using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// Source-level contract for the shared article command surface (#2786):
/// every article view — the article detail page and the Tanahpedia entry
/// page — declares the same chrome and routes its events through
/// <c>ArticleChrome</c> in code, so no page drifts back to a lone share
/// button in the trailing slot, a missing fullscreen command, or XAML event
/// wiring that bypasses the coordinator. Behavioral coverage lives in
/// <c>ArticleChromeTests</c>.
/// </summary>
public class ArticleChromeContractTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Controls = "clr-namespace:BibleOnSite.Controls";

    private static XDocument Page(string file) => XDocument.Load(Path.Join(AppRoot, "Pages", file));

    private static string CodeBehind(string file) =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", file));

    // — Shared surfaces: one of each, on every article view ——————————————————

    [Theory]
    [InlineData("ArticleDetailPage.xaml")]
    [InlineData("TanahpediaEntryPage.xaml")]
    public void ArticleView_declares_the_shared_chrome_surfaces(string pageFile)
    {
        var doc = Page(pageFile);
        doc.Descendants(Controls + "SharedTopBar").Should().ContainSingle(
            "return navigation rides the shared capsule Back — no page-owned return row");
        doc.Descendants(Controls + "ArticleActionsBar").Should().ContainSingle(
            "share and fullscreen live in the one actions pill");
        doc.Descendants(Controls + "ReaderExitFullscreenButton").Should().ContainSingle(
            "the readers' floating exit control is the fullscreen affordance");
    }

    // — Coordinator-owned wiring: the page must not re-handle chrome events ——

    [Theory]
    [InlineData("ArticleDetailPage.xaml")]
    [InlineData("TanahpediaEntryPage.xaml")]
    public void ArticleView_chrome_events_are_not_wired_in_xaml(string pageFile)
    {
        var doc = Page(pageFile);

        var actions = doc.Descendants(Controls + "ArticleActionsBar").Single();
        actions.Attribute("FullScreenRequested")
            .Should().BeNull("the coordinator subscribes the actions pill itself");
        actions.Attribute("ShareCommand")
            .Should().NotBeNull("Share stays bound to the page's command through the pill");

        doc.Descendants(Controls + "ReaderExitFullscreenButton").Single().Attribute("ExitRequested")
            .Should().BeNull("the coordinator restores the chrome on exit");
    }

    [Theory]
    [InlineData("ArticleDetailPage.xaml.cs")]
    [InlineData("TanahpediaEntryPage.xaml.cs")]
    public void ArticleView_routes_chrome_through_the_coordinator(string codeFile)
    {
        var code = CodeBehind(codeFile);
        code.Should().MatchRegex(new Regex(
            @"private\s+ArticleChrome\s+_chrome\b",
            RegexOptions.Multiline),
            "each article view keeps the shared coordinator as a field (#2786)");
        code.Should().Contain("SetupArticleChrome", "each article view wires its surfaces once");
        code.Should().Contain("_chrome.HandleBack()",
            "Back releases the fullscreen surface before navigation — the readers' ordering");
        code.Should().Contain("BackStateProvider",
            "fullscreen is a page-owned transient surface reported to the capsule Back");
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
