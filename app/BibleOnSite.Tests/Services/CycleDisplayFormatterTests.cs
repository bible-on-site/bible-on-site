using BibleOnSite.Helpers;
using BibleOnSite.Services;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// The single authority for user-facing cycle labels (#2725): Hebrew display
/// numerals, the (משוער) marker and the start/end range — mirroring the
/// website's getCycleName/getCycleLabel output.
/// </summary>
public class CycleDisplayFormatterTests
{
    [Theory]
    [InlineData(1, false, "מחזור א'")]
    [InlineData(4, false, "מחזור ד'")]
    [InlineData(10, false, "מחזור י'")]
    [InlineData(11, false, "מחזור י\"א")]
    [InlineData(15, false, "מחזור ט\"ו")]
    [InlineData(11, true, "מחזור י\"א (משוער)")]
    public void Name_FormatsTheHebrewNumeralAndProjectedMarker(
        int number, bool projected, string expected)
    {
        var cycle = new PerekScheduleService.StudyCycle(number, 57851207, 57890406, projected);

        CycleDisplayFormatter.Name(cycle).Should().Be(expected);
    }

    [Fact]
    public void Label_AppendsTheHebrewDateRange()
    {
        var cycle = new PerekScheduleService.StudyCycle(4, 57851207, 57890406, false);
        var expected =
            $"מחזור ד': {HebrewDateHelper.FormatHebrewDate(57851207)} - " +
            $"{HebrewDateHelper.FormatHebrewDate(57890406)}";

        CycleDisplayFormatter.Label(cycle).Should().Be(expected);
    }
}
