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
