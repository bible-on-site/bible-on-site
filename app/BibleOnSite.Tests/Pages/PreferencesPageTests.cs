using BibleOnSite.Controls;
using BibleOnSite.Pages;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Pages;

/// <summary>
/// The section=packs contextual entry swaps the settings overview for the pack
/// view; a later Preferences entry (its query carries no section) must restore
/// the overview on the same page instance — a packs query must not trap the
/// page (#2926).
/// </summary>
public class PreferencesPageTests
{
    private static (PreferencesPage Page, View Overview, PreferencesViewModel Settings, ExtensionPacksViewModel Packs) CreatePage()
    {
        var settings = new PreferencesViewModel(
            PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()));
        var packs = new ExtensionPacksViewModel();
        var page = new PreferencesPage(settings, () => packs);
        var overview = new ContentView();
        page.Content = overview; // stands in for the XAML-built overview
        return (page, overview, settings, packs);
    }

    [Fact]
    public void ApplyQueryAttributes_PacksSection_SwapsInPacksView()
    {
        var (page, _, _, packs) = CreatePage();

        page.ApplyQueryAttributes(new Dictionary<string, object> { ["section"] = "packs" });

        page.Content.Should().BeOfType<ExtensionPacksView>();
        page.BindingContext.Should().BeSameAs(packs);
        page.Title.Should().Be("העדפות - חבילות הרחבה");
    }

    [Fact]
    public void ApplyQueryAttributes_NoSectionAfterPacks_RestoresTheOverview()
    {
        var (page, overview, settings, _) = CreatePage();
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["section"] = "packs" });

        page.ApplyQueryAttributes(new Dictionary<string, object>());

        page.Content.Should().BeSameAs(overview, "the settings overview returns on the same instance");
        page.BindingContext.Should().BeSameAs(settings);
        page.Title.Should().Be("העדפות");
    }

    [Fact]
    public void ApplyQueryAttributes_NoSectionOnFreshPage_KeepsTheOverviewUntouched()
    {
        var (page, overview, settings, _) = CreatePage();

        page.ApplyQueryAttributes(new Dictionary<string, object>());

        page.Content.Should().BeSameAs(overview);
        page.BindingContext.Should().BeSameAs(settings);
    }

    [Fact]
    public void ApplyQueryAttributes_PacksThenOverviewThenPacks_RoundTrips()
    {
        var (page, overview, settings, packs) = CreatePage();

        page.ApplyQueryAttributes(new Dictionary<string, object> { ["section"] = "packs" });
        page.ApplyQueryAttributes(new Dictionary<string, object>());
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["section"] = "packs" });

        page.Content.Should().BeOfType<ExtensionPacksView>();
        page.BindingContext.Should().BeSameAs(packs,
            "the same packs view-model is reused — install state survives the round trip");
    }
}
