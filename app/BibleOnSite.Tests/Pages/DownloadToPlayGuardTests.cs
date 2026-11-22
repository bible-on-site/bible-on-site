namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #3704: only a deliberate Play tap may start a sefer's pack download.
/// Pasuk-focus opens, pasuk previews and word previews are implicit local
/// playback — they must never fetch a pack unasked (Devin review on #3723).
/// The opt-in travels as <c>downloadIfMissing</c> on PlayRecitationAsync,
/// so this guard pins the flag's default and the exact call sites that
/// set it — a future preview opting in breaks this contract deliberately.
/// </summary>
public class DownloadToPlayGuardTests
{
    private static readonly string AppRoot = FindAppRoot();

    private static string RecitationSource =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", "PerekPage.Recitation.cs"));

    private static string CodeBehindSource =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", "PerekPage.xaml.cs"));

    [Fact]
    public void DownloadOptIn_DefaultsOff_AtThePlaybackEntryPoint()
    {
        Assert.Contains("bool downloadIfMissing = false", RecitationSource);
    }

    [Fact]
    public void DownloadOptIn_OnlyTheDeliberatePlayTapsSetIt()
    {
        // chapter + selected-verses bar taps and the download→play replay in
        // PerekPage.Recitation.cs; the header headphones tap in the code-behind.
        Assert.Equal(3, CountOccurrences(RecitationSource, "downloadIfMissing: true"));
        Assert.Equal(1, CountOccurrences(CodeBehindSource, "downloadIfMissing: true"));
    }

    [Theory]
    [InlineData("Task PlayPasukRecitationAsync")]
    public void PasukPreviews_NeverOptIntoAPackDownload(string signature)
    {
        var body = MethodBody(RecitationSource, signature);
        Assert.DoesNotContain("downloadIfMissing", body);
    }

    [Fact]
    public void FocusedPasukOpen_PlaysThroughTheLocalOnlyPath()
    {
        // The implicit preview on a double-tap goes through
        // PlayPasukRecitationAsync, which the theory above keeps flag-free.
        var body = MethodBody(RecitationSource, "Task OpenFocusedPasukAsync");
        Assert.Contains("PlayPasukRecitationAsync", body);
        Assert.DoesNotContain("downloadIfMissing", body);
    }

    private static int CountOccurrences(string haystack, string needle)
    {
        var count = 0;
        for (var index = haystack.IndexOf(needle, StringComparison.Ordinal);
             index >= 0;
             index = haystack.IndexOf(needle, index + needle.Length, StringComparison.Ordinal))
        {
            count++;
        }
        return count;
    }

    /// <summary>The method body from its signature line to the next member.</summary>
    private static string MethodBody(string source, string methodName)
    {
        var start = source.IndexOf(methodName, StringComparison.Ordinal);
        Assert.True(start >= 0, $"{methodName} must exist in {nameof(RecitationSource)}");
        var end = source.IndexOf("\n    private ", start + methodName.Length, StringComparison.Ordinal);
        return end < 0 ? source[start..] : source[start..end];
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
