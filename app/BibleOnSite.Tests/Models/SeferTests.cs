using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Models;

public class SeferTests
{
    [Fact]
    public void GetTanahUsName_WithSimpleName_ShouldReturnName()
    {
        // Arrange
        var sefer = new Sefer
        {
            Id = 1,
            Name = "בראשית",
            TanahUsName = "Genesis"
        };

        // Act
        var result = sefer.GetTanahUsName();

        // Assert
        result.Should().Be("Genesis");
    }

    [Fact]
    public void GetTanahUsName_WithAdditionals_ShouldReturnCorrectName()
    {
        // Arrange
        var sefer = new Sefer
        {
            Id = 8,
            Name = "שמואל",
            TanahUsName = new Dictionary<int, string>
            {
                { 1, "1 Samuel" },
                { 2, "2 Samuel" }
            }
        };

        // Act & Assert
        sefer.GetTanahUsName(1).Should().Be("1 Samuel");
        sefer.GetTanahUsName(2).Should().Be("2 Samuel");
    }

    [Fact]
    public void GetTanahUsName_WithAdditionals_NoAdditionalProvided_ShouldReturnEmpty()
    {
        // Arrange
        var sefer = new Sefer
        {
            Id = 8,
            Name = "שמואל",
            TanahUsName = new Dictionary<int, string>
            {
                { 1, "1 Samuel" },
                { 2, "2 Samuel" }
            }
        };

        // Act
        var result = sefer.GetTanahUsName();

        // Assert
        result.Should().BeEmpty();
    }
}
