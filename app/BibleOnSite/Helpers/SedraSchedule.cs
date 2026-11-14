namespace BibleOnSite.Helpers;

/// <summary>
/// פרשת השבוע — resolves a tzeit-aware Hebrew date to the weekly Torah
/// reading of its Shabbat, following the standard annual-cycle schedule.
///
/// A Hebrew year's schedule is a sequence of weekly slots starting at the
/// first Shabbat on or after Rosh Hashana and ending at the last Shabbat
/// before the next Rosh Hashana. A slot is either a festival Shabbat (no
/// ordinary parasha) or the next one or two parashot in the fixed 54-unit
/// cycle. Which of the seven joinable pairs actually join — and whether the
/// נצבים/וילך tail is read joined or split across the year boundary — is
/// determined by the year's keviyah: leap/non-leap, the weekday of Rosh
/// Hashana, and whether Cheshvan/Kislev are full or deficient. Israel and
/// Diaspora schedules differ when a second festival day falls on Shabbat.
///
/// The per-keviyah join table below encodes the conventional pairings as
/// published in printed luachot; the keviyah and festival dates are computed
/// arithmetically from <see cref="System.Globalization.HebrewCalendar"/> via
/// <see cref="HebrewDateHelper"/>, so no external calendar data is needed.
/// </summary>
public static class SedraSchedule
{
    /// <summary>The 54 parashot of the annual cycle in canonical order.</summary>
    public static int ParashaCount { get; } = 54;

    /// <summary>0-based parasha indexes the joined pairs start at.</summary>
    private const int Vayakhel = 21;
    private const int Tazria = 26;
    private const int Achrei = 28;
    private const int Behar = 31;
    private const int Chukat = 38;
    private const int Matot = 41;
    private const int Nitzavim = 50;

    /// <summary>Tail parashot that open the year's schedule in Tishrei.</summary>
    private const int Vayeilech = 51;
    private const int Haazinu = 52;
    private const int VezotHaberakhah = 53;

    /// <summary>
    /// One weekly slot of a year's schedule: either an ordinary reading of
    /// one or two parashot, or a festival Shabbat with no ordinary parasha.
    /// </summary>
    /// <param name="ShabbatDate">
    /// The Shabbat's Hebrew date as YYYYMMDD (legacy month numbering —
    /// Nisan is always 7; leap Adar I/II are 13/14).
    /// </param>
    /// <param name="ParashaIndexes">
    /// 0-based parasha indexes in canonical order — one entry for an
    /// ordinary week, two for a joined reading, empty on a festival
    /// Shabbat. A parasha index equals its reading-unit order minus one.
    /// </param>
    /// <param name="HolidayName">
    /// Hebrew name of the festival displacing the ordinary reading, or
    /// null on an ordinary week.
    /// </param>
    public sealed record WeeklyReading(
        int ShabbatDate,
        IReadOnlyList<int> ParashaIndexes,
        string? HolidayName)
    {
        /// <summary>Whether this Shabbat carries an ordinary parasha.</summary>
        public bool HasParasha => ParashaIndexes.Count > 0;
    }

    /// <summary>
    /// The reading of the week containing a Hebrew date — a weekday resolves
    /// to the coming Shabbat, a Shabbat to itself. Post-tzeit Friday is
    /// already the next Hebrew day, so it resolves to the next Shabbat; the
    /// same happens on motzei Shabbat after nightfall.
    /// </summary>
    /// <param name="hebrewDateNum">Tzeit-aware Hebrew date (YYYYMMDD).</param>
    public static WeeklyReading GetWeeklyReading(int hebrewDateNum)
    {
        return GetWeeklyReading(hebrewDateNum, israel: true);
    }

    /// <inheritdoc cref="GetWeeklyReading(int)"/>
    /// <param name="israel">Israel schedule; false for Diaspora.</param>
    public static WeeklyReading GetWeeklyReading(int hebrewDateNum, bool israel)
    {
        var shabbat = UpcomingShabbat(hebrewDateNum);
        return ReadingOfShabbat(shabbat, israel);
    }

    /// <summary>
    /// פרשת השבוע for right now — the tzeit-aware Hebrew date in the
    /// Jerusalem timezone, on the product's Israel schedule.
    /// </summary>
    public static WeeklyReading GetCurrentReading()
    {
        return GetWeeklyReading(HebrewDateHelper.GetTodayDateNumber(), israel: true);
    }

