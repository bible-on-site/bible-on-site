namespace BibleOnSite.Tests.Resources;

/// <summary>
/// Regression guards for the repeated Tanahpedia-navigation crash (#2640):
/// pushed entry pages must not be retained by the singleton preferences
/// service, and the page-level navigation callbacks must keep their failure
/// boundaries and in-flight dedupe, because an async-void navigation
/// exception is a process crash.
/// </summary>
public class TanahpediaNavigationGuardTests
{
    private static readonly string PagesRoot = FindPagesRoot();

    [Fact]
    public void Pages_DoNotSubscribeAnonymouslyToSingletonPreferences()
    {
        // A `PreferencesChanged +=` lambda captures the page in the singleton's
        // delegate list forever: every pushed page, its handlers and its
        // native views then survive navigation and accumulate (#2640). Pages
        // subscribe through WeakPreferencesSubscription instead; named-handler
        // subscriptions with a matching detach remain allowed.
        var offenders = Directory.GetFiles(PagesRoot, "*.cs", SearchOption.AllDirectories)
            .Where(file => File.ReadAllText(file).Contains("PreferencesChanged += ("))
            .Select(Path.GetFileName)
            .ToList();
        Assert.Empty(offenders);
    }

    [Fact]
    public void EntryPage_BackToPedia_KeepsDedupeAndFailureBoundary()
    {
        var source = File.ReadAllText(Path.Join(PagesRoot, "TanahpediaEntryPage.xaml.cs"));
        var handler = SliceFrom(source, "OnBackToPediaClicked");
        Assert.Contains("_backToPediaPending", handler);
        Assert.Contains("catch (Exception", handler);
        Assert.Contains("Tanahpedia back navigation failed", handler);
    }

    [Fact]
    public void SearchPanelEntrySelection_IsNotARawAsyncLambda()
    {
        // `OnEntrySelected` is a fire-and-forget Action; assigning an async
        // lambda makes it async-void and unobserves navigation failures.
        foreach (var file in Directory.GetFiles(PagesRoot, "*.cs", SearchOption.AllDirectories))
        {
            Assert.DoesNotContain("OnEntrySelected = async", File.ReadAllText(file));
        }
    }

    private static string SliceFrom(string source, string marker)
    {
        var start = source.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(start >= 0, $"{marker} missing");
        var next = source.IndexOf("\n    private ", start + marker.Length, StringComparison.Ordinal);
        var end = next >= 0 ? next : source.IndexOf("\n}", start, StringComparison.Ordinal);
        Assert.True(end > start);
        return source[start..end];
    }

    private static string FindPagesRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Join(dir, "BibleOnSite", "Pages");
            if (Directory.Exists(candidate) && File.Exists(Path.Join(dir, "BibleOnSite", "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var sibling = Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite", "Pages");
            if (Directory.Exists(sibling) && File.Exists(Path.Join(Path.GetDirectoryName(dir)!, "BibleOnSite", "BibleOnSite.csproj")))
            {
                return sibling;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new DirectoryNotFoundException("Could not locate the app Pages directory");
    }
}
