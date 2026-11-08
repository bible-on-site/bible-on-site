using BibleOnSite.Controls;
using BibleOnSite.Pages;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
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
[Collection(PreferencesServiceCollection.Name)]
public class PreferencesPageTests : IDisposable
{
    public void Dispose() => PreferencesService.ResetForTesting();

    /// <summary>Exposes the protected appearing lifecycle the Shell normally raises.</summary>
    private sealed class AppearablePage : PreferencesPage
    {
        public AppearablePage(PreferencesViewModel viewModel, Func<ExtensionPacksViewModel> packsFactory)
            : base(viewModel, packsFactory)
        {
        }

        public void Appear() => OnAppearing();
    }

    private static (AppearablePage Page, View Overview, PreferencesViewModel Settings, ExtensionPacksViewModel Packs) CreatePage()
    {
        var storage = new InMemoryPreferencesStorage();
        // PreferencesPageBase resolves the persisted Back-chrome policy from the
        // singleton (#2927) — the page ctor throws unless it is initialized.
        PreferencesService.Initialize(storage);
        var settings = new PreferencesViewModel(
            PreferencesService.CreateForTesting(storage));
        var packs = new ExtensionPacksViewModel();
        var page = new AppearablePage(settings, () => packs);
        var overview = new ContentView();
        page.Content = overview; // stands in for the XAML-built overview
        return (page, overview, settings, packs);
    }

    [Fact]
    public void ParameterlessCtor_UsesTheSettingsOverview()
    {
        PreferencesService.Initialize(new InMemoryPreferencesStorage());

        var page = new PreferencesPage();

        page.BindingContext.Should().BeOfType<PreferencesViewModel>();
    }

    [Fact]
    public void OnAppearing_InOverview_RefreshesTheSettingsViewModel()
    {
        var (page, overview, settings, _) = CreatePage();

        page.Appear();

        page.Content.Should().BeSameAs(overview);
        page.BindingContext.Should().BeSameAs(settings);
    }

    [Fact]
    public void OnAppearing_InPacks_RefreshesThePacksViewModel()
    {
        var (page, _, _, packs) = CreatePage();
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["section"] = "packs" });

        page.Appear();

        page.Content.Should().BeOfType<ExtensionPacksView>();
        page.BindingContext.Should().BeSameAs(packs);
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
        var (page, _, _, packs) = CreatePage();

        page.ApplyQueryAttributes(new Dictionary<string, object> { ["section"] = "packs" });
        page.ApplyQueryAttributes(new Dictionary<string, object>());
        page.ApplyQueryAttributes(new Dictionary<string, object> { ["section"] = "packs" });

        page.Content.Should().BeOfType<ExtensionPacksView>();
        page.BindingContext.Should().BeSameAs(packs,
            "the same packs view-model is reused — install state survives the round trip");
    }
}
