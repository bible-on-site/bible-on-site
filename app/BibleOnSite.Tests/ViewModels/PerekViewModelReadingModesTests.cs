using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;
using FluentAssertions;

namespace BibleOnSite.Tests.ViewModels;

public class PerekViewModelReadingModesTests
{
    private static Perek MakePerek(int perekId) => new()
    {
        PerekId = perekId,
        PerekNumber = perekId,
        Date = "2026-01-20",
        HebDate = "תשרי",
        SeferName = "בראשית",
        SeferTanahUsName = "Genesis",
        Tseit = "18:00",
        Header = "פרק",
        Pasukim = []
    };

    private static PerekViewModel CreateViewModel(Func<int, bool>? hasPerekAudio = null)
    {
        var storage = new InMemoryPreferencesStorage();
        var preferences = PreferencesService.CreateForTesting(storage);
        return new PerekViewModel(preferences, _ => MakePerek(1), hasPerekAudio);
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

    public class Qriynot
    {
        [Fact]
        public void qriynot_mode_defaults_to_off_with_no_header_button()
        {
            var viewModel = CreateViewModel();

            viewModel.IsQriynotEnabled.Should().BeFalse();
            viewModel.HasCurrentPerekRecitation.Should().BeFalse();
            viewModel.ShowHeaderPlayButton.Should().BeFalse();
        }

        [Fact]
        public void qriynot_checkbox_reflects_downloaded_audio_for_the_current_perek()
        {
            var viewModel = CreateViewModel(perekId => perekId == 1);

            viewModel.Perek = MakePerek(1);

            viewModel.HasCurrentPerekRecitation.Should().BeTrue();
        }

        [Fact]
        public void qriynot_checkbox_hides_when_only_another_perek_has_audio()
        {
            var viewModel = CreateViewModel(perekId => perekId == 2);

            viewModel.Perek = MakePerek(1);

            viewModel.HasCurrentPerekRecitation.Should().BeFalse();
        }

        [Fact]
        public void header_play_button_requires_both_the_checkbox_and_downloaded_audio()
        {
            var viewModel = CreateViewModel(_ => true);
            viewModel.Perek = MakePerek(1);

            viewModel.IsQriynotEnabled = true;
            viewModel.ShowHeaderPlayButton.Should().BeTrue();

            viewModel.IsQriynotEnabled = false;
            viewModel.ShowHeaderPlayButton.Should().BeFalse();
        }

        [Fact]
        public void perek_switch_re_evaluates_audio_availability()
        {
            var viewModel = CreateViewModel(perekId => perekId == 2);
            viewModel.Perek = MakePerek(1);
            viewModel.HasCurrentPerekRecitation.Should().BeFalse();

            viewModel.Perek = MakePerek(2);
            viewModel.HasCurrentPerekRecitation.Should().BeTrue();
        }
    }
}
