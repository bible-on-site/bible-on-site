using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// Tests for perushim checkbox toggle, persistence across navigation, and note filtering.
/// Covers bugs: checked perushim clearing after navigation, notes not appearing for checked perushim.
/// </summary>
public class PerekViewModelPerushimTests
{
    #region ToggleCheckedPerush

    [Fact]
    public void ToggleCheckedPerush_ShouldAddPerushToCheckedList()
    {
        var vm = CreateViewModelWithPerushim();

        vm.ToggleCheckedPerush(1);

        vm.IsPerushChecked(1).Should().BeTrue();
        vm.CheckedPerushim.Should().Contain(1);
    }

    [Fact]
    public void ToggleCheckedPerush_ShouldRemovePerushWhenCalledTwice()
    {
        var vm = CreateViewModelWithPerushim();

        vm.ToggleCheckedPerush(1);
        vm.ToggleCheckedPerush(1);

        vm.IsPerushChecked(1).Should().BeFalse();
        vm.CheckedPerushim.Should().NotContain(1);
    }

    [Fact]
    public void ToggleCheckedPerush_ShouldAllowMultipleChecked()
    {
        var vm = CreateViewModelWithPerushim();

        vm.ToggleCheckedPerush(1);
        vm.ToggleCheckedPerush(2);

        vm.IsPerushChecked(1).Should().BeTrue();
        vm.IsPerushChecked(2).Should().BeTrue();
        vm.CheckedPerushim.Should().HaveCount(2);
    }

    [Fact]
    public void IsPerushChecked_ShouldReturnFalseForUncheckedPerush()
    {
        var vm = CreateViewModelWithPerushim();

        vm.IsPerushChecked(1).Should().BeFalse();
        vm.IsPerushChecked(999).Should().BeFalse();
    }

    #endregion

    #region CheckedPerushim Persistence Across Navigation

    [Fact]
    public void SetPerek_ShouldClearPasukSelectionButNotCheckedPerushim()
    {
        var perek1 = CreatePerekWithPasukim(1);
        var perek2 = CreatePerekWithPasukim(2);

        var vm = CreateViewModel(id => id == 1 ? perek1 : perek2);
        vm.LoadByPerekId(1);

        // Check some perushim and select some pasukim
        vm.ToggleCheckedPerush(1);
        vm.ToggleCheckedPerush(2);
        vm.ToggleSelectedPasuk(1);
        vm.ToggleSelectedPasuk(2);

        vm.CheckedPerushim.Should().HaveCount(2);
        vm.SelectedPasukNums.Should().HaveCount(2);

        // Navigate to a different perek
        vm.LoadByPerekId(2);

        // Pasuk selection should be cleared
        vm.SelectedPasukNums.Should().BeEmpty();
        // But checked perushim should persist!
        vm.CheckedPerushim.Should().HaveCount(2);
        vm.IsPerushChecked(1).Should().BeTrue();
        vm.IsPerushChecked(2).Should().BeTrue();
    }

    [Fact]
    public void SetPerek_ShouldClearIsSelectedOnOldPerekPasukim()
    {
        var perek1 = CreatePerekWithPasukim(1);
        var perek2 = CreatePerekWithPasukim(2);

        var vm = CreateViewModel(id => id == 1 ? perek1 : perek2);
        vm.LoadByPerekId(1);

        vm.ToggleSelectedPasuk(1);
        perek1.Pasukim![0].IsSelected.Should().BeTrue();

        vm.LoadByPerekId(2);

        // Old perek's pasukim should have IsSelected cleared
        perek1.Pasukim.Should().AllSatisfy(p => p.IsSelected.Should().BeFalse());
    }

    #endregion

    #region FillFilteredPerushContents

    [Fact]
    public void ToggleCheckedPerush_ShouldPopulatePerushNotesOnPasukim()
    {
        var vm = CreateViewModelWithPerushimAndNotes();

        // Initially no notes should be shown (nothing checked)
        vm.Perek!.Pasukim![0].PerushNotes.Should().BeEmpty();

        // Check Rashi (id=1)
        vm.ToggleCheckedPerush(1);

        // Pasuk 1 should now have Rashi's note
        vm.Perek.Pasukim[0].PerushNotes.Should().HaveCount(1);
        vm.Perek.Pasukim[0].PerushNotes[0].PerushName.Should().Be("רש\"י");
        vm.Perek.Pasukim[0].PerushNotes[0].NoteContents.Should().ContainSingle()
            .Which.Should().Be("בראשית - בשביל התורה");
    }

    [Fact]
    public void ToggleCheckedPerush_ShouldShowMultiplePerushimOnSamePasuk()
    {
        var vm = CreateViewModelWithPerushimAndNotes();

        // Check both Rashi and Ibn Ezra
        vm.ToggleCheckedPerush(1);
        vm.ToggleCheckedPerush(2);

        // Pasuk 1 should have notes from both, ordered by priority
        vm.Perek!.Pasukim![0].PerushNotes.Should().HaveCount(2);
        // Rashi (priority=100) before Ibn Ezra (priority=200)
        vm.Perek.Pasukim[0].PerushNotes[0].PerushName.Should().Be("רש\"י");
        vm.Perek.Pasukim[0].PerushNotes[1].PerushName.Should().Be("אבן עזרא");
    }

