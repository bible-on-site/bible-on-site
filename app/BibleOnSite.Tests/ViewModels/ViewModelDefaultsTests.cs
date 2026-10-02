using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

[Collection(PreferencesServiceCollection.Name)]
public class ViewModelDefaultsTests
{
    [Fact]
    public void StartupViewModels_UseInitializedPreferences_AndHandleUnloadedChapter()
    {
        PreferencesService.ResetForTesting();
        try
        {
            PreferencesService.Initialize(new InMemoryPreferencesStorage());
            var vm = new PerekViewModel();
            var settings = new PreferencesViewModel();
            vm.Source.Should().BeEmpty();
            vm.SeferTanahUsName.Should().BeEmpty();
            vm.Additional.Should().BeNull();
            vm.AdditionalHeb.Should().BeEmpty();
            vm.Header.Should().BeEmpty();
            vm.HebDate.Should().BeEmpty();
            vm.IsBookmarked.Should().BeFalse();
            vm.NextPerekId.Should().Be(0);
            vm.PreviousPerekId.Should().Be(0);
            vm.PerekNumber.Should().Be(0);
            vm.SeferId.Should().Be(0);
            vm.SeferName.Should().BeEmpty();
            vm.ToggleBookmark();
            vm.ToggleSelectedPasuk(1);
            vm.IsPasukSelected(1).Should().BeTrue();
            vm.ToggleSelectedPasuk(1);
            vm.IsPasukSelected(1).Should().BeFalse();
            vm.LoadByPerekId(1);
            vm.Perek.Should().BeNull();
            vm.ToggleCheckedPerush(1);
            vm.IsPerushChecked(1).Should().BeTrue();
            var changes = new List<string?>();
            vm.PropertyChanged += (_, e) => changes.Add(e.PropertyName);
            settings.FontFactor = 1.7;
            vm.FontFactor.Should().Be(1.7);
            changes.Should().Contain(nameof(vm.FontFactor));
            new MauiPreferencesStorage().Should().NotBeNull();
        }
        finally { PreferencesService.ResetForTesting(); }
    }
}
