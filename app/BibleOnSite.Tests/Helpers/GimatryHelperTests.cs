using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class GimatryHelperTests
{
    [Theory]
    [InlineData(1, "א")]
    [InlineData(2, "ב")]
    [InlineData(10, "י")]
    [InlineData(11, "יא")]
    [InlineData(15, "טו")]  // Special case: יה -> טו
    [InlineData(16, "טז")]  // Special case: יו -> טז
    [InlineData(20, "כ")]
    [InlineData(21, "כא")]
    [InlineData(100, "ק")]
    [InlineData(150, "קנ")]
    [InlineData(400, "ת")]
    [InlineData(500, "תק")]
    [InlineData(800, "תת")]
    [InlineData(929, "תתקכט")]
    public void ToLetters_ShouldConvertNumbersCorrectly(int number, string expected)
    {
        // Act
        var result = GimatryHelper.ToLetters(number);

        // Assert
        result.Should().Be(expected);
    }

    [Theory]
    [InlineData("א", 1)]
    [InlineData("ב", 2)]
    [InlineData("י", 10)]
    [InlineData("יא", 11)]
    [InlineData("כ", 20)]
    [InlineData("ק", 100)]
    [InlineData("תתקכט", 929)]
    public void ToNumber_ShouldConvertLettersCorrectly(string phrase, int expected)
    {
        // Act
        var result = GimatryHelper.ToNumber(phrase);

        // Assert
        result.Should().Be(expected);
    }

    [Theory]
    [InlineData('א', true)]
    [InlineData('ת', true)]
    [InlineData('מ', true)]
    [InlineData('a', false)]
    [InlineData('1', false)]
    [InlineData(' ', false)]
    public void IsHebrewLetter_ShouldIdentifyHebrewLettersCorrectly(char c, bool expected)
    {
        // Act
        var result = GimatryHelper.IsHebrewLetter(c);

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void ToLetters_WithZeroOrNegative_ShouldReturnEmpty()
    {
        GimatryHelper.ToLetters(0).Should().BeEmpty();
        GimatryHelper.ToLetters(-1).Should().BeEmpty();
    }

    [Theory]
    [InlineData("ך", 500)]  // Final kaf
    [InlineData("ם", 600)]  // Final mem
    [InlineData("ן", 700)]  // Final nun
    [InlineData("ף", 800)]  // Final pe
    [InlineData("ץ", 900)]  // Final tsadi
    public void ToNumberWithMantzpach_ShouldUseFinalLetterValues(string phrase, int expected)
    {
        // Act
        var result = GimatryHelper.ToNumberWithMantzpach(phrase);

        // Assert
        result.Should().Be(expected);
    }

    [Theory]
    [InlineData(1, "א")]
    [InlineData(150, "קנ")]
    public void IntExtension_ToHebrewLetters_ShouldWork(int number, string expected)
    {
        // Act
        var result = number.ToHebrewLetters();

        // Assert
        result.Should().Be(expected);
    }
}
