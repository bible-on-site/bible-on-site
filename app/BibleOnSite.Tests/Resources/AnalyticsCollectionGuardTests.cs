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

    [Theory]
    [InlineData("google_analytics_adid_collection_enabled")]
    [InlineData("google_analytics_default_allow_ad_personalization_signals")]
    public void AndroidManifest_DisablesAdvertisingFeatures(string key)
    {
        var manifest = XDocument.Load(Path.Join(AppRoot, "Platforms", "Android", "AndroidManifest.xml"));
        XNamespace android = "http://schemas.android.com/apk/res/android";
        var entry = Assert.Single(manifest.Descendants("meta-data")
            .Where(e => e.Attribute(android + "name")?.Value == key));
        Assert.Equal("false", entry.Attribute(android + "value")?.Value);
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

    [Theory]
    [InlineData("GOOGLE_ANALYTICS_IDFA_COLLECTION_ENABLED")]
    [InlineData("GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS")]
    public void IosInfoPlist_DisablesAdvertisingFeatures(string key)
    {
        var plist = XDocument.Load(Path.Join(AppRoot, "Platforms", "iOS", "Info.plist"));
        var elements = plist.Root!.Element("dict")!.Elements().ToList();
        var index = elements.FindIndex(e => e.Name == "key" && e.Value == key);
        Assert.True(index >= 0, $"{key} missing from Info.plist");
        Assert.Equal("false", elements[index + 1].Name.LocalName);
    }

    [Fact]
    public void Reader_UsesAnInlineDisclosureWithPrivacyAndOptOutInsteadOfALaunchModal()
    {
        var loadingPage = File.ReadAllText(Path.Join(AppRoot, "Pages", "LoadingPage.xaml.cs"));
        Assert.DoesNotContain("DisplayAlert", loadingPage);

        var reader = XDocument.Load(Path.Join(AppRoot, "Pages", "PerekPage.xaml"));
        var notice = Assert.Single(reader.Descendants()
            .Where(e => e.Attribute("AutomationId")?.Value == "AnalyticsNotice"));
        Assert.Equal("False", notice.Attribute("IsVisible")?.Value);
        Assert.Equal("VerticalStackLayout", notice.Name.LocalName);
        var buttons = notice.Descendants().Where(e => e.Name.LocalName == "Button").ToList();
        Assert.Equal(3, buttons.Count);
        Assert.Contains(buttons, b => b.Attribute("Clicked")?.Value == "OnAnalyticsPrivacyClicked");
        Assert.Contains(buttons, b => b.Attribute("Clicked")?.Value == "OnAnalyticsOptOutClicked");
        Assert.Contains(buttons, b => b.Attribute("Clicked")?.Value == "OnAnalyticsDismissClicked");
        Assert.Contains(notice.Descendants(), e => e.Attribute("Text")?.Value ==
            "נתוני שימוש נמסרים לשירותי מדידה כדי לשפר את הלימוד. המשך השימוש מאפשר מדידה.");

        var policy = XDocument.Load(Path.Join(AppRoot, "Pages", "TosPage.xaml"));
        var policyLink = Assert.Single(policy.Descendants()
            .Where(e => e.Attribute("AutomationId")?.Value == "PrivacyPolicyLink"));
        Assert.Contains(policyLink.Descendants(), e => e.Attribute("Tapped")?.Value == "OnPrivacyPolicyTapped");
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
        // Only the Release (#else) branch counts, and comment lines are dropped,
        // so a call in the DISABLE_ANALYTICS branch or a comment cannot pass.
        var guardStart = activity.IndexOf("#if DISABLE_ANALYTICS", StringComparison.Ordinal);
        Assert.True(guardStart >= 0, "MainActivity must keep the DISABLE_ANALYTICS startup guard");
        var releaseStart = activity.IndexOf("#else", guardStart, StringComparison.Ordinal);
        var releaseEnd = activity.IndexOf("#endif", releaseStart, StringComparison.Ordinal);
        var releaseCode = string.Join('\n', activity[releaseStart..releaseEnd].Split('\n')
            .Where(line => !line.TrimStart().StartsWith("//", StringComparison.Ordinal)));
        var initialize = releaseCode.IndexOf("FirebaseAnalyticsImplementation.Initialize(", StringComparison.Ordinal);
        var firstUse = releaseCode.IndexOf("CrossFirebaseAnalytics.Current", StringComparison.Ordinal);
        Assert.True(initialize >= 0, "MainActivity must call FirebaseAnalyticsImplementation.Initialize");
        Assert.True(initialize < firstUse, "Analytics must be initialized before CrossFirebaseAnalytics.Current is used");
    }

    [Fact]
    public void Startup_GatesCollectionOnStoredConsentAndE2eMarker()
    {
        // #2400: both launch paths must resolve collection through the consent
        // gate (a stored choice plus the e2e marker) so neither platform can
        // re-enable tracking unconditionally and no Release build can emit
        // before the entry disclosure and continued use. The gate keeps consulting the
        // e2e marker so suite launches stay silent even on a granted device.
        var consent = File.ReadAllText(Path.Join(AppRoot, "Services", "AnalyticsConsent.cs"));
        Assert.Contains("IsE2eMarkedProcess()", consent);
        var activity = File.ReadAllText(Path.Join(AppRoot, "Platforms", "Android", "MainActivity.cs"));
        Assert.Contains("AnalyticsConsent.IsCollectionEnabled(", activity);
        var mauiProgram = File.ReadAllText(Path.Join(AppRoot, "MauiProgram.cs"));
        Assert.Contains("AnalyticsConsent.IsCollectionEnabled(", mauiProgram);
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
