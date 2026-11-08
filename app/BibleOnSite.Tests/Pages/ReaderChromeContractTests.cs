using System.Text.RegularExpressions;
using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// Source-level contract for the shared reader chrome (#2573): every reader
/// page declares the same chrome surfaces and routes their events through
/// <c>ReaderChrome</c> in code — no page may drift back to wiring the
/// bottom bar, perushim sheet, articles view, exit button or fan <c>Opening</c>
/// in XAML (that wiring is exactly what used to duplicate — and diverge —
/// across the three divisions). Behavioral coverage lives in
/// <c>ReaderChromeTests</c>.
/// </summary>
public class ReaderChromeContractTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Controls = "clr-namespace:BibleOnSite.Controls";

    private static XDocument Page(string file) => XDocument.Load(Path.Join(AppRoot, "Pages", file));

    private static string CodeBehind(string file) =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", file));

    // — Shared surfaces: one of each, on every reader ————————————————————————

    [Theory]
    [InlineData("PerekPage.xaml")]
    [InlineData("ParashaPage.xaml")]
    [InlineData("MasoraPage.xaml")]
    public void Reader_declares_the_shared_chrome_surfaces(string pageFile)
    {
        var doc = Page(pageFile);
        doc.Descendants(Controls + "ReaderBottomBar").Should().ContainSingle();
        doc.Descendants(Controls + "PerushimSheet").Should().ContainSingle();
        doc.Descendants(Controls + "ReaderArticlesView").Should().ContainSingle();
        doc.Descendants(Controls + "ReaderFanMenu").Should().ContainSingle();
        doc.Descendants(Controls + "ReaderFanMenu.Satellites").Should().ContainSingle();
        doc.Descendants(Controls + "ReaderExitFullscreenButton").Should().ContainSingle();
    }

    // — Coordinator-owned wiring: the page must not re-handle chrome events ——

    [Theory]
    [InlineData("PerekPage.xaml")]
    [InlineData("ParashaPage.xaml")]
    [InlineData("MasoraPage.xaml")]
    public void Reader_chrome_events_are_not_wired_in_xaml(string pageFile)
    {
        var doc = Page(pageFile);

        doc.Descendants(Controls + "ReaderBottomBar").Single().Attributes()
            .Select(a => a.Name.LocalName)
            .Should().NotContain(
                ["PerushimToggleRequested", "TextModeRequested", "ArticlesRequested", "FullScreenRequested"],
                "the coordinator subscribes the bottom bar itself — a XAML handler would duplicate its work");

        doc.Descendants(Controls + "PerushimSheet").Single().Attribute("IsOpenChanged")
            .Should().BeNull("the coordinator mirrors the sheet's open state onto the chevron");

        doc.Descendants(Controls + "ReaderArticlesView").Single().Attribute("ArticleSelected")
            .Should().BeNull("the coordinator owns article-tap bookkeeping and navigation");

        doc.Descendants(Controls + "ReaderExitFullscreenButton").Single().Attribute("ExitRequested")
            .Should().BeNull("the coordinator restores the chrome on exit");

        doc.Descendants(Controls + "ReaderFanMenu").Single().Attribute("Opening")
            .Should().BeNull("the coordinator refreshes prev/next as the fan opens");
    }

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_routes_chrome_through_the_coordinator(string codeFile)
    {
        var code = CodeBehind(codeFile);
        code.Should().MatchRegex(new Regex(
            @"private\s+ReaderChrome\s+_chrome\b",
            RegexOptions.Multiline),
            "each reader keeps the shared coordinator as a field (#2573)");
        code.Should().Contain("SetupReaderChrome", "each reader wires its surfaces and division adapters once");
        code.Should().NotContain("_isShowingArticles",
            "the articles/text swap state is owned by the coordinator, not duplicated per page");
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
