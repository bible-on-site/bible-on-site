using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Coverage for the מסורה על הפרק menu gate (#2181): the opt-in preference's
/// default/unset/upgrade behavior, persisted values, and the reactive
/// <see cref="FlyoutMenuState.ShowMasoraEntry"/> the flyout binds to.
/// </summary>
[Collection(PreferencesServiceCollection.Name)]
public class FlyoutMenuStateTests : IDisposable
{
    private readonly InMemoryPreferencesStorage _storage;
    private readonly PreferencesService _service;

    public FlyoutMenuStateTests()
    {
        _storage = new InMemoryPreferencesStorage();
        _service = PreferencesService.CreateForTesting(_storage);
    }

    public void Dispose()
    {
        PreferencesService.ResetForTesting();
    }

    [Fact]
    public void MasoraMenuEnabled_DefaultsOff_WhenNothingStored()
    {
        _service.MasoraMenuEnabled.Should().BeFalse("the flag is opt-in");
        _service.Load();
        _service.MasoraMenuEnabled.Should().BeFalse("fresh install resolves unset to false");
    }

    [Fact]
    public void MasoraMenuEnabled_DefaultsOff_WhenUpgradingFromOlderVersion()
    {
        // Storage holding only pre-flag keys — an existing user's upgrade must
        // not opt them into the מסורה entry.
        _storage.Set("fontFactor", 1.5);
        _storage.Set("perekToLoad", (int)PerekToLoad.LastLearnt);
        _storage.Set("lastLearntPerek", 42);

        _service.Load();

        _service.MasoraMenuEnabled.Should().BeFalse();
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void MasoraMenuEnabled_RestoresPersistedValue_AcrossReload(bool stored)
    {
        _storage.Set("masoraMenuEnabled", stored);

        _service.Load();

        _service.MasoraMenuEnabled.Should().Be(stored);
        var restored = PreferencesService.CreateForTesting(_storage);
        restored.Load();
        restored.MasoraMenuEnabled.Should().Be(stored, "the choice survives restarts");
    }

    [Fact]
    public void MasoraMenuEnabled_WhenSet_PersistsAndNotifies()
    {
        var changes = 0;
        _service.PreferencesChanged += (_, _) => changes++;

        _service.MasoraMenuEnabled = true;

        _service.MasoraMenuEnabled.Should().BeTrue();
        _storage.Get("masoraMenuEnabled", false).Should().BeTrue();
        changes.Should().Be(1);

        _service.MasoraMenuEnabled = true;
        changes.Should().Be(1, "setting the same value neither writes nor notifies");
    }

    [Fact]
    public void Load_RaisesPreferencesChanged_SoEarlySubscribersRefresh()
    {
        // The flyout inflates before startup Load runs; without a change
        // notification its binding would keep the pre-load default.
        var notified = false;
        _service.PreferencesChanged += (_, _) => notified = true;

        _service.Load();

        notified.Should().BeTrue();
    }

    [Fact]
    public void ShowMasoraEntry_TracksPreference_Reactively()
    {
        var state = new FlyoutMenuState(_service);
        state.ShowMasoraEntry.Should().BeFalse();

        var changes = new List<string?>();
        state.PropertyChanged += (_, e) => changes.Add(e.PropertyName);

        _service.MasoraMenuEnabled = true;

        state.ShowMasoraEntry.Should().BeTrue();
        changes.Should().Contain(nameof(FlyoutMenuState.ShowMasoraEntry));

        _service.MasoraMenuEnabled = false;

        state.ShowMasoraEntry.Should().BeFalse();
        changes.Should().HaveCount(2);
    }

    [Fact]
    public void ShowMasoraEntry_PicksUpStoredValue_OnLoad()
    {
        // Simulates the Shell order: state created (and read) before Load.
        _storage.Set("masoraMenuEnabled", true);
        var state = new FlyoutMenuState(_service);
        state.ShowMasoraEntry.Should().BeFalse("Load has not run yet");

        var notified = false;
        state.PropertyChanged += (_, e) => notified |= e.PropertyName == nameof(FlyoutMenuState.ShowMasoraEntry);
        _service.Load();

        state.ShowMasoraEntry.Should().BeTrue();
        notified.Should().BeTrue();
    }

    [Fact]
    public void Instance_TracksTheSharedPreferencesSingleton()
    {
        // The Shell flyout binds to Instance via x:Static, so it must reflect
        // the shared PreferencesService singleton rather than a detached copy.
        // Only this test touches Instance; the collection serializes singleton
        // access, so the Lazy materialization is deterministic.
        PreferencesService.Initialize(_storage);
        PreferencesService.Instance.MasoraMenuEnabled = true;

        var state = FlyoutMenuState.Instance;

        state.Should().NotBeNull();
        state.ShowMasoraEntry.Should().BeTrue();
        FlyoutMenuState.Instance.Should().BeSameAs(state);
    }

    [Fact]
    public void PerekPreferencesViewModel_MasoraMenuEnabled_SameValueSet_IsANoOp()
    {
        var viewModel = new PerekPreferencesViewModel(_service);
        var notified = false;
        viewModel.PropertyChanged += (_, e) =>
            notified |= e.PropertyName == nameof(PerekPreferencesViewModel.MasoraMenuEnabled);

        viewModel.MasoraMenuEnabled = false; // already false by default

        notified.Should().BeFalse("setting the stored value neither writes nor notifies");
        _service.MasoraMenuEnabled.Should().BeFalse();
    }

    [Fact]
    public void PerekPreferencesViewModel_MasoraMenuEnabled_MirrorsService()
    {
        var viewModel = new PerekPreferencesViewModel(_service);
        viewModel.MasoraMenuEnabled.Should().BeFalse();

        var notified = false;
        viewModel.PropertyChanged += (_, e) => notified |= e.PropertyName == nameof(PerekPreferencesViewModel.MasoraMenuEnabled);
        viewModel.MasoraMenuEnabled = true;

        _service.MasoraMenuEnabled.Should().BeTrue();
        viewModel.MasoraMenuEnabled.Should().BeTrue();
        notified.Should().BeTrue();

        // Changes made outside the view model flow back through PreferencesChanged.
        _service.MasoraMenuEnabled = false;
        viewModel.MasoraMenuEnabled.Should().BeFalse();
    }

    [Fact]
    public void CurrentDestination_UpdatesTheMatchingIsCurrentFlag()
    {
        var state = new FlyoutMenuState(_service);

        state.CurrentDestination.Should().Be(FlyoutDestination.None);
        state.IsAlHaperekCurrent.Should().BeFalse();

        state.CurrentDestination = FlyoutDestination.AlHaperek;

        state.IsAlHaperekCurrent.Should().BeTrue();
        state.IsParashaCurrent.Should().BeFalse("exactly one row claims the page");

        state.CurrentDestination = FlyoutDestination.Parasha;

        state.IsAlHaperekCurrent.Should().BeFalse();
        state.IsParashaCurrent.Should().BeTrue();
    }

    [Fact]
    public void CurrentDestination_NotifiesEveryIsCurrentFlag()
    {
        // Rows bind to their own Is*Current flag — a destination change must
        // refresh all of them, not only the two whose truth value flipped.
        var state = new FlyoutMenuState(_service);
        var changes = new List<string?>();
        state.PropertyChanged += (_, e) => changes.Add(e.PropertyName);

        state.CurrentDestination = FlyoutDestination.Preferences;

        changes.Should().Contain(nameof(FlyoutMenuState.CurrentDestination));
        changes.Should().Contain(nameof(FlyoutMenuState.IsPreferencesCurrent));
        changes.Should().Contain(nameof(FlyoutMenuState.IsAlHaperekCurrent),
            "the previously-selected row must repaint as unselected");
        changes.Should().Contain(nameof(FlyoutMenuState.IsDonationsCurrent));
    }

    [Fact]
    public void CurrentDestination_ExactlyOneRowFlagIsSet()
    {
        // Every row reads its own Is*Current flag — all twelve getters must
        // agree with the destination on every value, not just the ones other
        // tests happened to read.
        var state = new FlyoutMenuState(_service);

        foreach (var destination in Enum.GetValues<FlyoutDestination>())
        {
            state.CurrentDestination = destination;

            var flags = new[]
            {
                state.IsAlHaperekCurrent,
                state.IsTanahpediaCurrent,
                state.IsLearningCalendarCurrent,
                state.IsMasoraCurrent,
                state.IsParashaCurrent,
                state.IsMoadimCurrent,
                state.IsAuthorsCurrent,
                state.IsDailyBulletinCurrent,
                state.IsTermsCurrent,
                state.IsPreferencesCurrent,
                state.IsContactCurrent,
                state.IsDonationsCurrent,
            };

            flags.Count(f => f).Should().Be(destination == FlyoutDestination.None ? 0 : 1,
                $"exactly one row may claim {destination}");
        }
    }

    [Fact]
    public void AppRoutes_ArticleRoutes_StayRegisteredButUnselected()
    {
        // Registered in AppShell for navigation but deliberately absent from
        // RouteDestinations — articles clear the highlight instead of
        // claiming a flyout row. Pins both the route names and that mapping.
        AppRoutes.Articles.Should().Be("ArticlesPage");
        AppRoutes.ArticleDetail.Should().Be("articleDetail");
        FlyoutMenuState.DestinationFor(AppRoutes.Articles).Should().Be(FlyoutDestination.None);
        FlyoutMenuState.DestinationFor(AppRoutes.ArticleDetail).Should().Be(FlyoutDestination.None);
    }

    // Literal route names — the test pins the values registered in AppShell,
    // so a route rename breaks here instead of silently unselecting a row.
    [Theory]
    [InlineData("PerekPage", FlyoutDestination.AlHaperek)]
    [InlineData("searchReader", FlyoutDestination.AlHaperek)]
    [InlineData("calendarReader", FlyoutDestination.AlHaperek)]
    [InlineData("TanahpediaPage", FlyoutDestination.Tanahpedia)]
    [InlineData("tanahpediaCategory", FlyoutDestination.Tanahpedia)]
    [InlineData("tanahpediaEntry", FlyoutDestination.Tanahpedia)]
    [InlineData("LearningCalendarPage", FlyoutDestination.LearningCalendar)]
    [InlineData("MasoraPage", FlyoutDestination.Masora)]
    [InlineData("ParashaListPage", FlyoutDestination.Parasha)]
    [InlineData("ParashaPage", FlyoutDestination.Parasha)]
    [InlineData("MoadimListPage", FlyoutDestination.Moadim)]
    [InlineData("MoedPage", FlyoutDestination.Moadim)]
    [InlineData("AuthorsPage", FlyoutDestination.Authors)]
    [InlineData("DailyBulletinPage", FlyoutDestination.DailyBulletin)]
    [InlineData("TosPage", FlyoutDestination.Terms)]
    [InlineData("PreferencesPage", FlyoutDestination.Preferences)]
    [InlineData("DisplayPreferencesPage", FlyoutDestination.Preferences)]
    [InlineData("RecitationPreferencesPage", FlyoutDestination.Preferences)]
    [InlineData("PerekPreferencesPage", FlyoutDestination.Preferences)]
    [InlineData("ExtensionPacksPage", FlyoutDestination.Preferences)]
    [InlineData("SoundPreferencesPage", FlyoutDestination.Preferences)]
    [InlineData("SupportPreferencesPage", FlyoutDestination.Preferences)]
    [InlineData("ContactPage", FlyoutDestination.Contact)]
    [InlineData("DonationsPage", FlyoutDestination.Donations)]
    public void DestinationFor_MapsRegisteredRoutesToTheirFlyoutRow(string route, FlyoutDestination expected)
    {
        FlyoutMenuState.DestinationFor(route).Should().Be(expected);
    }

    [Theory]
    [InlineData("ArticlesPage")]
    [InlineData("articleDetail")]
    [InlineData("unregisteredRoute")]
    [InlineData("")]
    public void DestinationFor_RoutesWithoutARow_ClearTheSelection(string route)
    {
        FlyoutMenuState.DestinationFor(route).Should().Be(FlyoutDestination.None);
    }

    [Fact]
    public void DestinationFor_Null_ClearsTheSelection()
    {
        FlyoutMenuState.DestinationFor(null).Should().Be(FlyoutDestination.None);
    }

    [Theory]
    [InlineData("//PerekPage", FlyoutDestination.AlHaperek)]
    [InlineData("//PerekPage/TanahpediaPage", FlyoutDestination.Tanahpedia)]
    [InlineData("//PerekPage/TanahpediaPage/tanahpediaEntry?id=7", FlyoutDestination.Tanahpedia)]
    [InlineData("//PerekPage/ParashaListPage/ParashaPage", FlyoutDestination.Parasha)]
    [InlineData("//PerekPage/searchReader?query=1", FlyoutDestination.AlHaperek)]
    public void DestinationForLocation_UsesTheDeepestRouteSegment(string location, FlyoutDestination expected)
    {
        // Pushed detail routes keep their destination highlighted via the
        // deepest segment; query strings never leak into the route key.
        FlyoutMenuState.DestinationForLocation(location).Should().Be(expected);
    }

    [Fact]
    public void DestinationForLocation_Null_ClearsTheSelection()
    {
        FlyoutMenuState.DestinationForLocation(null).Should().Be(FlyoutDestination.None);
    }
}
