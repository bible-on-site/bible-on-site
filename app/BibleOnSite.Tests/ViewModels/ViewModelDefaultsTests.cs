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
            var recitation = new RecitationPreferencesViewModel();
            recitation.Speed.Should().Be(1);
            recitation.Volume.Should().Be(1);
            recitation.OriginalPauses.Should().BeTrue();
            var recitationPacks = new RecitationPacksViewModel();
            recitationPacks.IsDownloading.Should().BeFalse();
            recitationPacks.Books.Should().BeEmpty();
            var packs = new ExtensionPacksViewModel();
            var display = new DisplayPreferencesViewModel();
            display.FontFactor.Should().Be(1);
            var perekPrefs = new PerekPreferencesViewModel();
            perekPrefs.IsPerekToLoadTodays.Should().BeTrue();
            var sound = new SoundPreferencesViewModel();
            sound.RecitationVolume.Should().Be(1);
            sound.LessonsVolume.Should().Be(1);
            sound.EffectsVolume.Should().Be(1);
            var support = new SupportPreferencesViewModel();
            support.ExportLogsCommand.Should().NotBeNull();
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
            vm.PerekHeb.Should().BeEmpty();
            vm.CanGoToNextPerek.Should().BeFalse();
            vm.ShowDownloadPerushimButton.Should().BeFalse();
            vm.SaveLastLearntPerek();
            packs.IsPerushimDownloading = true;
            packs.ShowPerushimDownloadButton.Should().BeFalse();
            packs.PerushimDownloadProgress = 0.42;
            packs.PerushimDownloadStatusText.Should().Be("מוריד… 42%");
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

            var masora = new MasoraViewModel();
            masora.UnitId.Should().Be(0);
            masora.Heading.Should().BeEmpty();
            masora.SeferId.Should().Be(0);
            masora.SeferName.Should().BeEmpty();
            masora.UnitOrder.Should().Be(0);
            masora.ClosingBreakLabel.Should().BeEmpty();
            masora.HasClosingBreak.Should().BeFalse();
            masora.UnitPositionText.Should().BeEmpty();
            masora.NextUnitId.Should().Be(0);
            masora.PreviousUnitId.Should().Be(0);
            masora.CanGoToNextUnit.Should().BeFalse();
            masora.CanGoToPreviousUnit.Should().BeFalse();
            masora.ArticlesCount.Should().Be(0);
            masora.HasArticles.Should().BeFalse();
            masora.PerushimCount.Should().Be(0);
            masora.HasPerushim.Should().BeFalse();
            masora.PerushimEmptyMessage.Should().Be("אין קטלוג פירושים");
            masora.Perushim = [new() { Id = 1, Name = "רש\"י" }, new() { Id = 2, Name = "ביאור שטיינזלץ" }];
            masora.PerushNameFilter = "שטיינזלץ";
            masora.FilteredPerushim.Should().ContainSingle().Which.Id.Should().Be(2);
            masora.PerushNameFilter = "רש״י";
            masora.FilteredPerushim.Should().ContainSingle().Which.Id.Should().Be(1);
            masora.PerushNameFilter = "missing";
            masora.FilteredPerushim.Should().BeEmpty();
            masora.PerushNameFilter = string.Empty;
            masora.FilteredPerushim.Should().HaveCount(2);
            masora.ShowDownloadPerushimButton.Should().BeFalse();
            masora.InlineCommentaryLimit.Should().Be(5);
            masora.IsPerushChecked(1).Should().BeFalse();
            masora.GetPerushimForRow(1, 1).Should().BeEmpty();
            masora.GetUnitIdForPerek(1).Should().BeNull();
            // Toggling without a loaded unit updates the checked set only.
            masora.ToggleCheckedPerush(1);
            masora.IsPerushChecked(1).Should().BeTrue();
            var changes = new List<string?>();
            vm.PropertyChanged += (_, e) => changes.Add(e.PropertyName);
            settings.FontFactor = 1.7;
            vm.FontFactor.Should().Be(1.7);
            changes.Should().Contain(nameof(vm.FontFactor));
            new MauiPreferencesStorage().Should().NotBeNull();
        }
        finally { PreferencesService.ResetForTesting(); }
    }

    [Fact]
    public void TanahpediaViewModels_HaveUsableDefaults()
    {
        var landing = new TanahpediaViewModel();
        landing.IsLoading.Should().BeFalse();
        landing.IsLoaded.Should().BeFalse();
        landing.HasToday.Should().BeFalse();
        landing.HasRecent.Should().BeFalse();
        landing.CategoryGroups.Should().BeEmpty();
        landing.TodayEntities.Should().BeEmpty();
        landing.RecentEntries.Should().BeEmpty();
        landing.LoadCommand.Should().NotBeNull();
        landing.OpenEntryCommand.Should().NotBeNull();

        var entityType = new TanahpediaEntityTypeViewModel();
        entityType.EntityType.Should().BeEmpty();
        entityType.CategoryKey.Should().BeEmpty();
        entityType.HasError.Should().BeFalse();
        entityType.HasIntro.Should().BeFalse();
        entityType.Entities.Should().BeEmpty();

        var entry = new TanahpediaEntryViewModel();
        entry.UniqueName.Should().BeEmpty();
        entry.ShowEntry.Should().BeFalse();
        entry.IsDisambiguation.Should().BeFalse();
        entry.IsNotFound.Should().BeFalse();
        entry.HasOccurrences.Should().BeFalse();
        entry.Occurrences.Should().BeEmpty();
        entry.Entities.Should().BeEmpty();
        entry.SynonymTargets.Should().BeEmpty();
    }
}
