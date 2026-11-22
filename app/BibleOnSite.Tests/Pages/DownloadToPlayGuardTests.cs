namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #3704: only a deliberate Play tap may start a sefer's pack download —
/// the header/selection bars and the focused view's own headphones button.
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
        // chapter + selected-verses bar + focused-pasuk headphones taps and the
        // download→play replay in PerekPage.Recitation.cs; the header
        // headphones tap in the code-behind.
        Assert.Equal(4, CountOccurrences(RecitationSource, "downloadIfMissing: true"));
        Assert.Equal(1, CountOccurrences(CodeBehindSource, "downloadIfMissing: true"));
    }

    [Fact]
    public void PasukPreviewHelper_DefaultsToLocalOnly_AndForwardsTheFlag()
    {
        // The shared pasuk helper carries the opt-in only so its callers can
        // choose; it must default off so implicit previews never fetch a pack,
        // and it must forward the flag — a dropped forward leaves the focused
        // headphones tap dead again (Devin review on #3723).
        Assert.Contains(
            "Task PlayPasukRecitationAsync(Pasuk pasuk, bool downloadIfMissing = false)",
            RecitationSource);
        var body = MethodBody(RecitationSource, "Task PlayPasukRecitationAsync");
        Assert.Contains("downloadIfMissing: downloadIfMissing", body);
    }

    [Theory]
    [InlineData("Task OpenFocusedPasukAsync")]   // implicit preview on double-tap
    [InlineData("Task HandlePasukTapAsync")]     // single-tap pasuk preview
    public void ImplicitPasukPreviews_NeverOptIntoAPackDownload(string signature)
    {
        var body = MethodBody(RecitationSource, signature);
        Assert.DoesNotContain("downloadIfMissing: true", body);
    }

    [Fact]
    public void FocusedHeadphonesTap_OptsIntoThePackDownload()
    {
        // The focused view's headphones button is enabled for aligned pesukim
        // regardless of installation; its deliberate tap must download→play
        // rather than sit dead (Devin review on #3723).
        var body = MethodBody(RecitationSource, "OnFocusedPlayClicked(object?");
        Assert.Contains("PlayPasukRecitationAsync(pasuk, downloadIfMissing: true)", body);
    }

    [Fact]
    public void FocusedPasukOpen_PlaysThroughTheLocalOnlyPath()
    {
        // The implicit preview on a double-tap goes through
        // PlayPasukRecitationAsync without the opt-in.
        var body = MethodBody(RecitationSource, "Task OpenFocusedPasukAsync");
        Assert.Contains("PlayPasukRecitationAsync", body);
        Assert.DoesNotContain("downloadIfMissing", body);
    }

    [Fact]
    public void PendingRequest_CarriesItsPlayKeyAsOwner()
    {
        // Ownership travels on the play key so dismissing the focused view
        // cancels only its own request — never a bar-owned one (#3704).
        var body = MethodBody(RecitationSource, "Task DownloadRecitationThenPlayAsync");
        Assert.Contains("owner", body);
        var caller = MethodBody(RecitationSource, "Task PlayRecitationAsync");
        Assert.Contains("), key)", caller);
    }

    [Fact]
    public void FocusedDismiss_CancelsOnlyItsOwnPendingRequest()
    {
        // ClearAllSelections preserves playing audio but must still drop a
        // pasuk-owned download→play so it cannot fire after the view closed.
        var body = MethodBody(CodeBehindSource, "void ClearAllSelections");
        Assert.Contains("_recitationDownload.CancelOwner", body);
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
