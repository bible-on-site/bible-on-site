namespace BibleOnSite.Helpers;

/// <summary>
/// Helper class for Hebrew calendar date conversions and 929 cycle calculations.
/// Based on the web implementation in web/bible-on-site/src/data/perek-dto.tsx
/// </summary>
public static class HebrewDateHelper
{
    // Cycle start dates in Hebrew calendar format YYYYMMDD
    // From web/bible-on-site/src/data/db/cycles.json: [57750329, 57781103, 57821305, 57851207]
    private static readonly int[] CycleStartDates = { 57750329, 57781103, 57821305, 57851207 };
    private const int CycleLength = 1299; // Days in a 929 cycle

    /// <summary>
    /// Gets today's perek ID based on the current date in Jerusalem timezone.
    /// Handles tzeit (nightfall), weekend adjustment, and cycle boundaries.
    /// </summary>
    public static int GetTodaysPerekIdByHebrew(Dictionary<int, Models.Perek> perakim)
    {
        if (perakim == null || perakim.Count == 0)
            return 1;

        // Get current time in Jerusalem (Israel Standard Time / Israel Daylight Time)
        var now = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            DateTime.UtcNow,
            GetIsraelTimeZoneId());

        // Convert to Hebrew date with tzeit awareness
        var hebrewDate = GetTzeitAwareHebrewDate(now);

        // Weekend adjustment: Friday/Saturday -> use Thursday
        hebrewDate = AdjustForWeekend(hebrewDate, now.DayOfWeek);

        // Round to cycle boundaries if outside valid cycle dates
        hebrewDate = RoundToCycle(hebrewDate);

        // Convert Hebrew date to numeric format YYYYMMDD
        var hebDateNum = HebrewDateToNumber(hebrewDate);

        // Find perek matching this Hebrew date
        foreach (var kvp in perakim)
        {
            var perek = kvp.Value;
            // Check if the perek's HebDate contains this date
            // HebDate is stored as formatted string like "כ״ח שבט תשפ״ו"
            // We need to compare using the raw database date
            if (perek.HebDateNumeric == hebDateNum)
            {
                return kvp.Key;
            }
        }

