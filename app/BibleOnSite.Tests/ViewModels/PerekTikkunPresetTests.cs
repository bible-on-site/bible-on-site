using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

[Collection("Process environment")]
public class PerekTikkunPresetTests
{
    [Theory]
    [InlineData(null, false)]
    [InlineData("0", false)]
    [InlineData("1", true)]
    public void Constructor_EnablesBothTikkunModesOnlyForTheExplicitPreset(string? preset, bool expected)
    {
        var previous = Environment.GetEnvironmentVariable("BIBLE_E2E_TIKKUN");
        try
        {
            Environment.SetEnvironmentVariable("BIBLE_E2E_TIKKUN", preset);
            var preferences = PreferencesService.CreateForTesting(new InMemoryPreferencesStorage());
            var model = new PerekViewModel(preferences, _ => null);

            model.IsTikkunKorimEnabled.Should().Be(expected);
            model.IsShnayimMikraEnabled.Should().Be(expected);
        }
        finally
        {
            Environment.SetEnvironmentVariable("BIBLE_E2E_TIKKUN", previous);
        }
    }
}
