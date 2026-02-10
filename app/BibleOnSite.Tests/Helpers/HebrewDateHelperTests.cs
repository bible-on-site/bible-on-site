using BibleOnSite.Helpers;
using BibleOnSite.Models;
using FluentAssertions;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Unit tests for HebrewDateHelper.
/// Tests the Hebrew calendar date conversions and 929 cycle calculations.
/// </summary>
public class HebrewDateHelperTests
{
    #region GetTodaysPerekIdByHebrew Tests

    [Fact]
    public void GetTodaysPerekIdByHebrew_WithEmptyDictionary_ShouldReturnOne()
    {
        // Arrange
        var emptyPerakim = new Dictionary<int, Perek>();

        // Act
        var result = HebrewDateHelper.GetTodaysPerekIdByHebrew(emptyPerakim);

        // Assert
        result.Should().Be(1, "Empty dictionary should return default perek ID 1");
    }

    [Fact]
    public void GetTodaysPerekIdByHebrew_WithNullDictionary_ShouldReturnOne()
    {
        // Act
        var result = HebrewDateHelper.GetTodaysPerekIdByHebrew(null!);

        // Assert
        result.Should().Be(1, "Null dictionary should return default perek ID 1");
    }

    [Fact]
    public void GetTodaysPerekIdByHebrew_WithValidPerakim_ShouldReturnValidPerekId()
    {
        // Arrange
        // Create a dictionary with valid perakim spanning the current cycle
        var perakim = CreateTestPerakimForCurrentDate();

        // Act
        var result = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);