        // Fallback: find closest matching date
        return FindClosestPerekByHebDate(perakim, hebDateNum);
    }

    /// <summary>
    /// Gets the Hebrew date, advancing to next day if after nightfall (tzeit).
    /// </summary>
    private static (int Year, int Month, int Day) GetTzeitAwareHebrewDate(DateTime date)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var year = calendar.GetYear(date);
        var month = calendar.GetMonth(date);
        var day = calendar.GetDayOfMonth(date);

        // Calculate approximate tzeit (nightfall) - about 40-60 minutes after sunset
        // For simplicity, use 19:30 (7:30 PM) as average tzeit in Israel
        // A more accurate calculation would use sun position
        var tzeit = new TimeSpan(19, 30, 0);

        if (date.TimeOfDay > tzeit)
        {
            // After nightfall - advance to next Hebrew day
            var nextDay = date.AddDays(1);
            year = calendar.GetYear(nextDay);
            month = calendar.GetMonth(nextDay);
            day = calendar.GetDayOfMonth(nextDay);
        }

        return (year, month, day);
    }

    /// <summary>
    /// Adjusts the date for weekends - Friday and Saturday use Thursday's perek.
    /// </summary>
    private static (int Year, int Month, int Day) AdjustForWeekend(
        (int Year, int Month, int Day) hebrewDate,
        DayOfWeek dayOfWeek)
    {
        // Friday = 5, Saturday = 6 in DayOfWeek enum
        if (dayOfWeek == DayOfWeek.Friday || dayOfWeek == DayOfWeek.Saturday)
        {
            // Go back to Thursday
            var daysBack = dayOfWeek == DayOfWeek.Friday ? 1 : 2;
            var calendar = new System.Globalization.HebrewCalendar();

            // Convert Hebrew date to DateTime, go back, then convert back
            try
            {
                var gregDate = calendar.ToDateTime(hebrewDate.Year, hebrewDate.Month, hebrewDate.Day, 12, 0, 0, 0);
                gregDate = gregDate.AddDays(-daysBack);
                return (
                    calendar.GetYear(gregDate),
                    calendar.GetMonth(gregDate),
                    calendar.GetDayOfMonth(gregDate)
                );
            }
            catch
            {
                // If conversion fails, return original
                return hebrewDate;
            }
        }

        return hebrewDate;
    }

    /// <summary>
    /// Rounds the date to be within valid cycle boundaries.
    /// </summary>
    private static (int Year, int Month, int Day) RoundToCycle((int Year, int Month, int Day) hebrewDate)
    {
        var dateNum = HebrewDateToNumber(hebrewDate);

        for (int i = 0; i < CycleStartDates.Length; i++)
        {
            var cycleStart = CycleStartDates[i];
            var cycleEnd = AddDaysToCycleDate(cycleStart, CycleLength - 1);

            // Before this cycle starts
            if (dateNum < cycleStart)
            {
                // Return cycle start date
                return NumberToHebrewDate(cycleStart);
            }

            // During this cycle
            if (dateNum <= cycleEnd)
            {
                // Date is valid, no adjustment needed
                return hebrewDate;
            }
        }

        // After all cycles - use last cycle end
        var lastCycleEnd = AddDaysToCycleDate(CycleStartDates[^1], CycleLength - 1);
        return NumberToHebrewDate(lastCycleEnd);
    }

    /// <summary>
    /// Converts a Hebrew date tuple to numeric format YYYYMMDD.
    /// </summary>
    private static int HebrewDateToNumber((int Year, int Month, int Day) date)
    {
        // Get uniform month number (handles leap year month ordering)
        var uniformMonth = GetUniformMonth(date.Year, date.Month);
        return date.Year * 10000 + uniformMonth * 100 + date.Day;
    }

    /// <summary>
    /// Converts a numeric Hebrew date to tuple format.
    /// </summary>
    private static (int Year, int Month, int Day) NumberToHebrewDate(int dateNum)
    {
        var year = dateNum / 10000;
        var month = (dateNum / 100) % 100;
        var day = dateNum % 100;
        return (year, month, day);
    }

    /// <summary>
    /// Gets a uniform month number that's consistent across leap/non-leap years.
    /// In the Hebrew calendar:
    /// - Non-leap year: months 1-12
    /// - Leap year: months 1-6, then Adar I (7), Adar II (8), then 9-13
    ///
    /// This method normalizes so Adar/Adar II is always month 6 for comparison purposes.
    /// </summary>
    private static int GetUniformMonth(int year, int month)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var isLeapYear = calendar.IsLeapYear(year);

        if (!isLeapYear)
        {
            return month;
        }

        // In leap year, HebrewCalendar has 13 months
        // Month 7 is Adar I, month 13 is the extra month
        // For uniform comparison, we use:
        // 1-6: same
        // 7 (Adar I in leap): 6
        // 8-13: shift by 1 to align with non-leap months
        if (month == 7)
        {
            return 6; // Adar I -> Adar
        }
        if (month > 7)
        {
            return month - 1;
        }
        return month;
    }

    /// <summary>
    /// Adds days to a Hebrew date number (approximate).
    /// </summary>
    private static int AddDaysToCycleDate(int dateNum, int days)
    {
        var (year, month, day) = NumberToHebrewDate(dateNum);
        var calendar = new System.Globalization.HebrewCalendar();

        try
        {
            var gregDate = calendar.ToDateTime(year, month, day, 12, 0, 0, 0);
            gregDate = gregDate.AddDays(days);
            var newYear = calendar.GetYear(gregDate);
            var newMonth = calendar.GetMonth(gregDate);
            var newDay = calendar.GetDayOfMonth(gregDate);
            return HebrewDateToNumber((newYear, newMonth, newDay));
        }
        catch
        {
            // Fallback: rough estimate
            return dateNum + days;
        }
    }

    /// <summary>
    /// Finds the perek with the closest Hebrew date.
    /// </summary>
    private static int FindClosestPerekByHebDate(Dictionary<int, Models.Perek> perakim, int targetHebDate)
    {
        int closestPerekId = 1;
        int closestDiff = int.MaxValue;

        foreach (var kvp in perakim)
        {
            var perek = kvp.Value;
            if (perek.HebDateNumeric > 0)
            {
                var diff = Math.Abs(perek.HebDateNumeric - targetHebDate);
                if (diff < closestDiff)
                {
                    closestDiff = diff;
                    closestPerekId = kvp.Key;
                }
            }
        }

        return closestPerekId;
    }

    /// <summary>
    /// Gets the Israel timezone ID based on the platform.
    /// </summary>
    private static string GetIsraelTimeZoneId()
    {
        // Windows uses "Israel Standard Time", Unix uses "Asia/Jerusalem"
        try
        {
            TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
            return "Asia/Jerusalem";
        }
        catch
        {
            return "Israel Standard Time";
        }
    }
}
