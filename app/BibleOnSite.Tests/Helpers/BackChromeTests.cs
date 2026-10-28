using BibleOnSite.Helpers;
using BibleOnSite.Services;
using FluentAssertions;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Helpers;

/// <summary><see cref="BackChrome.Apply"/> headless coverage (#2467): the
/// policy math is pinned by <see cref="BackChromePolicyTests"/>; these tests
/// exercise the page-side application itself.</summary>
public class BackChromeTests : IDisposable
{
    public BackChromeTests()
    {
        PreferencesService.Initialize(new InMemoryPreferencesStorage());
    }

    public void Dispose()
    {
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
    [Fact]
    public void Apply_UpdatesTheSharedPreferencesTemplateBackState()
    {
        var page = new BibleOnSite.Controls.PreferencesPageBase();
        page.ShowBack.Should().BeFalse();

        BackChrome.Apply(page);

        page.ShowBack.Should().BeTrue("non-Android preferences keep their in-app Back control");
    }
}