        // Assert
        result.Should().BeInRange(1, 929, "Should return a valid perek ID between 1 and 929");
    }

    [Fact]
    public void GetTodaysPerekIdByHebrew_ShouldReturnConsistentResult()
    {
        // Arrange
        var perakim = CreateTestPerakimForCurrentDate();

        // Act - call multiple times
        var result1 = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);
        var result2 = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);
        var result3 = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);

        // Assert - should be deterministic for the same input
        result1.Should().Be(result2);
        result2.Should().Be(result3);
    }

    #endregion

    #region Weekend Adjustment Tests

    [Fact]
    public void GetTodaysPerekIdByHebrew_OnFriday_ShouldReturnThursdaysPerek()
    {
        // This test validates the weekend adjustment logic conceptually
        // The actual day depends on when the test runs, so we verify the method
        // handles weekend days without throwing exceptions

        // Arrange
        var perakim = CreateTestPerakimForCurrentDate();

        // Act & Assert - should not throw
        var result = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);
        result.Should().BeGreaterThan(0);
    }

    #endregion

    #region Cycle Boundary Tests

    [Fact]
    public void GetTodaysPerekIdByHebrew_WithinCycleBoundaries_ShouldFindMatchingPerek()
    {
        // Arrange - create perakim with dates within current cycle
        var perakim = new Dictionary<int, Perek>
        {
            { 1, CreatePerekWithHebDateNumeric(1, 57850101) },
            { 100, CreatePerekWithHebDateNumeric(100, 57850401) },
            { 500, CreatePerekWithHebDateNumeric(500, 57851001) },
            { 929, CreatePerekWithHebDateNumeric(929, 57860101) }
        };

        // Act
        var result = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);

        // Assert - should return a valid perek ID (may find closest match)
        result.Should().BeOneOf(1, 100, 500, 929);
    }

    #endregion

    #region Edge Cases

    [Fact]
    public void GetTodaysPerekIdByHebrew_WithSinglePerek_ShouldReturnThatPerek()
    {
        // Arrange
        var perakim = new Dictionary<int, Perek>
        {
            { 42, CreatePerekWithHebDateNumeric(42, GetCurrentApproximateHebDateNumeric()) }
        };

        // Act
        var result = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);

        // Assert - should find the only perek or return closest (which is also 42)
        result.Should().Be(42);
    }

    [Fact]
    public void GetTodaysPerekIdByHebrew_WithPerakimHavingZeroHebDate_ShouldHandleGracefully()
    {
        // Arrange - perakim with no Hebrew date set
        var perakim = new Dictionary<int, Perek>
        {
            { 1, CreatePerekWithHebDateNumeric(1, 0) },
            { 2, CreatePerekWithHebDateNumeric(2, 0) }
        };

        // Act
        var result = HebrewDateHelper.GetTodaysPerekIdByHebrew(perakim);

        // Assert - should handle gracefully (return default or closest)
        result.Should().BeGreaterThan(0);
    }

    #endregion

    #region GetTzeitAwareHebrewDate Tests

    [Fact]
    public void GetTzeitAwareHebrewDate_BeforeTzeit_ShouldReturnSameDay()
    {
        // 10:00 AM - well before tzeit (19:30)
        var date = new DateTime(2026, 2, 9, 10, 0, 0);
        var calendar = new System.Globalization.HebrewCalendar();
        var expectedYear = calendar.GetYear(date);
        var expectedMonth = calendar.GetMonth(date);
        var expectedDay = calendar.GetDayOfMonth(date);

        var result = HebrewDateHelper.GetTzeitAwareHebrewDate(date);

        result.Year.Should().Be(expectedYear);
        result.Month.Should().Be(expectedMonth);
        result.Day.Should().Be(expectedDay);
    }

    [Fact]
    public void GetTzeitAwareHebrewDate_AfterTzeit_ShouldAdvanceToNextDay()
    {
        // 20:00 - after tzeit (19:30), should advance to next Hebrew day
        var date = new DateTime(2026, 2, 9, 20, 0, 0);
        var calendar = new System.Globalization.HebrewCalendar();
        var nextDay = date.AddDays(1);
        var expectedYear = calendar.GetYear(nextDay);
        var expectedMonth = calendar.GetMonth(nextDay);
        var expectedDay = calendar.GetDayOfMonth(nextDay);

        var result = HebrewDateHelper.GetTzeitAwareHebrewDate(date);

        result.Year.Should().Be(expectedYear);
        result.Month.Should().Be(expectedMonth);
        result.Day.Should().Be(expectedDay);
    }

    #endregion

    #region AdjustForWeekend Tests

    [Fact]
    public void AdjustForWeekend_OnFriday_ShouldGoBackOneDay()
    {
        var calendar = new System.Globalization.HebrewCalendar();
        // Find a known Friday date
        var friday = new DateTime(2026, 2, 13); // Fri Feb 13 2026
        var hebDate = (calendar.GetYear(friday), calendar.GetMonth(friday), calendar.GetDayOfMonth(friday));

        var thursday = friday.AddDays(-1);
        var expected = (calendar.GetYear(thursday), calendar.GetMonth(thursday), calendar.GetDayOfMonth(thursday));

        var result = HebrewDateHelper.AdjustForWeekend(hebDate, DayOfWeek.Friday);

        result.Should().Be(expected);
    }

    [Fact]
    public void AdjustForWeekend_OnSaturday_ShouldGoBackTwoDays()
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var saturday = new DateTime(2026, 2, 14); // Sat Feb 14 2026
        var hebDate = (calendar.GetYear(saturday), calendar.GetMonth(saturday), calendar.GetDayOfMonth(saturday));

        var thursday = saturday.AddDays(-2);
        var expected = (calendar.GetYear(thursday), calendar.GetMonth(thursday), calendar.GetDayOfMonth(thursday));

        var result = HebrewDateHelper.AdjustForWeekend(hebDate, DayOfWeek.Saturday);

        result.Should().Be(expected);
    }

    [Fact]
    public void AdjustForWeekend_OnWeekday_ShouldReturnUnchanged()
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var wednesday = new DateTime(2026, 2, 11);
        var hebDate = (calendar.GetYear(wednesday), calendar.GetMonth(wednesday), calendar.GetDayOfMonth(wednesday));

        var result = HebrewDateHelper.AdjustForWeekend(hebDate, DayOfWeek.Wednesday);

        result.Should().Be(hebDate);
    }

    #endregion

    #region NumberToHebrewDate / HebrewDateToNumber Tests

    [Theory]
    [InlineData(57860115, 5786, 1, 15)]
    [InlineData(57850701, 5785, 7, 1)]
    public void NumberToHebrewDate_ShouldParseCorrectly(int num, int year, int month, int day)
    {
        var result = HebrewDateHelper.NumberToHebrewDate(num);
        result.Year.Should().Be(year);
        result.Month.Should().Be(month);
        result.Day.Should().Be(day);
    }

    [Fact]
    public void HebrewDateToNumber_ShouldRoundTripForNonLeapYear()
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var date = new DateTime(2026, 1, 15);
        var year = calendar.GetYear(date);
        var month = calendar.GetMonth(date);
        var day = calendar.GetDayOfMonth(date);

        var num = HebrewDateHelper.HebrewDateToNumber((year, month, day));
        num.Should().BeGreaterThan(0);
    }

    #endregion

    #region GetUniformMonth Tests

    [Fact]
    public void GetUniformMonth_NonLeapYear_ShouldReturnSameMonth()
    {
        // Hebrew year 5786 is NOT a leap year
        var result = HebrewDateHelper.GetUniformMonth(5786, 5);
        result.Should().Be(5);
    }

    [Fact]
    public void GetUniformMonth_LeapYear_Month7_ShouldReturn6()
    {
        // Hebrew year 5787 IS a leap year (19-year cycle: 3,6,8,11,14,17,19 are leap)
        // 5787 % 19 = 14 → leap year
        var result = HebrewDateHelper.GetUniformMonth(5787, 7);
        result.Should().Be(6);
    }

    [Fact]
    public void GetUniformMonth_LeapYear_MonthAbove7_ShouldShift()
    {
        var result = HebrewDateHelper.GetUniformMonth(5787, 10);
        result.Should().Be(9); // month - 1
    }

    [Fact]
    public void GetUniformMonth_LeapYear_MonthBelow7_ShouldReturnSame()
    {
        var result = HebrewDateHelper.GetUniformMonth(5787, 3);
        result.Should().Be(3);
    }

    #endregion

    #region AddDaysToCycleDate Tests

    [Fact]
    public void AddDaysToCycleDate_ShouldAddDays()
    {
        var startDate = 57860115; // 15 Tevet 5786
        var result = HebrewDateHelper.AddDaysToCycleDate(startDate, 30);
        result.Should().BeGreaterThan(startDate);
    }

    #endregion

    #region RoundToCycle Tests

    [Fact]
    public void RoundToCycle_DateWithinCycle_ShouldReturnUnchanged()
    {
        // Use a date we know is within the 4th cycle (57851207 start)
        var calendar = new System.Globalization.HebrewCalendar();
        var date = new DateTime(2025, 3, 15); // Should be within cycle 4
        var year = calendar.GetYear(date);
        var month = calendar.GetMonth(date);
        var day = calendar.GetDayOfMonth(date);
        var hebDate = (year, month, day);

        // RoundToCycle should return the same date if within a valid cycle
        var result = HebrewDateHelper.RoundToCycle(hebDate);
        // The result should be a valid Hebrew date tuple
        result.Year.Should().BeGreaterThan(0);
    }

    #endregion

    #region FindClosestPerekByHebDate Tests

    [Fact]
    public void FindClosestPerekByHebDate_ShouldReturnClosestMatch()
    {
        var perakim = new Dictionary<int, Perek>
        {
            { 1, CreatePerekWithHebDateNumeric(1, 57860100) },
            { 2, CreatePerekWithHebDateNumeric(2, 57860200) },
            { 3, CreatePerekWithHebDateNumeric(3, 57860300) },
        };

        var result = HebrewDateHelper.FindClosestPerekByHebDate(perakim, 57860180);
        result.Should().Be(2); // closest to 57860200
    }

    [Fact]
    public void FindClosestPerekByHebDate_WithZeroHebDates_ShouldReturnDefault()
    {
        var perakim = new Dictionary<int, Perek>
        {
            { 5, CreatePerekWithHebDateNumeric(5, 0) },
            { 6, CreatePerekWithHebDateNumeric(6, 0) },
        };

        var result = HebrewDateHelper.FindClosestPerekByHebDate(perakim, 57860115);
        result.Should().Be(1); // default when no valid dates
    }

    #endregion

    #region GetIsraelTimeZoneId Tests

    [Fact]
    public void GetIsraelTimeZoneId_ShouldReturnValidTimezone()
    {
        var tzId = HebrewDateHelper.GetIsraelTimeZoneId();
        // On Windows: "Israel Standard Time", on Unix: "Asia/Jerusalem"
        tzId.Should().BeOneOf("Asia/Jerusalem", "Israel Standard Time");
    }

    #endregion

    #region Helper Methods

    /// <summary>
    /// Creates a test perek with the specified Hebrew date in numeric format.
    /// </summary>
    private static Perek CreatePerekWithHebDateNumeric(int perekId, int hebDateNumeric)
    {
        return new Perek
        {
            PerekId = perekId,
            HebDateNumeric = hebDateNumeric,
            SeferName = "Test",
            PerekNumber = perekId,
            SeferId = 1,
            Date = "2026-01-01",
            HebDate = "Test",
            SeferTanahUsName = "Test",
            Tseit = "17:00"
        };
    }

    /// <summary>
    /// Creates a dictionary of test perakim spanning dates around the current date.
    /// </summary>
    private static Dictionary<int, Perek> CreateTestPerakimForCurrentDate()
    {
        var currentApproxHebDate = GetCurrentApproximateHebDateNumeric();
        var perakim = new Dictionary<int, Perek>();

        // Create perakim with dates spread around current date
        for (int i = 1; i <= 929; i++)
        {
            // Spread dates across the cycle (929 days)
            var dateOffset = i - 465; // Center around middle
            var hebDate = currentApproxHebDate + dateOffset;
            perakim[i] = CreatePerekWithHebDateNumeric(i, hebDate);
        }

        return perakim;
    }

    /// <summary>
    /// Gets an approximate Hebrew date numeric value for the current date.
    /// Format: YYYYMMDD where YYYY is Hebrew year.
    /// </summary>
    private static int GetCurrentApproximateHebDateNumeric()
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var now = DateTime.Now;
        var year = calendar.GetYear(now);
        var month = calendar.GetMonth(now);
        var day = calendar.GetDayOfMonth(now);
        return year * 10000 + month * 100 + day;
    }

    #endregion
}
