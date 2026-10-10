using System.Xml.Linq;

namespace BibleOnSite.Tests.Resources;

/// <summary>
/// The app must ship Firebase Analytics collection disabled in both platform
/// manifests so that no automatic or custom event can emit before managed code
/// runs. Startup code then enables collection only for launches outside the
/// e2e suite, which is what keeps suite traffic out of the production
/// property — dropping either default would silently reopen that leak.
/// </summary>
public class AnalyticsCollectionGuardTests
{
    private static readonly string AppRoot = FindAppRoot();

    [Fact]
    public void AndroidManifest_DisablesAnalyticsCollectionByDefault()
    {
        var manifest = XDocument.Load(Path.Join(AppRoot, "Platforms", "Android", "AndroidManifest.xml"));
        XNamespace android = "http://schemas.android.com/apk/res/android";
        var entry = manifest.Descendants("meta-data")
            .SingleOrDefault(e => e.Attribute(android + "name")?.Value == "firebase_analytics_collection_enabled");
        Assert.NotNull(entry);
        Assert.Equal("false", entry!.Attribute(android + "value")?.Value);
    }

    [Fact]
    public void IosInfoPlist_DisablesAnalyticsCollectionByDefault()
    {
        var plist = XDocument.Load(Path.Join(AppRoot, "Platforms", "iOS", "Info.plist"));
        var elements = plist.Root!.Element("dict")!.Elements().ToList();
        var index = elements.FindIndex(e =>
            e.Name == "key" && e.Value == "FIREBASE_ANALYTICS_COLLECTION_ENABLED");
        Assert.True(index >= 0, "FIREBASE_ANALYTICS_COLLECTION_ENABLED key missing from Info.plist");
        Assert.Equal("false", elements[index + 1].Name.LocalName);
    }

    private static string FindAppRoot()
    {
        var dir = AppContext.BaseDirectory;
        while (dir != null)
        {
            var candidate = Path.Combine(dir, "BibleOnSite");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(candidate, "BibleOnSite.csproj")))
            {
                return candidate;
            }

            var siblingCandidate = Path.Combine(Path.GetDirectoryName(dir)!, "BibleOnSite");
            if (Directory.Exists(siblingCandidate) && File.Exists(Path.Combine(siblingCandidate, "BibleOnSite.csproj")))
            {
                return siblingCandidate;
            }

            dir = Path.GetDirectoryName(dir);
        }

        throw new InvalidOperationException(
            "Could not locate BibleOnSite project root from " + AppContext.BaseDirectory);
    }
}
