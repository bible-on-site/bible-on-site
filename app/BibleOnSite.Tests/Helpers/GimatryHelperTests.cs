using BibleOnSite.Helpers;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

public class GimatryHelperTests
{
    #region ToLetters Tests

    [Theory]
    [InlineData(1, "א")]
    [InlineData(2, "ב")]
    [InlineData(3, "ג")]
    [InlineData(4, "ד")]
    [InlineData(5, "ה")]
    [InlineData(6, "ו")]
    [InlineData(7, "ז")]
    [InlineData(8, "ח")]
    [InlineData(9, "ט")]
    [InlineData(10, "י")]
    [InlineData(11, "יא")]
    [InlineData(12, "יב")]
    [InlineData(15, "טו")]  // Special case: יה -> טו
    [InlineData(16, "טז")]  // Special case: יו -> טז
    [InlineData(17, "יז")]
    [InlineData(20, "כ")]
    [InlineData(21, "כא")]
    [InlineData(30, "ל")]
    [InlineData(40, "מ")]
    [InlineData(50, "נ")]
    [InlineData(60, "ס")]
    [InlineData(70, "ע")]
    [InlineData(80, "פ")]
    [InlineData(90, "צ")]
    [InlineData(99, "צט")]
    [InlineData(100, "ק")]
    [InlineData(150, "קנ")]
    [InlineData(200, "ר")]
    [InlineData(300, "ש")]
    [InlineData(400, "ת")]
    [InlineData(500, "תק")]
    [InlineData(600, "תר")]
    [InlineData(700, "תש")]
    [InlineData(800, "תת")]
    [InlineData(900, "תתק")]
    [InlineData(929, "תתקכט")]
    [InlineData(999, "תתקצט")]
    public void ToLetters_ShouldConvertNumbersCorrectly(int number, string expected)
    {
        // Act
        var result = GimatryHelper.ToLetters(number);

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void ToLetters_WithZeroOrNegative_ShouldReturnEmpty()
    {
        GimatryHelper.ToLetters(0).Should().BeEmpty();
        GimatryHelper.ToLetters(-1).Should().BeEmpty();
        GimatryHelper.ToLetters(-100).Should().BeEmpty();
    }

    [Theory]
    [InlineData(115, "קטו")]  // 100 + 15 (special)
    [InlineData(116, "קטז")]  // 100 + 16 (special)
    [InlineData(215, "רטו")]  // 200 + 15 (special)
    [InlineData(216, "רטז")]  // 200 + 16 (special)
    [InlineData(315, "שטו")]  // 300 + 15 (special)
    [InlineData(316, "שטז")]  // 300 + 16 (special)
    [InlineData(415, "תטו")]  // 400 + 15 (special)
    [InlineData(416, "תטז")]  // 400 + 16 (special)
    public void ToLetters_ShouldHandleSpecialCasesWithHundreds(int number, string expected)
    {
        // Act
        var result = GimatryHelper.ToLetters(number);

        // Assert
        result.Should().Be(expected);
    }

    #endregion

    #region ToNumber Tests

    [Theory]
    [InlineData("א", 1)]
    [InlineData("ב", 2)]
    [InlineData("י", 10)]
    [InlineData("יא", 11)]
    [InlineData("טו", 15)]
    [InlineData("טז", 16)]
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

    [Fact]
    public void ToNumber_WithEmptyString_ShouldReturnZero()
    {
        GimatryHelper.ToNumber("").Should().Be(0);
    }

    [Fact]
    public void ToNumber_WithNonHebrewCharacters_ShouldIgnoreThem()
    {
        // Non-Hebrew characters should be ignored
        GimatryHelper.ToNumber("א123ב").Should().Be(3); // א(1) + ב(2) = 3
        GimatryHelper.ToNumber("abc").Should().Be(0);
    }

    [Theory]
    [InlineData("ך", 20)]  // Final kaf (regular value)
    [InlineData("ם", 40)]  // Final mem (regular value)
    [InlineData("ן", 50)]  // Final nun (regular value)
    [InlineData("ף", 80)]  // Final pe (regular value)
    [InlineData("ץ", 90)]  // Final tsadi (regular value)
    public void ToNumber_WithFinalLetters_ShouldUseRegularValues(string phrase, int expected)
    {
        // Act
        var result = GimatryHelper.ToNumber(phrase);

        // Assert
        result.Should().Be(expected);
    }

    #endregion

    #region ToNumberWithMantzpach Tests

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

    [Fact]
    public void ToNumberWithMantzpach_WithEmptyString_ShouldReturnZero()
    {
        GimatryHelper.ToNumberWithMantzpach("").Should().Be(0);
    }

    [Fact]
    public void ToNumberWithMantzpach_WithMixedLetters_ShouldCalculateCorrectly()
    {
        // אך = א(1) + ך(500) = 501
        GimatryHelper.ToNumberWithMantzpach("אך").Should().Be(501);

        // שלום = ש(300) + ל(30) + ו(6) + ם(600) = 936
        GimatryHelper.ToNumberWithMantzpach("שלום").Should().Be(936);
    }

    #endregion

    #region IsHebrewLetter Tests

    [Theory]
    [InlineData('א', true)]
    [InlineData('ב', true)]
    [InlineData('ג', true)]
    [InlineData('ד', true)]
    [InlineData('ה', true)]
    [InlineData('ו', true)]
    [InlineData('ז', true)]
    [InlineData('ח', true)]
    [InlineData('ט', true)]
    [InlineData('י', true)]
    [InlineData('כ', true)]
    [InlineData('ל', true)]
    [InlineData('מ', true)]
    [InlineData('נ', true)]
    [InlineData('ס', true)]
    [InlineData('ע', true)]
    [InlineData('פ', true)]
    [InlineData('צ', true)]
    [InlineData('ק', true)]
    [InlineData('ר', true)]
    [InlineData('ש', true)]
    [InlineData('ת', true)]
    public void IsHebrewLetter_WithHebrewLetters_ShouldReturnTrue(char c, bool expected)
    {
        GimatryHelper.IsHebrewLetter(c).Should().Be(expected);
    }

    [Theory]
    [InlineData('a', false)]
    [InlineData('Z', false)]
    [InlineData('1', false)]
    [InlineData('0', false)]
    [InlineData(' ', false)]
    [InlineData('.', false)]
    [InlineData('!', false)]
    [InlineData('\n', false)]
    public void IsHebrewLetter_WithNonHebrewCharacters_ShouldReturnFalse(char c, bool expected)
    {
        GimatryHelper.IsHebrewLetter(c).Should().Be(expected);
    }

    #endregion

    #region Extension Method Tests

    [Theory]
    [InlineData(1, "א")]
    [InlineData(15, "טו")]
    [InlineData(16, "טז")]
    [InlineData(150, "קנ")]
    [InlineData(929, "תתקכט")]
    public void IntExtension_ToHebrewLetters_ShouldWork(int number, string expected)
    {
        // Act
        var result = number.ToHebrewLetters();

        // Assert
        result.Should().Be(expected);
    }

    [Fact]
    public void IntExtension_ToHebrewLetters_WithZero_ShouldReturnEmpty()
    {
        0.ToHebrewLetters().Should().BeEmpty();
    }

    [Fact]
    public void IntExtension_ToHebrewLetters_WithNegative_ShouldReturnEmpty()
    {
        (-5).ToHebrewLetters().Should().BeEmpty();
    }

    #endregion
}
