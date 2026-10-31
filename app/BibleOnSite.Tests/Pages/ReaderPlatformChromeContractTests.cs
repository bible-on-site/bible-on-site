using System.Text.RegularExpressions;
using System.Xml.Linq;
using FluentAssertions;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// Source-level contract for the shared reader platform chrome (#2573):
/// every reader page hands its native plumbing — iOS safe area and edge-back
/// history, Android predictive-Back registration, Windows keyboard Back and
/// the capsule's enabled-state wiring — to <c>ReaderPlatformChrome</c>, so a
/// fix lands on all three divisions at once. Pages keep only the policy
/// (which surfaces consume Back and what Back does); this suite fails if a
/// page drifts back to owning the plumbing. Behavioral coverage lives in
/// <c>ReaderPlatformChromeTests</c>.
/// </summary>
public class ReaderPlatformChromeContractTests
{
    private static readonly string AppRoot = FindAppRoot();

    private static readonly string[] ReaderPages = ["PerekPage", "ParashaPage", "MasoraPage"];

    private static string CodeBehind(string file) =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", file));

    // — Coordinator-owned lifecycle: Appearing/Disappearing delegate once ———

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_lifecycle_delegates_to_the_platform_chrome(string codeFile)
    {
        var code = CodeBehind(codeFile);
        code.Should().MatchRegex(new Regex(
            @"private\s+ReaderPlatformChrome\s+_platformChrome\b", RegexOptions.Multiline),
            "each reader keeps the shared platform coordinator as a field (#2573)");
        code.Should().Contain("new ReaderPlatformChrome(",
            "each reader supplies its surfaces and division plugs once");
        code.Should().Contain("_platformChrome.Appearing()",
            "the appearing slot registers the native plumbing");
        code.Should().Contain("_platformChrome.Disappearing()",
            "the disappearing slot releases it");
        code.Should().Contain("_platformChrome.ScheduleHistoryRefresh()",
            "the deferred iOS history re-check stays scheduled");
    }

    // — The plumbing must not drift back into page code ————————————————————

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_keeps_no_per_page_native_chrome_plumbing(string codeFile)
    {
        var code = CodeBehind(codeFile);
        foreach (var forbidden in new[]
        {
            "ConfigureReaderSafeArea", "ApplyBottomBarSafeArea", "OnPageSizeChanged",
            "ConfigureIosReaderHistory", "RestoreIosInteractiveBack", "GiveNativeBackPriority",
            "WireReaderBackChrome", "OnReaderSurfaceVisibilityChanged",
            "RegisterReaderBack", "UnregisterReaderBack", "UpdateReaderBack",
            "RegisterReaderKeyboardBack", "UnregisterReaderKeyboardBack",
            "ReaderBackCallback", "_readerBack",
        })
        {
            code.Should().NotContain(forbidden,
                $"the platform chrome coordinator owns {forbidden} — a page copy would diverge");
        }
    }

    [Fact]
    public void Reader_keeps_no_per_page_platform_back_partials()
    {
        foreach (var page in ReaderPages)
        {
            foreach (var suffix in new[] { ".AndroidBack.cs", ".WindowsBack.cs" })
            {
                File.Exists(Path.Join(AppRoot, "Pages", page + suffix))
                    .Should().BeFalse(
                        $"{page}'s native back plumbing lives in ReaderPlatformChrome, not a page partial");
            }
        }
    }

    // — The policy stays page-owned ————————————————————————————————————————

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_keeps_its_back_policy(string codeFile)
    {
        var code = CodeBehind(codeFile);
        code.Should().Contain("TryHandleReaderBack",
            "each division's Back-consumption ordering stays a page decision");
        code.Should().Contain("OwnsReturnSurface",
            "each division declares which transient surfaces keep Back alive");
    }

    // — iOS history refresh on realized lists, on every reader —————————————

    [Theory]
    [InlineData("PerekPage.xaml.cs")]
    [InlineData("ParashaPage.xaml.cs")]
    [InlineData("MasoraPage.xaml.cs")]
    public void Reader_list_realization_delegates_to_the_platform_chrome(string codeFile)
    {
        var code = CodeBehind(codeFile);
        code.Should().Contain("_platformChrome.ReaderSurfaceRealized()",
            "newly realized verse lists re-assert the iOS edge-gesture priority");
    }

    [Theory]
    [InlineData("PerekPage.xaml")]
    [InlineData("ParashaPage.xaml")]
    [InlineData("MasoraPage.xaml")]
    public void Reader_wires_its_pasuk_list_realization_in_xaml(string pageFile)
    {
        var doc = XDocument.Load(Path.Join(AppRoot, "Pages", pageFile));
        doc.Descendants()
            .Where(e => e.Name.LocalName == "CollectionView")
            .Attributes("Loaded")
            .Select(a => a.Value)
            .Should().Contain("OnReaderListLoaded",
                "every reader's pasuk list feeds the same realized-list refresh");
    }

    // — Surface contract: the search bar declares the shared interface ——————

    [Fact]
    public void FloatingSearchBar_declares_the_reader_search_surface()
    {
        var code = File.ReadAllText(Path.Join(AppRoot, "Controls", "FloatingSearchBar.xaml.cs"));
        code.Should().Contain("IReaderSearchSurface",
            "the coordinator consumes the search surface through its interface seam");
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
