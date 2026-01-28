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
