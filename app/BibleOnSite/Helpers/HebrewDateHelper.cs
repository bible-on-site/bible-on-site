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
            // HebDate is stored as formatted string like "כ"ח שבט תשפ"ו"
            // We need to compare using the raw database date
            if (perek.HebDateNumeric == hebDateNum)
            {
                return kvp.Key;
            }
        }

        // Fallback: find closest matching date
        return FindClosestPerekByHebDate(perakim, hebDateNum);
    }

    private const double JerusalemLatitude = 31.778;
    private const double JerusalemLongitude = 35.235;
    private static readonly TimeSpan FallbackTzeit = new(19, 30, 0);

    /// <summary>
    /// Civil dusk (zenith 96°, our tzeit approximation) for Jerusalem on the
    /// given Jerusalem-local date, using NOAA solar declination and equation
    /// of time. Matches the website's astronomical computation to ~a minute.
    /// </summary>
    internal static TimeSpan GetTzeitTimeOfDay(DateTime jerusalemDate)
    {
        return GetTzeitTimeOfDay(jerusalemDate, JerusalemLatitude, JerusalemLongitude);
    }

    /// <summary>
    /// Civil dusk (zenith 96°) for an arbitrary location, exposed for tests:
    /// locations far enough poleward can have no dusk on a given date.
    /// </summary>
    internal static TimeSpan GetTzeitTimeOfDay(DateTime date, double latitude, double longitude)
    {
        // NOAA solar position approximations for an 18:00 local guess.
        var gamma = 2 * Math.PI / 365 * (date.DayOfYear - 1 + (18 - 12) / 24.0);
        var eqTimeMinutes = 229.18 * (0.000075 + 0.001868 * Math.Cos(gamma)
            - 0.032077 * Math.Sin(gamma)
            - 0.014615 * Math.Cos(2 * gamma)
            - 0.040849 * Math.Sin(2 * gamma));
        var declination = 0.006918 - 0.399912 * Math.Cos(gamma)
            + 0.070257 * Math.Sin(gamma)
            - 0.006758 * Math.Cos(2 * gamma)
            + 0.000907 * Math.Sin(2 * gamma)
            - 0.002697 * Math.Cos(3 * gamma)
            + 0.00148 * Math.Sin(3 * gamma);
        var cosHourAngle = Math.Cos(DegreesToRadians(96)) /
            (Math.Cos(DegreesToRadians(latitude)) * Math.Cos(declination))
            - Math.Tan(DegreesToRadians(latitude)) * Math.Tan(declination);

        if (cosHourAngle is > 1 or < -1)
        {
            // Polar day/night (never happens in Jerusalem).
            return FallbackTzeit;
        }

        var hourAngle = RadiansToDegrees(Math.Acos(cosHourAngle));
        var utcMinutes = 720 - 4 * (longitude - hourAngle) - eqTimeMinutes;
        var duskUtc = DateTime.SpecifyKind(date.Date, DateTimeKind.Utc)
            .AddMinutes(utcMinutes);
        var israelTz = TimeZoneInfo.FindSystemTimeZoneById(GetIsraelTimeZoneId());
        var duskLocal = TimeZoneInfo.ConvertTimeFromUtc(duskUtc, israelTz);
        return duskLocal.TimeOfDay;
    }

    private static double DegreesToRadians(double degrees) => degrees * Math.PI / 180;

    private static double RadiansToDegrees(double radians) => radians * 180 / Math.PI;

    /// <summary>
    /// Gets the Hebrew date, advancing to next day if after nightfall (tzeit).
    /// </summary>
    internal static (int Year, int Month, int Day) GetTzeitAwareHebrewDate(DateTime date)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var year = calendar.GetYear(date);
        var month = calendar.GetMonth(date);
        var day = calendar.GetDayOfMonth(date);

        // Tzeit is Jerusalem civil dusk (zenith 96°), computed astronomically.
        var tzeit = GetTzeitTimeOfDay(date);

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
    /// Legacy format: 1=Tishrei..5=Shevat, 6=Adar(non-leap), 7=Nisan..12=Elul, 13=Adar I, 14=Adar II
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
            7 => 14,                // Adar II → legacy 14
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
            6 => 7,                              // Adar (non-leap legacy 6) → HC Adar II (7) for comparison
            >= 7 and <= 12 => legacyMonth + 1,   // Nisan(7)→8, ..., Elul(12)→13
            13 => 6,                              // Adar I (legacy) → HC Adar I (6)
            14 => 7,                              // Adar II (legacy) → HC Adar II (7)
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

        try
        {
            var calendarMonth = LegacyMonthToCalendar(year, legacyMonth);
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
        return TimeZoneInfo.TryFindSystemTimeZoneById("Asia/Jerusalem", out _)
            ? "Asia/Jerusalem"
            : "Israel Standard Time";
    }

    #region Hebrew month helpers (לוח לימוד יומי)

    /// <summary>
    /// Whether a Hebrew year is a leap year (has Adar I and Adar II).
    /// </summary>
    public static bool IsHebrewLeapYear(int year)
    {
        return new System.Globalization.HebrewCalendar().IsLeapYear(year);
    }

    /// <summary>
    /// Legacy month numbers of a year in chronological order.
    /// Leap years place Adar I (13) and Adar II (14) between Shevat (5) and Nisan (7).
    /// </summary>
    public static int[] GetMonthOrder(int year)
    {
        return IsHebrewLeapYear(year)
            ? [1, 2, 3, 4, 5, 13, 14, 7, 8, 9, 10, 11, 12]
            : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    }

    /// <summary>
    /// Converts a legacy-format Hebrew date to a Gregorian <see cref="DateTime"/>.
    /// </summary>
    public static DateTime ToGregorianDate(int year, int legacyMonth, int day)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var calendarMonth = LegacyMonthToCalendar(year, legacyMonth);
        return calendar.ToDateTime(year, calendarMonth, day, 12, 0, 0, 0);
    }

    /// <summary>
    /// Converts a numeric Hebrew date (YYYYMMDD, legacy months) to a Gregorian <see cref="DateTime"/>.
    /// </summary>
    public static DateTime ToGregorianDate(int dateNum)
    {
        var (year, month, day) = NumberToHebrewDate(dateNum);
        return ToGregorianDate(year, month, day);
    }

    /// <summary>
    /// Number of days in a legacy-format Hebrew month.
    /// </summary>
    public static int GetDaysInMonth(int year, int legacyMonth)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        var calendarMonth = LegacyMonthToCalendar(year, legacyMonth);
        return calendar.GetDaysInMonth(year, calendarMonth);
    }

    /// <summary>
    /// Day of week of a legacy-format Hebrew date (0=Sunday ... 6=Saturday).
    /// </summary>
    public static int GetDayOfWeek(int year, int legacyMonth, int day)
    {
        return (int)ToGregorianDate(year, legacyMonth, day).DayOfWeek;
    }

    /// <summary>
    /// Adds days to a numeric Hebrew date using real calendar arithmetic.
    /// </summary>
    public static int AddDays(int dateNum, int days)
    {
        var gregorian = ToGregorianDate(dateNum).AddDays(days);
        var calendar = new System.Globalization.HebrewCalendar();
        return HebrewDateToNumber((
            calendar.GetYear(gregorian),
            calendar.GetMonth(gregorian),
            calendar.GetDayOfMonth(gregorian)));
    }

    /// <summary>
    /// Number of days between two numeric Hebrew dates (b - a).
    /// </summary>
    public static int DaysBetween(int dateNumA, int dateNumB)
    {
        return (int)(ToGregorianDate(dateNumB) - ToGregorianDate(dateNumA)).TotalDays;
    }

    /// <summary>
    /// Hebrew month name for a legacy month number.
    /// </summary>
    /// <remarks>
    /// Legacy month numbers keep Nisan at 7 in every year; Adar I and II use
    /// 13 and 14 in leap years.
    /// </remarks>
    public static string GetHebrewMonthName(int legacyMonth, bool isLeapYear)
    {
        return legacyMonth switch
        {
            1 => "תשרי",
            2 => "חשוון",
            3 => "כסלו",
            4 => "טבת",
            5 => "שבט",
            6 => isLeapYear ? "אדר ב" : "אדר",
            7 => "ניסן",
            8 => "אייר",
            9 => "סיון",
            10 => "תמוז",
            11 => "אב",
            12 => "אלול",
            13 when isLeapYear => "אדר א",
            14 when isLeapYear => "אדר ב",
            _ => string.Empty
        };
    }

    /// <summary>
    /// Formats a numeric Hebrew date as e.g. "כח שבט תשפו" (same style as perek HebDate).
    /// </summary>
    public static string FormatHebrewDate(int dateNum)
    {
        var (year, month, day) = NumberToHebrewDate(dateNum);
        var dayText = day.ToHebrewLetters();
        var monthText = GetHebrewMonthName(month, IsHebrewLeapYear(year));
        var yearText = GimatryHelper.ToLetters(year % 1000);
        return string.IsNullOrEmpty(monthText)
            ? dateNum.ToString()
            : $"{dayText} {monthText} {yearText}";
    }

    /// <summary>
    /// Today's tzeit-aware Hebrew date (Jerusalem time) as YYYYMMDD.
    /// </summary>
    internal static int GetTodayDateNumber()
    {
        var now = TimeZoneInfo.ConvertTimeBySystemTimeZoneId(
            DateTime.UtcNow,
            GetIsraelTimeZoneId());
        var hebrewDate = GetTzeitAwareHebrewDate(now);
        return HebrewDateToNumber(hebrewDate);
    }

    /// <summary>
    /// The month that follows a legacy-format month, crossing year boundaries.
    /// </summary>
    internal static (int Year, int Month) NextMonth(int year, int month)
    {
        var order = GetMonthOrder(year);
        var index = Array.IndexOf(order, month);
        if (index < 0)
        {
            throw new ArgumentException($"Month {month} does not exist in year {year}", nameof(month));
        }
        return index + 1 < order.Length ? (year, order[index + 1]) : (year + 1, 1);
    }

    /// <summary>
    /// The month that precedes a legacy-format month, crossing year boundaries.
    /// </summary>
    internal static (int Year, int Month) PrevMonth(int year, int month)
    {
        var order = GetMonthOrder(year);
        var index = Array.IndexOf(order, month);
        if (index < 0)
        {
            throw new ArgumentException($"Month {month} does not exist in year {year}", nameof(month));
        }
        return index > 0 ? (year, order[index - 1]) : (year - 1, GetMonthOrder(year - 1)[^1]);
    }

    #endregion
}
