using System.Text.RegularExpressions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// Source-level contract for #3378: every reader owns its screen_view so the
/// Shell event never double-counts, picks the scoped descriptor (reader vs
/// articles list), and the catalogue/detail pages resolve real content
/// identity — no page may drift back to the bare type-name fallback or an
/// id-only row. Descriptor semantics live in AnalyticsScreensTests.
/// </summary>
public class AnalyticsScreenContractTests
{
    private static readonly string AppRoot = FindAppRoot();

    private static string CodeBehind(string file) =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", file));

    [Theory]
    [InlineData("PerekPage.xaml.cs", "perek")]
    [InlineData("ParashaPage.xaml.cs", "parasha")]
    [InlineData("MasoraPage.xaml.cs", "masora")]
    [InlineData("MoedPage.xaml.cs", "moed")]
    public void Reader_suppresses_shell_event_and_self_reports(string codeFile, string division)
    {
        var code = CodeBehind(codeFile);

        code.Should().Contain("IAnalyticsScreenName",
            $"{division}: the reader declares analytics ownership so the Shell event is suppressed");
        code.Should().Contain("AnalyticsScreen => null",
            $"{division}: the reader self-reports — a Shell event would double-count swipes and panel swaps");
        EmitMethodBody(code, division).Should().Contain("AnalyticsScreens.Report(",
            $"{division}: the emit method must actually send the resolved descriptor, not just exist");
    }

    [Theory]
    [InlineData("PerekPage.xaml.cs", "perek")]
    [InlineData("ParashaPage.xaml.cs", "parasha")]
    [InlineData("MasoraPage.xaml.cs", "masora")]
    [InlineData("MoedPage.xaml.cs", "moed")]
    public void Reader_articles_panel_reports_through_the_shared_swap(string codeFile, string division)
    {
        var code = CodeBehind(codeFile);

        code.Should().Contain("ArticlesVisibilityChanged",
            $"{division}: the articles/reader swap re-reports the visible surface via the coordinator");
        code.Should().Contain("ForArticlesList",
            $"{division}: an open articles panel reports the scoped list, not the reading unit");
        code.Should().Contain("ReaderArticles",
            $"{division}: the in-reader list reports its own stable page family");
    }

    [Theory]
    [InlineData("PerekPage.xaml.cs", "perek")]
    [InlineData("ParashaPage.xaml.cs", "parasha")]
    [InlineData("MasoraPage.xaml.cs", "masora")]
    [InlineData("MoedPage.xaml.cs", "moed")]
    public void Reader_never_reports_a_phantom_zero_id(string codeFile, string division)
    {
        var body = EmitMethodBody(CodeBehind(codeFile), division);

        body.Should().MatchRegex(new Regex(@"(PerekId|UnitId)\s*<=\s*0[^;]*return"),
            $"{division}: the emit method's own guard returns on an unresolved id — resolved identity owns the visit");
        body.Should().MatchRegex(new Regex(@"(PerekId|UnitId)\s*<=\s*0[\s\S]*AnalyticsScreens\.Report\("),
            $"{division}: the id guard must precede the Report call inside the emit method");
    }

    [Fact]
    public void ArticlesPage_reports_its_browsing_scope()
    {
        var code = CodeBehind("ArticlesPage.xaml.cs");

        code.Should().Contain("IAnalyticsScreenName");
        code.Should().Contain("ForArticlesList",
            "the catalogue reports perek/author/global scope — never the bare page name");
        code.Should().Contain("ArticlesListScope.Author");
        code.Should().Contain("ArticlesListScope.Perek");
        code.Should().Contain("ArticlesListScope.All");
    }

    [Fact]
    public void ArticleDetailPage_reports_once_metadata_resolves()
    {
        var code = CodeBehind("ArticleDetailPage.xaml.cs");

        code.Should().Contain("AnalyticsScreen => null",
            "the detail page self-reports — a Shell event would ship an id-only name");
        code.Should().MatchRegex(new Regex(@"await LoadArticleAsync\(\);\s*SetAnalyticsScreenForArticle\(\);"),
            "the single screen_view fires after the article resolves — delayed metadata never produces a generic event");
        code.Should().Contain("ForArticle");
    }

    /// <summary>
    /// The body of the page's private <c>SetAnalyticsScreenFor*</c> emit
    /// method (up to its column-4 closing brace) — pinning assertions to the
    /// method itself instead of accepting guards or calls anywhere in the file.
    /// </summary>
    private static string EmitMethodBody(string code, string division)
    {
        var method = Regex.Match(code,
            @"private void SetAnalyticsScreenFor\w+\(\)(?<body>[\s\S]*?)\n    \}");
        method.Success.Should().BeTrue($"{division}: the reader emits its resolved-identity screen itself");
        return method.Groups["body"].Value;
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
