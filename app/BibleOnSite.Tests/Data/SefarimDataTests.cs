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
}