    /// <summary>
    /// The first ordinary (non-festival) reading on or after the week of
    /// <paramref name="hebrewDateNum"/> — the fallback offered on a festival
    /// Shabbat, which carries no weekly parasha. Israel schedule.
    /// </summary>
    public static WeeklyReading GetNextRegularReading(int hebrewDateNum)
    {
        return GetNextRegularReading(hebrewDateNum, israel: true);
    }

    /// <inheritdoc cref="GetNextRegularReading(int)"/>
    /// <param name="israel">Israel schedule; false for Diaspora.</param>
    public static WeeklyReading GetNextRegularReading(int hebrewDateNum, bool israel)
    {
        var shabbat = UpcomingShabbat(hebrewDateNum);
        // A full Hebrew year of festival Shabbats is impossible, so the
        // scan always terminates — the longest gap is the Tishrei cluster.
        while (true)
        {
            var reading = ReadingOfShabbat(shabbat, israel);
            if (reading.HasParasha)
            {
                return reading;
            }
            shabbat = HebrewDateHelper.AddDays(shabbat, 7);
        }
    }

    /// <summary>
    /// Builds the week's resolution: the Saturday containing/following the
    /// Hebrew date, read in the schedule of that Shabbat's Hebrew year.
    /// </summary>
    private static WeeklyReading ReadingOfShabbat(int shabbatDateNum, bool israel)
    {
        var (year, _, _) = HebrewDateHelper.NumberToHebrewDate(shabbatDateNum);
        // Every Shabbat of the year is a slot by construction — a miss
        // throws InvalidOperationException, the same loud invariant
        // failure an explicit null-check would raise.
        return BuildYear(year, israel).First(s => s.ShabbatDate == shabbatDateNum);
    }

    /// <summary>
    /// The Shabbat a Hebrew date belongs to: itself on Shabbat, otherwise
    /// the coming Shabbat of its week.
    /// </summary>
    private static int UpcomingShabbat(int hebrewDateNum)
    {
        var greg = HebrewDateHelper.ToGregorianDate(hebrewDateNum);
        var daysToShabbat = ((int)DayOfWeek.Saturday - (int)greg.DayOfWeek + 7) % 7;
        return HebrewDateHelper.AddDays(hebrewDateNum, daysToShabbat);
    }

    /// <summary>
    /// All weekly slots of a Hebrew year, from the first Shabbat on or after
    /// 1 Tishrei through the last Shabbat before the next 1 Tishrei.
    /// </summary>
    internal static List<WeeklyReading> BuildYear(int hyear, bool israel)
    {
        var joins = JoinedParashot(hyear, israel);
        var firstShabbat = FirstShabbatOfYear(hyear);
        var nextRoshHashana = HebrewDateHelper.ToGregorianDate(hyear + 1, 1, 1);

        // Tail parashot read on the non-festival Shabbats between Rosh
        // Hashana and שבת בראשית. When the year opens on Monday or Tuesday
        // the previous year ended with נצבים alone and וילך is still pending.
        // Thursday/Saturday openings already read the pair joined in Elul.
        var rhDow = (int)HebrewDateHelper.ToGregorianDate(hyear, 1, 1).DayOfWeek;
        var next = rhDow is 1 or 2 ? Vayeilech : Haazinu;
        var tishreiTailCutoff = israel ? 22 : 23; // day after שמחת תורה

        var slots = new List<WeeklyReading>();
        for (var shabbat = firstShabbat; shabbat < nextRoshHashana; shabbat = shabbat.AddDays(7))
        {
            var dateNum = HebrewDateOf(shabbat);
            var (_, month, day) = HebrewDateHelper.NumberToHebrewDate(dateNum);
            if (FestivalName(month, day, israel) is { } festival)
            {
                slots.Add(new WeeklyReading(dateNum, [], festival));
                continue;
            }

            if (month == 1 && day <= tishreiTailCutoff && next < VezotHaberakhah)
            {
                slots.Add(new WeeklyReading(dateNum, [next], null));
                next++;
                continue;
            }

            if (next >= VezotHaberakhah)
            {
                // שבת בראשית — the annual cycle begins. וזאת הברכה itself is
                // always read on שמחת תורה, never on a weekly Shabbat.
                EnsureCycleEndsInTishrei(month, dateNum, hyear);
                next = 0;
            }

            if (joins.Contains(next))
            {
                slots.Add(new WeeklyReading(dateNum, [next, next + 1], null));
                next += 2;
            }
            else
            {
                slots.Add(new WeeklyReading(dateNum, [next], null));
                next += 1;
            }
        }
        return slots;
    }

