namespace BibleOnSite.Helpers;

/// <summary>
/// Helper class for Hebrew calendar date conversions and 929 cycle calculations.
/// Based on the web implementation in web/bible-on-site/src/data/perek-dto.tsx
/// </summary>
public static class HebrewDateHelper
{
    private static readonly int[] CycleStartDates =
    {
        57750329, 57781103, 57821305, 57851207, // Cycles 1-4 (historical)
        57890709, 57930212, 57960814, 58000317, 58030920, 58070422 // Cycles 5-10 (pre-populated)
    };
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
    internal static (int Year, int Month, int Day) GetTzeitAwareHebrewDate(DateTime date)
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
    internal static (int Year, int Month, int Day) AdjustForWeekend(
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
    internal static (int Year, int Month, int Day) RoundToCycle((int Year, int Month, int Day) hebrewDate)
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
    internal static int HebrewDateToNumber((int Year, int Month, int Day) date)
    {
        var legacyMonth = CalendarMonthToLegacy(date.Year, date.Month);
        return date.Year * 10000 + legacyMonth * 100 + date.Day;
    }

    /// <summary>
    /// Converts a numeric Hebrew date to tuple format.
    /// </summary>
    internal static (int Year, int Month, int Day) NumberToHebrewDate(int dateNum)
    {
        var year = dateNum / 10000;
        var month = (dateNum / 100) % 100;
        var day = dateNum % 100;
        return (year, month, day);
    }

    /// <summary>
    /// Converts a HebrewCalendar month number to the legacy format used in cycle dates.
    /// In HebrewCalendar leap year: 1=Tishrei..5=Shevat, 6=Adar I, 7=Adar II, 8=Nisan..13=Elul
    /// Legacy format: 1=Tishrei..5=Shevat, 6=Adar/Adar II, 7=Nisan..12=Elul, 13=Adar I
    /// </summary>
    internal static int CalendarMonthToLegacy(int year, int calendarMonth)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        if (!calendar.IsLeapYear(year))
            return calendarMonth;

        return calendarMonth switch
        {
            <= 5 => calendarMonth,
            6 => 13,                // Adar I → legacy 13
            7 => 6,                 // Adar II → legacy 6 (Adar position)
            _ => calendarMonth - 1, // Nisan(8)→7, ..., Elul(13)→12
        };
    }

    /// <summary>
    /// Converts a legacy format month number back to HebrewCalendar month number.
    /// Reverse of <see cref="CalendarMonthToLegacy"/>.
    /// </summary>
    internal static int LegacyMonthToCalendar(int year, int legacyMonth)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        if (!calendar.IsLeapYear(year))
            return legacyMonth;

        return legacyMonth switch
        {
            <= 5 => legacyMonth,
            6 => 7,                              // Adar (legacy) → HC Adar II (7)
            >= 7 and <= 12 => legacyMonth + 1,   // Nisan(7)→8, ..., Elul(12)→13
            13 => 6,                              // Adar I (legacy) → HC Adar I (6)
            _ => legacyMonth,
        };
    }

    /// <summary>
    /// Adds days to a Hebrew date number (approximate).
    /// </summary>
    internal static int AddDaysToCycleDate(int dateNum, int days)
    {
        var (year, legacyMonth, day) = NumberToHebrewDate(dateNum);
        var calendar = new System.Globalization.HebrewCalendar();
        var calendarMonth = LegacyMonthToCalendar(year, legacyMonth);

        try
        {
            var gregDate = calendar.ToDateTime(year, calendarMonth, day, 12, 0, 0, 0);
            gregDate = gregDate.AddDays(days);
            var newYear = calendar.GetYear(gregDate);
            var newMonth = calendar.GetMonth(gregDate);
            var newDay = calendar.GetDayOfMonth(gregDate);
            return HebrewDateToNumber((newYear, newMonth, newDay));
        }
        catch
        {
            return dateNum + days;
        }
    }

    /// <summary>
    /// Finds the perek with the closest Hebrew date.
    /// </summary>
    internal static int FindClosestPerekByHebDate(Dictionary<int, Models.Perek> perakim, int targetHebDate)
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
    internal static string GetIsraelTimeZoneId()
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
