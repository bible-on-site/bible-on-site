using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

public class PerekViewModelTests
{
    [Fact]
    public void LoadByPerekId_ShouldSetPerekAndUpdateLastLearnt()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = CreatePerek(1, 1, 1, "בראשית", "Genesis", "תשרי");

        var viewModel = new PerekViewModel(preferences, id => id == 1 ? perek : null);

        viewModel.LoadByPerekId(1);

        viewModel.Perek.Should().NotBeNull();
        viewModel.PerekId.Should().Be(1);
        preferences.LastLearntPerek.Should().Be(1);
    }

    [Fact]
    public void ComputedProperties_ShouldReflectPerekValues()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = CreatePerek(5, 3, 2, "שמות", "Exodus", "חשוון");

        var viewModel = new PerekViewModel(preferences, _ => perek);
        viewModel.LoadByPerekId(5);

        viewModel.SeferName.Should().Be("שמות");
        viewModel.PerekNumber.Should().Be(3);
        viewModel.PerekHeb.Should().Be("ג");
        viewModel.AdditionalHeb.Should().Be("ב");
        viewModel.HebDate.Should().Be("חשוון");
        viewModel.Header.Should().NotBeNull();
    }

    [Fact]
    public void ToggleBookmark_ShouldUpdateIsBookmarked()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = CreatePerek(10, 1, null, "ויקרא", "Leviticus", "טבת");

        var viewModel = new PerekViewModel(preferences, _ => perek);
        viewModel.LoadByPerekId(10);

        viewModel.IsBookmarked.Should().BeFalse();
        viewModel.ToggleBookmark();
        viewModel.IsBookmarked.Should().BeTrue();
        viewModel.ToggleBookmark();
        viewModel.IsBookmarked.Should().BeFalse();
    }

    [Fact]
    public void Source_ShouldShowLeanFormat()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = CreatePerek(123, 5, null, "בראשית", "Genesis", "תשרי");

        var viewModel = new PerekViewModel(preferences, _ => perek);
        viewModel.LoadByPerekId(123);

        // Source should be lean: "SeferName PerekHeb" (no dash, perekId, or date)
        viewModel.Source.Should().Be("בראשית ה");
    }

    [Fact]
    public void Source_WithAdditional_ShouldShowLeanFormat()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = CreatePerek(456, 3, 2, "שמואל", "Samuel", "חשוון");

        var viewModel = new PerekViewModel(preferences, _ => perek);
        viewModel.LoadByPerekId(456);

        // Source should be lean: "SeferName Additional PerekHeb" (no dash, perekId, or date)
        viewModel.Source.Should().Be("שמואל ב ג");
    }

    #region Navigation Properties Tests

    [Fact]
    public void NextPerekId_ShouldReturnNextId()
    {
        var viewModel = CreateViewModelAtPerek(5);

        viewModel.NextPerekId.Should().Be(6);
    }

    [Fact]
    public void NextPerekId_AtPerek929_ShouldClampTo929()
    {
        var viewModel = CreateViewModelAtPerek(929);

        viewModel.NextPerekId.Should().Be(929);
    }

    [Fact]
    public void PreviousPerekId_ShouldReturnPreviousId()
    {
        var viewModel = CreateViewModelAtPerek(5);

        viewModel.PreviousPerekId.Should().Be(4);
    }

    [Fact]
    public void PreviousPerekId_AtPerek1_ShouldClampTo1()
    {
        var viewModel = CreateViewModelAtPerek(1);

        viewModel.PreviousPerekId.Should().Be(1);
    }

    [Fact]
    public void CanGoToNextPerek_ShouldBeTrueWhenNotAtEnd()
    {
        var viewModel = CreateViewModelAtPerek(100);

        viewModel.CanGoToNextPerek.Should().BeTrue();
    }

    [Fact]
    public void CanGoToNextPerek_ShouldBeFalseAtPerek929()
    {
        var viewModel = CreateViewModelAtPerek(929);

        viewModel.CanGoToNextPerek.Should().BeFalse();
    }

    [Fact]
    public void CanGoToPreviousPerek_ShouldBeTrueWhenNotAtStart()
    {
        var viewModel = CreateViewModelAtPerek(100);

        viewModel.CanGoToPreviousPerek.Should().BeTrue();
    }

    [Fact]
    public void CanGoToPreviousPerek_ShouldBeFalseAtPerek1()
    {
        var viewModel = CreateViewModelAtPerek(1);

        viewModel.CanGoToPreviousPerek.Should().BeFalse();
    }

    [Fact]
    public void NextPerekId_WithNoPerek_ShouldReturnZero()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var viewModel = new PerekViewModel(preferences, _ => null);

        viewModel.NextPerekId.Should().Be(0);
    }

    [Fact]
    public void PreviousPerekId_WithNoPerek_ShouldReturnZero()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var viewModel = new PerekViewModel(preferences, _ => null);

        viewModel.PreviousPerekId.Should().Be(0);
    }

    #endregion

    #region Selection Cleared on Perek Change Tests

    [Fact]
    public void LoadByPerekId_ShouldClearSelectionsFromPreviousPerek()
    {
        var perek1 = CreatePerekWithPasukim(1, 1, null, "בראשית", "Genesis", "תשרי");
        var perek2 = CreatePerekWithPasukim(2, 2, null, "בראשית", "Genesis", "תשרי");

        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var viewModel = new PerekViewModel(preferences, id => id == 1 ? perek1 : perek2);

        viewModel.LoadByPerekId(1);
        viewModel.ToggleSelectedPasuk(1);
        viewModel.ToggleSelectedPasuk(2);
        viewModel.SelectedPasukNums.Should().HaveCount(2);

        viewModel.LoadByPerekId(2);

        viewModel.SelectedPasukNums.Should().BeEmpty();
    }

    [Fact]
    public void LoadByPerekId_ShouldClearPreviousPerekPasukSelections()
    {
        var perek1 = CreatePerekWithPasukim(1, 1, null, "בראשית", "Genesis", "תשרי");
        var perek2 = CreatePerekWithPasukim(2, 2, null, "בראשית", "Genesis", "תשרי");

        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var viewModel = new PerekViewModel(preferences, id => id == 1 ? perek1 : perek2);

        viewModel.LoadByPerekId(1);
        viewModel.ToggleSelectedPasuk(1);
        viewModel.ToggleSelectedPasuk(3);
        perek1.Pasukim[0].IsSelected.Should().BeTrue();
        perek1.Pasukim[2].IsSelected.Should().BeTrue();

        viewModel.LoadByPerekId(2);

        // Old perek's pasukim should have IsSelected cleared
        perek1.Pasukim.Should().AllSatisfy(p => p.IsSelected.Should().BeFalse());
    }

    [Fact]
    public void LoadByPerekId_NewPerekShouldHaveNoPasukimSelected()
    {
        var perek1 = CreatePerekWithPasukim(1, 1, null, "בראשית", "Genesis", "תשרי");
        var perek2 = CreatePerekWithPasukim(2, 2, null, "בראשית", "Genesis", "תשרי");

        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var viewModel = new PerekViewModel(preferences, id => id == 1 ? perek1 : perek2);

        viewModel.LoadByPerekId(1);
        viewModel.ToggleSelectedPasuk(1);
        perek1.Pasukim[0].IsSelected.Should().BeTrue();

        viewModel.LoadByPerekId(2);

        // New perek's pasukim should all be unselected
        perek2.Pasukim.Should().AllSatisfy(p => p.IsSelected.Should().BeFalse());
    }

    #endregion

    #region Pasuk Selection Tests

    [Fact]
    public void ToggleSelectedPasuk_ShouldSelectPasuk()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.ToggleSelectedPasuk(1);

        viewModel.IsPasukSelected(1).Should().BeTrue();
        viewModel.SelectedPasukNums.Should().Contain(1);
        viewModel.Perek!.Pasukim![0].IsSelected.Should().BeTrue();
    }

    [Fact]
    public void ToggleSelectedPasuk_ShouldDeselectWhenCalledTwice()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.ToggleSelectedPasuk(1);
        viewModel.ToggleSelectedPasuk(1);

        viewModel.IsPasukSelected(1).Should().BeFalse();
        viewModel.SelectedPasukNums.Should().NotContain(1);
        viewModel.Perek!.Pasukim![0].IsSelected.Should().BeFalse();
    }

    [Fact]
    public void ToggleSelectedPasuk_ShouldAllowMultipleSelections()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.ToggleSelectedPasuk(1);
        viewModel.ToggleSelectedPasuk(3);

        viewModel.IsPasukSelected(1).Should().BeTrue();
        viewModel.IsPasukSelected(2).Should().BeFalse();
        viewModel.IsPasukSelected(3).Should().BeTrue();
        viewModel.SelectedPasukNums.Should().HaveCount(2);
    }

    [Fact]
    public void ClearSelected_ShouldClearAllSelections()
    {
        var viewModel = CreateViewModelWithPasukim();
        viewModel.ToggleSelectedPasuk(1);
        viewModel.ToggleSelectedPasuk(2);
        viewModel.ToggleSelectedPasuk(3);

        viewModel.ClearSelected();

        viewModel.SelectedPasukNums.Should().BeEmpty();
        viewModel.IsPasukSelected(1).Should().BeFalse();
        viewModel.IsPasukSelected(2).Should().BeFalse();
        viewModel.IsPasukSelected(3).Should().BeFalse();
        viewModel.Perek!.Pasukim!.All(p => !p.IsSelected).Should().BeTrue();
    }

    [Fact]
    public void IsPasukSelected_ShouldReturnFalseForUnselectedPasuk()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.IsPasukSelected(1).Should().BeFalse();
        viewModel.IsPasukSelected(999).Should().BeFalse();
    }

    [Fact]
    public void SelectedPasukNums_ShouldBeEmptyInitially()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.SelectedPasukNums.Should().BeEmpty();
    }

    [Fact]
    public void ToggleSelectedPasuk_ShouldUpdateIsSelectedOnPasukModel()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.ToggleSelectedPasuk(2);

        viewModel.Perek!.Pasukim![0].IsSelected.Should().BeFalse();
        viewModel.Perek!.Pasukim![1].IsSelected.Should().BeTrue();
        viewModel.Perek!.Pasukim![2].IsSelected.Should().BeFalse();
    }

    [Fact]
    public void ClearSelected_ShouldResetIsSelectedOnAllPasukim()
    {
        var viewModel = CreateViewModelWithPasukim();
        viewModel.ToggleSelectedPasuk(1);
        viewModel.ToggleSelectedPasuk(2);

        viewModel.ClearSelected();

        viewModel.Perek!.Pasukim!.Should().AllSatisfy(p => p.IsSelected.Should().BeFalse());
    }

    [Fact]
    public void ToggleSelectedPasuk_WithNonExistentPasuk_ShouldStillAddToList()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.ToggleSelectedPasuk(999);

        viewModel.SelectedPasukNums.Should().Contain(999);
        viewModel.IsPasukSelected(999).Should().BeTrue();
    }

    [Fact]
    public void SelectionOrder_ShouldBePreserved()
    {
        var viewModel = CreateViewModelWithPasukim();

        viewModel.ToggleSelectedPasuk(3);
        viewModel.ToggleSelectedPasuk(1);
        viewModel.ToggleSelectedPasuk(2);

        viewModel.SelectedPasukNums.Should().ContainInOrder(3, 1, 2);
    }

    private PerekViewModel CreateViewModelWithPasukim()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = CreatePerekWithPasukim(1, 1, null, "בראשית", "Genesis", "תשרי");

        var viewModel = new PerekViewModel(preferences, _ => perek);
        viewModel.LoadByPerekId(1);
        return viewModel;
    }

    private static Perek CreatePerekWithPasukim(int perekId, int perekNumber, int? additional, string seferName, string seferTanahUsName, string hebDate)
    {
        return new Perek
        {
            PerekId = perekId,
            PerekNumber = perekNumber,
            Additional = additional,
            Date = "2026-01-20",
            HebDate = hebDate,
            HasRecording = false,
            Header = "Header",
            SeferId = 1,
            SeferName = seferName,
            SeferTanahUsName = seferTanahUsName,
            Tseit = "18:00",
            Pasukim = new List<Pasuk>
            {
                new() { PasukNum = 1, Text = "בראשית ברא אלהים" },
                new() { PasukNum = 2, Text = "והארץ היתה תהו ובהו" },
                new() { PasukNum = 3, Text = "ויאמר אלהים יהי אור" }
            }
        };
    }

    #endregion

    private PerekViewModel CreateViewModelAtPerek(int perekId)
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        var perek = CreatePerek(perekId, 1, null, "בראשית", "Genesis", "תשרי");
        var viewModel = new PerekViewModel(preferences, _ => perek);
        viewModel.LoadByPerekId(perekId);
        return viewModel;
    }

    private static Perek CreatePerek(int perekId, int perekNumber, int? additional, string seferName, string seferTanahUsName, string hebDate)
    {
        return new Perek
        {
            PerekId = perekId,
            PerekNumber = perekNumber,
            Additional = additional,
            Date = "2026-01-20",
            HebDate = hebDate,
            HasRecording = false,
            Header = "Header",
            SeferId = 1,
            SeferName = seferName,
            SeferTanahUsName = seferTanahUsName,
            Tseit = "18:00"
        };
    }
}
