namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #2638: the word/verse recitation "עדיין בהכנה" notice was a temporary
/// construction measure and must not come back — not as a dialog, hint,
/// control label or differently worded variant. Real availability failures
/// (no recording, corrupt pack data) keep their actionable alerts, so this
/// guard pins both sides of the contract on the reader's recitation
/// surfaces: construction wording absent, real error reporting present.
/// </summary>
public class RecitationConstructionGuardTests
{
    private static readonly string AppRoot = FindAppRoot();

    [Fact]
    public void ReaderSurfaces_ContainNoConstructionMessaging()
    {
        var offenders = new List<string>();
        foreach (var dir in new[] { "Pages", "Controls", "Helpers" })
        {
            foreach (var ext in new[] { "*.cs", "*.xaml" })
            {
                foreach (var file in Directory.EnumerateFiles(Path.Join(AppRoot, dir), ext, SearchOption.AllDirectories))
                {
                    var source = File.ReadAllText(file);
                    if (source.Contains("בהכנה", StringComparison.Ordinal) ||
                        source.Contains("בבניה", StringComparison.Ordinal))
                    {
                        offenders.Add(Path.GetRelativePath(AppRoot, file));
                    }
                }
            }
        }
        Assert.Empty(offenders);
    }

    [Theory]
    [InlineData("PerekPage.Recitation.cs")]
    [InlineData("ParashaPage.Recitation.cs")]
    public void PasukRecitation_KeepsRealAvailabilityErrors(string fileName)
    {
        var source = File.ReadAllText(Path.Join(AppRoot, "Pages", fileName));
        // Missing recordings still get a factual "no audio" alert, and a
        // "ready" track missing a pasuk's timings still reports like other
        // playback failures — removing the construction notice must not take
        // real error handling with it.
        Assert.Contains("אין הקלטה לפרק זה", source);
        Assert.Contains("בדקו את חבילת ההקראה בהעדפות", source);
    }

    [Theory]
    [InlineData("PerekPage.Recitation.cs")]
    [InlineData("ParashaPage.Recitation.cs")]
    public void FocusedPasuk_KeepUsablePlaybackInstructionsOnly(string fileName)
    {
        var source = File.ReadAllText(Path.Join(AppRoot, "Pages", fileName));
        Assert.Contains("הקישו על מילה כדי לשמוע אותה.", source);
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
