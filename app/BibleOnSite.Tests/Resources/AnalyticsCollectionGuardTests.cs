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
    public void AndroidManifest_DeactivatesCollectionForDisableAnalyticsBuilds()
    {
        // The permanent deactivation flag is the build-flag layer of #2120:
        // Debug/e2e builds resolve the injected placeholder to true, which the
        // SDK cannot re-enable at runtime — nothing emits, persists or flushes.
        var manifest = XDocument.Load(Path.Join(AppRoot, "Platforms", "Android", "AndroidManifest.xml"));
        XNamespace android = "http://schemas.android.com/apk/res/android";
        var entry = manifest.Descendants("meta-data")
            .SingleOrDefault(e => e.Attribute(android + "name")?.Value == "firebase_analytics_collection_deactivated");
        Assert.NotNull(entry);
        Assert.Equal("${firebaseAnalyticsCollectionDeactivated}", entry!.Attribute(android + "value")?.Value);

        // The placeholder only works if the project actually injects it for
        // DisableAnalytics builds; pin the wiring so a csproj edit cannot
        // silently drop the protection.
        var csproj = File.ReadAllText(Path.Join(AppRoot, "BibleOnSite.csproj"));
        Assert.Contains("firebaseAnalyticsCollectionDeactivated=$(FirebaseAnalyticsCollectionDeactivated)", csproj);
        Assert.Contains("$(AndroidManifestPlaceholders);firebaseAnalyticsCollectionDeactivated", csproj);
        Assert.Contains("'$(DisableAnalytics)' == '' AND '$(Configuration)' == 'Debug'", csproj);
        Assert.Contains("DISABLE_ANALYTICS", csproj);
    }

    [Fact]
    public void AndroidManifest_DisablesAutomaticScreenReporting()
    {
        // #2119: automatic screen tracking only ever saw the host activity,
        // so screens are reported manually with logical names instead.
        var manifest = XDocument.Load(Path.Join(AppRoot, "Platforms", "Android", "AndroidManifest.xml"));
        XNamespace android = "http://schemas.android.com/apk/res/android";
        var entry = manifest.Descendants("meta-data")
            .SingleOrDefault(e => e.Attribute(android + "name")?.Value == "google_analytics_automatic_screen_reporting_enabled");
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

    [Fact]
    public void IosInfoPlist_DisablesAutomaticScreenReporting()
    {
        // #2119: automatic tracking swizzles UIViewControllers and reports MAUI
        // renderer classes. The SDK renamed the flag, so both spellings stay
        // pinned — manual screen_view events still log with either disabled.
        var plist = XDocument.Load(Path.Join(AppRoot, "Platforms", "iOS", "Info.plist"));
        var elements = plist.Root!.Element("dict")!.Elements().ToList();
        foreach (var key in new[] { "FirebaseAutomaticScreenReportingEnabled", "FirebaseScreenReportingEnabled" })
        {
            var index = elements.FindIndex(e => e.Name == "key" && e.Value == key);
            Assert.True(index >= 0, $"{key} missing from Info.plist");
            Assert.Equal("false", elements[index + 1].Name.LocalName);
        }
    }

    [Fact]
    public void AndroidStartup_BindsAnalyticsBeforeFirstUse()
    {
        // #2247: Plugin.Firebase.Analytics needs an explicit Initialize on
        // Android. Only Release builds compile the analytics startup path
        // (Debug/e2e define DISABLE_ANALYTICS), so a missing call crashes
        // every store build at launch while every test build stays green.
        var activity = File.ReadAllText(Path.Join(AppRoot, "Platforms", "Android", "MainActivity.cs"));
        var initialize = activity.IndexOf("FirebaseAnalyticsImplementation.Initialize(", StringComparison.Ordinal);
        var firstUse = activity.IndexOf("CrossFirebaseAnalytics.Current", StringComparison.Ordinal);
        Assert.True(initialize >= 0, "MainActivity must call FirebaseAnalyticsImplementation.Initialize");
        Assert.True(initialize < firstUse, "Analytics must be initialized before CrossFirebaseAnalytics.Current is used");
    }

    [Fact]
    public void MobileE2eCompile_PropagatesDisableAnalytics()
    {
        // #2120 asks for an explicit, reliably propagated test-build
        // configuration: the e2e compile target must pass the flag itself and
        // not rely on the Debug-configuration default alone.
        var buildScript = File.ReadAllText(
            Path.Join(AppRoot, "..", "devops", "Build.Compile.cs"));
        Assert.Contains("[\"DisableAnalytics\"] = \"true\"", buildScript);
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