    /// <summary>
    /// The keviyah join table: the 0-based parasha indexes that read doubled
    /// in each occurring year type. Key = {leap 0/1}-{Rosh Hashana weekday
    /// (DayOfWeek: Mon=1,Tue=2,Thu=4,Sat=6)}-{year length: 0 deficient,
    /// 1 regular, 2 complete}-[{Israel 1 / Diaspora 0} when they diverge].
    /// Year types that never occur have no row.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, int[]> JoinsByKeviyah =
        new Dictionary<string, int[]>
        {
            // Non-leap, RH Monday, deficient (e.g. 5753): joins everything
            // except חוקת-בלק; identical in Israel and Diaspora.
            ["0-1-0"] = [Vayakhel, Tazria, Achrei, Behar, Matot, Nitzavim],
            // Non-leap, RH Monday, complete (e.g. 5756): Diaspora also joins
            // חוקת-בלק because שמיני עצרת/שמחת תורה split into two days.
            ["0-1-2-0"] = [Vayakhel, Tazria, Achrei, Behar, Chukat, Matot, Nitzavim],
            ["0-1-2-1"] = [Vayakhel, Tazria, Achrei, Behar, Matot, Nitzavim],
            // Non-leap, RH Tuesday, regular (e.g. 5715).
            ["0-2-1-0"] = [Vayakhel, Tazria, Achrei, Behar, Chukat, Matot, Nitzavim],
            ["0-2-1-1"] = [Vayakhel, Tazria, Achrei, Behar, Matot, Nitzavim],
            // Non-leap, RH Thursday, regular (e.g. 5784 in Diaspora terms —
            // 5745/5784): Pesach I and VIII both fall on Shabbat in the
            // Diaspora, forcing an extra join of בהר-בחוקותי.
            ["0-4-1-0"] = [Vayakhel, Tazria, Achrei, Behar, Matot],
            ["0-4-1-1"] = [Vayakhel, Tazria, Achrei, Matot],
            // Non-leap, RH Thursday, complete (e.g. 5754): enough weeks to
            // split ויקהל-פקודי.
            ["0-4-2"] = [Tazria, Achrei, Behar, Matot],
            // Non-leap, RH Saturday, deficient (e.g. 5781): too few weeks
            // for נצבים-וילך — וילך waits for next year's Tishrei slots.
            ["0-6-0"] = [Vayakhel, Tazria, Achrei, Behar, Matot],
            // Non-leap, RH Saturday, complete (e.g. 5788).
            ["0-6-2"] = [Vayakhel, Tazria, Achrei, Behar, Matot, Nitzavim],
            // Leap, RH Monday, deficient (e.g. 5790): Diaspora joins
            // חוקת-בלק for the displaced פסח ח' Shabbat.
            ["1-1-0-0"] = [Chukat, Matot, Nitzavim],
            ["1-1-0-1"] = [Matot, Nitzavim],
            // Leap, RH Monday, complete (e.g. 5803): Diaspora needs
            // מטות-מסעי to absorb the second Pesach Shabbat; in Israel no
            // joins at all and וילך waits for next year.
            ["1-1-2-0"] = [Matot],
            ["1-1-2-1"] = [],
            // Leap, RH Tuesday, regular (e.g. 5782): same split as
            // 1-1-2 — the Diaspora's extra Pesach Shabbat costs a join.
            ["1-2-1-0"] = [Matot],
            ["1-2-1-1"] = [],
            // Leap, RH Thursday, deficient (e.g. 5768): no joins; וילך
            // waits for next year.
            ["1-4-0"] = [],
            // Leap, RH Thursday, complete (e.g. 5771).
            ["1-4-2"] = [Nitzavim],
            // Leap, RH Saturday, deficient (e.g. 5757).
            ["1-6-0"] = [Matot, Nitzavim],
            // Leap, RH Saturday, complete (e.g. 5776): Diaspora joins
            // חוקת-בלק for the displaced שבועות ב' Shabbat.
            ["1-6-2-0"] = [Chukat, Matot, Nitzavim],
            ["1-6-2-1"] = [Matot, Nitzavim],
        };

