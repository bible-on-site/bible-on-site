using BibleOnSite.Data;
using FluentAssertions;

namespace BibleOnSite.Tests.Data;

public class PerakimDataTests
{
    [Theory]
    [InlineData(1, null, 50)]   // בראשית
    [InlineData(2, null, 40)]   // שמות
    [InlineData(25, null, 150)] // תהלים
    public void GetPerakimCount_SimpleBooks_ShouldReturnCorrectCount(int seferId, int? additional, int expected)
    {
        // Act
        var result = PerakimData.GetPerakimCount(seferId, additional);

        // Assert
        result.Should().Be(expected);
    }

    [Theory]
    [InlineData(8, 1, 31)]  // שמואל א
    [InlineData(8, 2, 24)]  // שמואל ב
    [InlineData(9, 1, 22)]  // מלכים א
    [InlineData(9, 2, 25)]  // מלכים ב
    [InlineData(34, 70, 10)] // עזרא
    [InlineData(34, 50, 13)] // נחמיה
    [InlineData(35, 1, 29)]  // דברי הימים א
    [InlineData(35, 2, 36)]  // דברי הימים ב
    public void GetPerakimCount_BooksWithAdditionals_ShouldReturnCorrectCount(int seferId, int additional, int expected)
    {
        // Act
        var result = PerakimData.GetPerakimCount(seferId, additional);

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void GetPerakimCount_InvalidSeferId_ShouldReturnZero()
    {
        PerakimData.GetPerakimCount(999).Should().Be(0);
    }

    [Fact]
    public void GetPerakimCount_BookWithAdditionals_NoAdditionalProvided_ShouldReturnZero()
    {
        // שמואל without specifying א or ב
        PerakimData.GetPerakimCount(8).Should().Be(0);
    }

    [Fact]
    public void TotalPerakim_ShouldBe929()
    {
        PerakimData.TotalPerakim.Should().Be(929);
    }
}
