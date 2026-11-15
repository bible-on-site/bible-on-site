using System.Text.RegularExpressions;
using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// Source-level contract for reading-progress indicator placement (#3364):
/// the indicator lives only on reading surfaces — never on an article
/// catalogue — and every reader registers its indicator (or the explicit
/// lack of one) with the shared <c>ReaderChrome</c> coordinator, which owns
/// hiding and restoring it through the articles/text swap. Behavioral
/// coverage lives in <c>ReaderChromeTests</c>; the article detail view
/// model's metric coverage lives in <c>ArticleDetailViewModelTests</c>.
/// </summary>
public class ReadingProgressPlacementContractTests
{
    private static readonly string AppRoot = FindAppRoot();
    private static readonly XNamespace Xaml = "http://schemas.microsoft.com/dotnet/2021/maui";

    private static XDocument Source(string directory, string file) =>
        XDocument.Load(Path.Join(AppRoot, directory, file));

    private static string CodeBehind(string file) =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", file));

    // — Article catalogues never carry a reading-position indicator ——————————

    [Theory]
    [InlineData("Pages", "ArticlesPage.xaml")]
    [InlineData("Controls", "ReaderArticlesView.xaml")]
    public void Article_catalogues_declare_no_progress_indicator(string directory, string file)
    {
        Source(directory, file)
            .Descendants(Xaml + "ProgressBar")
            .Should().BeEmpty(
                "an articles list is not a reading view — a position indicator over it is the #3364 misplacement");
    }

    // — Every reader declares its indicator surface to the coordinator ———————

    [Fact]
    public void Perek_registers_its_reading_progress_indicator()
    {
        CodeBehind("PerekPage.xaml.cs")
            .Should().MatchRegex(new Regex(@"ReadingProgressIndicator\s*=\s*ReadingProgressBar\b"),
                "the coordinator hides the perek hairline while the articles view replaces the reader content");
    }

    [Theory]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Readers_without_an_indicator_declare_it_absent(string codeFile)
    {
        CodeBehind(codeFile)
            .Should().MatchRegex(new Regex(@"ReadingProgressIndicator\s*=\s*null\b"),
                "the required surface forces each reader to state it has no reading indicator");
    }

    // — The article reading view keeps its own bound indicator ———————————————

    [Fact]
    public void Article_detail_declares_a_bound_reading_progress_indicator()
    {
        var bar = Source("Pages", "ArticleDetailPage.xaml")
            .Descendants(Xaml + "ProgressBar")
            .SingleOrDefault(e => (string?)e.Attribute("AutomationId") == "ArticleReadingProgressBar");

        bar.Should().NotBeNull(
            "an individual article's reading view shows word-weighted progress (#2607, missing on 5.1.15 — #3364)");
        bar!.Attribute("IsVisible")?.Value.Should().Be("{Binding HasReadingProgress}",
            "the bar stays hidden on unknown or empty metrics");
        bar.Attribute("Progress")?.Value.Should().Be("{Binding ReadingProgress}");
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
