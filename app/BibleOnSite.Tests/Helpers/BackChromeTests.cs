using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using FluentAssertions;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Helpers;

/// <summary><see cref="BackChrome.Apply"/> headless coverage (#2467): the
/// policy math is pinned by <see cref="BackChromePolicyTests"/>; these tests
/// exercise the page-side application itself.</summary>
[Collection(PreferencesServiceCollection.Name)]
public class BackChromeTests : IDisposable
{
    public BackChromeTests()
    {
        PreferencesService.Initialize(new InMemoryPreferencesStorage());
    }

    public void Dispose()
    {
        BackChrome.TestPlatform = null;
        PreferencesService.ResetForTesting();
    }

    [Fact]
    public void Apply_OnAPageWithNoChromeTargets_DoesNotThrow()
    {
        var page = new ContentPage();

        var act = () => BackChrome.Apply(page);

        act.Should().NotThrow();
    }

    [Fact]
    public void Apply_SetsBackButtonBehavior_OnANavBarPage()
    {
        var page = new ContentPage();

        BackChrome.Apply(page);

        var behavior = Shell.GetBackButtonBehavior(page);
        behavior.Should().NotBeNull();
        behavior!.IsVisible.Should().BeFalse(
            "an unattached page has no navigation stack, so Up never shows");
    }

    [Fact]
    public void Apply_SetsCapsuleBackOnSharedTopBarPages()
    {
        // The test host is not Android/Windows, so the capsule affordance shows.
        var bar = new BibleOnSite.Controls.SharedTopBar { ShowBack = false };
        var page = new ContentPage { Content = bar };

        BackChrome.Apply(page);

        bar.ShowBack.Should().BeTrue("non-Android platforms keep the capsule Back slot");
        bar.BackButton.IsVisible.Should().BeTrue();
        bar.BackEnabled.Should().BeFalse("an unattached page has no return target");
    }

    [Fact]
    public void Apply_RefreshesTransientStateReportedByThePage()
    {
        var bar = new BibleOnSite.Controls.SharedTopBar { ShowBack = true };
        var page = new ContentPage { Content = bar };
        bar.BackStateProvider = () => true;

        BackChrome.Apply(page);

        bar.BackEnabled.Should().BeTrue(
            "a page-owned transient surface keeps Back enabled even at a root");
    }
    /// <summary>
    /// The #2927 invariant through the shared preferences template: the
    /// template's capsule Back binds to <c>PreferencesPageBase.ShowBack</c>,
    /// which must already hold the persisted policy when the page is built —
    /// the navigation-time apply correcting a stale default is what reflowed
    /// headers in 5.0.210.
    /// </summary>
    [Theory]
    [InlineData(BackChromePlatform.Android, InAppBackButtonPreference.PlatformDefault, false)]
    [InlineData(BackChromePlatform.Android, InAppBackButtonPreference.Hide, false)]
    [InlineData(BackChromePlatform.Android, InAppBackButtonPreference.Show, true)]
    [InlineData(BackChromePlatform.Apple, InAppBackButtonPreference.PlatformDefault, true)]
    [InlineData(BackChromePlatform.Windows, InAppBackButtonPreference.Show, false)]
    public void PreferencesPageBase_ShowBack_ResolvedAtConstruction_BeforeAnyNavigationApply(
        BackChromePlatform platform, InAppBackButtonPreference preference, bool expected)
    {
        BackChrome.TestPlatform = platform;
        PreferencesService.Instance.InAppBackButton = preference;

        var page = new BibleOnSite.Controls.PreferencesPageBase();
        var atConstruction = page.ShowBack;

        // The navigation-time apply runs after the first frame can paint.
        BackChrome.Apply(page);

        atConstruction.Should().Be(expected,
            "the persisted policy must own the template Back state before the first frame");
        page.ShowBack.Should().Be(atConstruction,
            "the navigation-time apply must never flip the template binding — that flip is the reflow");
    }
}
