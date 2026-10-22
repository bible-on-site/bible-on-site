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
    public void Apply_TogglesANamedBackButtonOnNonAndroid()
    {
        // The test host is not Android, so the in-app chrome always shows.
        var backButton = new Button { IsVisible = false };
        var page = new ContentPage();
        page.Content = backButton;
        var scope = new Microsoft.Maui.Controls.Internals.NameScope();
        Microsoft.Maui.Controls.Internals.NameScope.SetNameScope(page, scope);
        ((Microsoft.Maui.Controls.Internals.INameScope)scope).RegisterName("BackButton", backButton);

        BackChrome.Apply(page);

        backButton.IsVisible.Should().BeTrue();
    }
}
