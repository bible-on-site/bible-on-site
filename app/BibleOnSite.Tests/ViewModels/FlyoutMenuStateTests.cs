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
    public void PreferencesViewModel_MasoraMenuEnabled_SameValueSet_IsANoOp()
    {
        var viewModel = new PreferencesViewModel(_service);
        var notified = false;
        viewModel.PropertyChanged += (_, e) =>
            notified |= e.PropertyName == nameof(PreferencesViewModel.MasoraMenuEnabled);

        viewModel.MasoraMenuEnabled = false; // already false by default

        notified.Should().BeFalse("setting the stored value neither writes nor notifies");
        _service.MasoraMenuEnabled.Should().BeFalse();
    }

    [Fact]
    public void PreferencesViewModel_MasoraMenuEnabled_MirrorsService()
    {
        var viewModel = new PreferencesViewModel(_service);
        viewModel.MasoraMenuEnabled.Should().BeFalse();

        var notified = false;
        viewModel.PropertyChanged += (_, e) => notified |= e.PropertyName == nameof(PreferencesViewModel.MasoraMenuEnabled);
        viewModel.MasoraMenuEnabled = true;

        _service.MasoraMenuEnabled.Should().BeTrue();
        viewModel.MasoraMenuEnabled.Should().BeTrue();
        notified.Should().BeTrue();

        // Changes made outside the view model flow back through PreferencesChanged.
        _service.MasoraMenuEnabled = false;
        viewModel.MasoraMenuEnabled.Should().BeFalse();
    }
}