    [Fact]
    public void UncheckedPerush_ShouldNotShowNotes()
    {
        var vm = CreateViewModelWithPerushimAndNotes();

        // Check Rashi, then uncheck
        vm.ToggleCheckedPerush(1);
        vm.Perek!.Pasukim![0].PerushNotes.Should().HaveCount(1);

        vm.ToggleCheckedPerush(1);
        vm.Perek.Pasukim[0].PerushNotes.Should().BeEmpty();
    }

    [Fact]
    public void FillFilteredPerushContents_ShouldOnlyShowNotesForCheckedPerushim()
    {
        var vm = CreateViewModelWithPerushimAndNotes();

        // Only check Ibn Ezra (id=2)
        vm.ToggleCheckedPerush(2);

        // Pasuk 1 should only show Ibn Ezra's note
        vm.Perek!.Pasukim![0].PerushNotes.Should().HaveCount(1);
        vm.Perek.Pasukim[0].PerushNotes[0].PerushName.Should().Be("אבן עזרא");

        // Pasuk 2 should have no notes (Ibn Ezra has none there)
        vm.Perek.Pasukim[1].PerushNotes.Should().BeEmpty();
    }

    [Fact]
    public void FillFilteredPerushContents_ShouldHandleMultipleNotesPerPasuk()
    {
        var vm = CreateViewModelWithPerushimAndNotes();

        // Check Rashi — pasuk 3 has two Rashi notes (note_idx 0 and 1)
        vm.ToggleCheckedPerush(1);

        vm.Perek!.Pasukim![2].PerushNotes.Should().HaveCount(1);
        vm.Perek.Pasukim[2].PerushNotes[0].NoteContents.Should().HaveCount(2);
        vm.Perek.Pasukim[2].PerushNotes[0].NoteContents[0].Should().Be("ויאמר - note 1");
        vm.Perek.Pasukim[2].PerushNotes[0].NoteContents[1].Should().Be("ויאמר - note 2");
    }

    #endregion

    #region Helpers

    private static PerekViewModel CreateViewModel(Func<int, Perek?> loader)
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        return new PerekViewModel(preferences, loader);
    }

    private static PerekViewModel CreateViewModelWithPerushim()
    {
        var perek = CreatePerekWithPasukim(1);
        var vm = CreateViewModel(_ => perek);
        vm.LoadByPerekId(1);

        // Set perushim list (public property)
        vm.Perushim = new List<Perush>
        {
            new() { Id = 1, Name = "רש\"י", Priority = 100 },
            new() { Id = 2, Name = "אבן עזרא", Priority = 200 },
        };

        return vm;
    }

    private static PerekViewModel CreateViewModelWithPerushimAndNotes()
    {
        var perek = CreatePerekWithPasukim(1);
        var vm = CreateViewModel(_ => perek);
        vm.LoadByPerekId(1);

        vm.Perushim = new List<Perush>
        {
            new() { Id = 1, Name = "רש\"י", Priority = 100 },
            new() { Id = 2, Name = "אבן עזרא", Priority = 200 },
        };

        // Inject notes cache via reflection (private field)
        var notes = new List<PerekPerushNote>
        {
            new() { PerushId = 1, PerushName = "רש\"י", PerekId = 1, Pasuk = 1, NoteIdx = 0, NoteContent = "בראשית - בשביל התורה" },
            new() { PerushId = 2, PerushName = "אבן עזרא", PerekId = 1, Pasuk = 1, NoteIdx = 0, NoteContent = "בראשית ברא - הפועל" },
            new() { PerushId = 1, PerushName = "רש\"י", PerekId = 1, Pasuk = 2, NoteIdx = 0, NoteContent = "והארץ היתה תהו" },
            new() { PerushId = 1, PerushName = "רש\"י", PerekId = 1, Pasuk = 3, NoteIdx = 0, NoteContent = "ויאמר - note 1" },
            new() { PerushId = 1, PerushName = "רש\"י", PerekId = 1, Pasuk = 3, NoteIdx = 1, NoteContent = "ויאמר - note 2" },
        };

        var field = typeof(PerekViewModel).GetField("_perushNotesCache",
            System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance);
        field!.SetValue(vm, notes);

        return vm;
    }

    private static Perek CreatePerekWithPasukim(int perekId)
    {
        return new Perek
        {
            PerekId = perekId,
            PerekNumber = 1,
            Date = "2026-01-20",
            HebDate = "תשרי",
            HasRecording = false,
            Header = "Header",
            SeferId = 1,
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "18:00",
            Pasukim = new List<Pasuk>
            {
                new() { PasukNum = 1, Text = "בראשית ברא אלהים" },
                new() { PasukNum = 2, Text = "והארץ היתה תהו ובהו" },
                new() { PasukNum = 3, Text = "ויאמר אלהים יהי אור" },
            }
        };
    }

    #endregion
}