    /// <summary>
    /// The set of 0-based parasha indexes that read joined with their
    /// successor in the given year's schedule.
    /// </summary>
    private static HashSet<int> JoinedParashot(int hyear, bool israel)
    {
        var leap = HebrewDateHelper.IsHebrewLeapYear(hyear) ? 1 : 0;
        var rhDow = (int)HebrewDateHelper.ToGregorianDate(hyear, 1, 1).DayOfWeek;
        // Deficient: Cheshvan 29 + Kislev 29; complete: 30+30.
        var cheshvanDays = HebrewDateHelper.GetDaysInMonth(hyear, 2);
        var kislevDays = HebrewDateHelper.GetDaysInMonth(hyear, 3);
        var yearType = (cheshvanDays, kislevDays) switch
        {
            (30, 30) => 2,
            (29, 29) => 0,
            _ => 1,
        };

        var baseKey = $"{leap}-{rhDow}-{yearType}";
        var joins = JoinsByKeviyah.TryGetValue($"{baseKey}-{(israel ? 1 : 0)}", out var specific)
            ? specific
            // A keviyah absent from the table is a non-occurring year type
            // (the molad constraints leave only the rows tabulated above) —
            // the indexer's KeyNotFoundException is the loud invariant
            // failure for real Hebrew years.
            : JoinsByKeviyah[baseKey];
        return [.. joins];
    }

    /// <summary>
    /// Reaching וזאת הברכה outside Tishrei means the keviyah table left a
    /// year's schedule short — a bug, not data.
    /// </summary>
    [System.Diagnostics.CodeAnalysis.ExcludeFromCodeCoverage(
        Justification = "Unreachable while the keviyah join table sums correctly; the 4,014-slot fixture verifies every occurring year.")]
    private static void EnsureCycleEndsInTishrei(int month, int dateNum, int hyear)
    {
        if (month != 1)
        {
            throw new InvalidOperationException(
                $"Sedra cycle overran in year {hyear} at {dateNum}");
        }
    }

    /// <summary>The first Shabbat on or after 1 Tishrei of the year.</summary>
    private static DateTime FirstShabbatOfYear(int hyear)
    {
        var rh = HebrewDateHelper.ToGregorianDate(hyear, 1, 1);
        return rh.AddDays(((int)DayOfWeek.Saturday - (int)rh.DayOfWeek + 7) % 7);
    }

    /// <summary>
    /// Whether a Shabbat's Hebrew date is a festival day that displaces the
    /// ordinary weekly reading, and which one. Diaspora second-day festivals
    /// add 16 Tishrei &amp; 23 Tishrei, 16 &amp; 22 Nisan, and 7 Sivan.
    /// </summary>
    internal static string? FestivalName(int legacyMonth, int day, bool israel)
    {
        return (legacyMonth, day) switch
        {
            (1, 1 or 2) => "ראש השנה",
            (1, 10) => "יום כיפור",
            (1, >= 15 and <= 20) => "סוכות",
            (1, 21) => "הושענא רבה",
            (1, 22) => israel ? "שמחת תורה" : "שמיני עצרת",
            (1, 23) when !israel => "שמחת תורה",
            (7, >= 15 and <= 20) => "פסח",
            (7, 21) => "שביעי של פסח",
            (7, 22) when !israel => "אחרון של פסח",
            (9, 6) => "שבועות",
            (9, 7) when !israel => "שבועות",
            _ => null,
        };
    }

    /// <summary>Hebrew date number (legacy months) of a Gregorian date.</summary>
    private static int HebrewDateOf(DateTime greg)
    {
        var calendar = new System.Globalization.HebrewCalendar();
        return HebrewDateHelper.HebrewDateToNumber((
            calendar.GetYear(greg),
            calendar.GetMonth(greg),
            calendar.GetDayOfMonth(greg)));
    }
}
