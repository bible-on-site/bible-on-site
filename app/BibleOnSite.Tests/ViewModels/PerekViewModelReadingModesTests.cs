using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

public class PerekViewModelReadingModesTests
{
    private static PerekViewModel CreateViewModel()
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        return new PerekViewModel(preferences, _ => new Perek
        {
            PerekId = 1,
            PerekNumber = 1,
            Date = "2026-01-20",
            HebDate = "תשרי",
            SeferName = "בראשית",
            SeferTanahUsName = "Genesis",
            Tseit = "18:00",
            Header = "פרק",
            Pasukim = []
        });
    }

    [Fact]
    public void reading_modes_default_to_off()
    {
        var viewModel = CreateViewModel();

        viewModel.IsShnayimMikraEnabled.Should().BeFalse();
        viewModel.IsTikkunKorimEnabled.Should().BeFalse();
        viewModel.TikkunMarksHidden.Should().BeFalse();
    }

    [Fact]
    public void modes_toggle_independently_of_each_other()
    {
        var viewModel = CreateViewModel();

        viewModel.IsShnayimMikraEnabled = true;
        viewModel.IsTikkunKorimEnabled.Should().BeFalse();

        viewModel.IsTikkunKorimEnabled = true;
        viewModel.IsShnayimMikraEnabled.Should().BeTrue();
    }

    [Fact]
    public void disabling_tikkun_korim_restores_the_marked_display_setting()
    {
        var viewModel = CreateViewModel();
        viewModel.IsTikkunKorimEnabled = true;
        viewModel.TikkunMarksHidden = true;

        viewModel.IsTikkunKorimEnabled = false;

        viewModel.TikkunMarksHidden.Should().BeFalse();
    }

    [Fact]
    public void marks_hidden_flag_is_unchanged_while_tikkun_korim_stays_enabled()
    {
        var viewModel = CreateViewModel();
        viewModel.IsTikkunKorimEnabled = true;

        viewModel.TikkunMarksHidden = true;
        viewModel.IsTikkunKorimEnabled = true;

        viewModel.TikkunMarksHidden.Should().BeTrue();
    }

    [Fact]
    public void reading_modes_do_not_depend_on_recitation_state()
    {
        var viewModel = CreateViewModel();

        viewModel.IsShnayimMikraEnabled = true;
        viewModel.IsTikkunKorimEnabled = true;
        viewModel.TikkunMarksHidden = true;

        viewModel.SelectedPasukNums.Should().BeEmpty();
        viewModel.IsShnayimMikraEnabled.Should().BeTrue();
        viewModel.IsTikkunKorimEnabled.Should().BeTrue();
        viewModel.TikkunMarksHidden.Should().BeTrue();
    }
}
