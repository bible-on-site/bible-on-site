using BibleOnSite.Data;
using FluentAssertions;

namespace BibleOnSite.Tests.Data;

public class SefarimDataTests
{
    [Theory]
    [InlineData(1, SeferGroup.Torah)]
    [InlineData(5, SeferGroup.Torah)]
    [InlineData(6, SeferGroup.Neviim)]
    [InlineData(24, SeferGroup.Neviim)]
    [InlineData(25, SeferGroup.Ketuvim)]
    [InlineData(35, SeferGroup.Ketuvim)]
    public void GetSeferGroup_ShouldReturnCorrectGroup(int seferId, SeferGroup expected)
    {
        // Act
        var result = SefarimData.GetSeferGroup(seferId);

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void SefarimGroups_ShouldContainAllThreeGroups()
    {
        SefarimData.SefarimGroups.Should().HaveCount(3);
        SefarimData.SefarimGroups[1].Header.Should().Be("תורה");
        SefarimData.SefarimGroups[2].Header.Should().Be("נביאים");
        SefarimData.SefarimGroups[3].Header.Should().Be("כתובים");
    }

    [Fact]
    public void GetSeferGroup_WithInvalidSeferId_ShouldDefaultToTorah()
    {
        SefarimData.GetSeferGroup(0).Should().Be(SeferGroup.Torah);
        SefarimData.GetSeferGroup(999).Should().Be(SeferGroup.Torah);
    }

    [Theory]
    [InlineData(0, 1, 5)]   // Torah (index 0 -> group key 1)
    [InlineData(1, 6, 24)]  // Neviim (index 1 -> group key 2)
    [InlineData(2, 25, 35)] // Ketuvim (index 2 -> group key 3)
    public void GetSeferGroupRange_ShouldReturnCorrectRange(int groupIndex, int expectedFrom, int expectedTo)
    {
        var (from, to) = SefarimData.GetSeferGroupRange(groupIndex);
        from.Should().Be(expectedFrom);
        to.Should().Be(expectedTo);
    }

    [Fact]
    public void GetSeferGroupRange_WithInvalidIndex_ShouldDefaultToTorah()
    {
        var (from, to) = SefarimData.GetSeferGroupRange(99);
        from.Should().Be(1);
        to.Should().Be(5);
    }
}
