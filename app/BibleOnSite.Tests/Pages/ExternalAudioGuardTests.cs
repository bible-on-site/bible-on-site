namespace BibleOnSite.Tests.Pages;

/// <summary>
/// #2642: external music must keep playing until the app actually produces
/// audio. These guards pin the architecture that keeps it safe, because a
/// future "harmless" control or eager MediaElement reintroduces the bug
/// silently — on iOS the toolkit activates the audio session the moment a
/// MediaElement handler exists and releases it only on dispose.
/// </summary>
public class ExternalAudioGuardTests
{
    private static readonly string AppRoot = FindAppRoot();

    [Fact]
    public void ArticlePage_NeverConstructsAMediaElementEagerly()
    {
        // Constructing a MediaElement while building article content is what
        // cut Spotify off just for opening an article — media surfaces must
        // come from the deferred host, which only builds the native player on
        // an explicit play request.
        var source = ReadPage("ArticleDetailPage.xaml.cs");
        Assert.DoesNotContain("new MediaElement", source);
        Assert.Contains("DeferredMediaElement", source);
    }

    [Fact]
    public void DeferredMediaElement_BuildsThePlayerOnlyOnAPlayRequest()
    {
        var source = ReadControl("DeferredMediaElement.cs");
        Assert.DoesNotContain("ShouldAutoPlay = false", source);
        Assert.Contains("ShouldAutoPlay = true", source);
        // The placeholder is what asks for playback; nothing else may create
        // the native player.
        Assert.Equal(1, Occurrences(source, "new MediaElement"));
        Assert.Contains("PlaybackAudioOwnership", source);
    }

    [Theory]
    [InlineData("PerekPage.Recitation.cs")]
    [InlineData("ParashaPage.Recitation.cs")]
    public void RecitationPages_KeepPlayerConstructionLazy(string fileName)
    {
        var source = ReadPage(fileName);
        // Exactly one MediaElement may exist — inside the lazy host factory —
        // so recitation surfaces never activate the session before a valid
        // playback request (#2283, #2642).
        Assert.Equal(1, Occurrences(source, "new MediaElement"));
        Assert.Contains("GetOrCreatePlayer", source);
        // And every playback surface marks its audio claim so ownership is
        // released once playback pauses, stops, ends or is left behind.
        Assert.Contains("PlaybackAudioOwnership", source);
        Assert.Contains("ResumeRecitationPlayback", source);
    }

    [Fact]
    public void AudioOwnership_ReleasesByNotifyingOtherSessions()
    {
        // Releasing quietly would leave Spotify paused after recitation ends, so
        // the Apple bridge must deactivate with NotifyOthersOnDeactivation so
        // interrupted players may resume — the behavior the toolkit's own
        // dispose path lacks.
        var source = ReadService("PlaybackAudioOwnership.cs");
        Assert.Contains("NotifyOthersOnDeactivation", source);
        Assert.Contains("SetActive", source);
    }

    private static int Occurrences(string haystack, string needle)
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

    private static string ReadPage(string fileName) =>
        File.ReadAllText(Path.Join(AppRoot, "Pages", fileName));

    private static string ReadControl(string fileName) =>
        File.ReadAllText(Path.Join(AppRoot, "Controls", fileName));

    private static string ReadService(string fileName) =>
        File.ReadAllText(Path.Join(AppRoot, "Services", fileName));

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
