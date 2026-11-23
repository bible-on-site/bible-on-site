namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #3728: during recitation playback the reader must follow the spoken verse —
/// pressing play while the pasuk sits off-screen brings it into view. Pin the
/// contract on every reader's highlight path: the highlight mapper issues a
/// follow scroll gated on the user not already scrolling, through
/// <see cref="BibleOnSite.Helpers.ReaderScrollTop.ScrollToItem"/>.
/// </summary>
public class RecitationFollowScrollContractTests
{
    private static readonly string AppRoot = FindAppRoot();

    [Theory]
    [InlineData("MoedPage.Recitation.cs")]
    [InlineData("PerekPage.Recitation.cs")]
    [InlineData("ParashaPage.Recitation.cs")]
    [InlineData("MasoraPage.Recitation.cs")]
    public void Reader_FollowsSpokenVerseIntoView(string fileName)
    {
        var source = File.ReadAllText(Path.Join(AppRoot, "Pages", fileName));
        Assert.Contains("ReaderScrollTop.ScrollToItem(", source);
        Assert.Contains("!IsScrolling", source);
    }

    [Fact]
    public void FollowScroll_ScrollsMinimallyAndHonoursMotionPreference()
    {
        var source = File.ReadAllText(Path.Join(AppRoot, "Helpers", "ReaderScrollTop.cs"));
        Assert.Contains("ScrollToPosition.MakeVisible", source);
        Assert.Contains("AnimateScroll()", source);
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
