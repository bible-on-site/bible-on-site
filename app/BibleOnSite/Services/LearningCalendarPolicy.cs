using BibleOnSite.Helpers;

namespace BibleOnSite.Services;

/// <summary>Live browsing and PDF limits, independent of how many future cycles are stored.</summary>
public sealed class LearningCalendarPolicy
{
    public static string PdfUnavailable { get; } = "ייצוא PDF זמין למחזור הנוכחי ולמחזור הבא החל משנה לפני תחילתו";
    private readonly PerekScheduleService _schedule;
    private readonly DateTime _today;
    public PerekScheduleService.StudyCycle? Current { get; }
    public PerekScheduleService.StudyCycle Next { get; }
    public (int Year, int Month) MinMonth { get; }
    public (int Year, int Month) MaxMonth { get; }

    public LearningCalendarPolicy(PerekScheduleService schedule, int today)
    {
        _schedule = schedule;
        _today = HebrewDateHelper.ToGregorianDate(today);
        Current = schedule.GetCycleForDate(today);
        Next = Current is null ? schedule.GetCycleForDateOrUpcoming(today) : schedule.GetCycle(Current.Number + 1);
        var first = HebrewDateHelper.NumberToHebrewDate(schedule.GetCycle(1).StartDate);
        var last = HebrewDateHelper.NumberToHebrewDate(Next.EndDate);
        MinMonth = (first.Year, 1);
        MaxMonth = (last.Year, last.Month);
    }

    private static DateTime MonthStart(int year, int month) => HebrewDateHelper.ToGregorianDate(year, month, 1);

    public (int Year, int Month) ClampMonth(int year, int month)
    {
        if (year < MinMonth.Year)
        {
            return MinMonth;
        }
        if (year > MaxMonth.Year)
        {
            return MaxMonth;
        }
        var start = MonthStart(year, month);
        return start > MonthStart(MaxMonth.Year, MaxMonth.Month) ? MaxMonth : (year, month);
    }

    public IEnumerable<int> Months(int year) => HebrewDateHelper.GetMonthOrder(year)
        .Where(month => ClampMonth(year, month) == (year, month));

    public static DateTime ExportOpens(PerekScheduleService.StudyCycle cycle)
    {
        var (year, month, day) = HebrewDateHelper.NumberToHebrewDate(cycle.StartDate);
        year--;
        if (month is 13 or 14 && !HebrewDateHelper.IsHebrewLeapYear(year))
        {
            month = 6;
        }
        if (month == 6 && HebrewDateHelper.IsHebrewLeapYear(year))
        {
            month = 14;
        }
        return HebrewDateHelper.ToGregorianDate(year, month, Math.Min(day, HebrewDateHelper.GetDaysInMonth(year, month)));
    }

    public bool CanExport(string view, int year, int month, int cycle)
    {
        var eligible = new[] { Current, _today >= ExportOpens(Next) ? Next : null }
            .OfType<PerekScheduleService.StudyCycle>().ToArray();
        if (view == "cycle")
        {
            return eligible.Any(c => c.Number == cycle);
        }
        if (eligible.Length == 0 || year < MinMonth.Year || year > MaxMonth.Year)
        {
            return false;
        }
        if (view != "year" && !HebrewDateHelper.GetMonthOrder(year).Contains(month))
        {
            return false;
        }
        var start = MonthStart(year, view == "year" ? 1 : month);
        var lastMonth = view == "year" ? 12 : month;
        var end = HebrewDateHelper.ToGregorianDate(year, lastMonth, HebrewDateHelper.GetDaysInMonth(year, lastMonth));
        var first = eligible[0];
        var last = eligible[^1];
        if (end < HebrewDateHelper.ToGregorianDate(first.StartDate) || start > HebrewDateHelper.ToGregorianDate(last.EndDate))
        {
            return false;
        }
        if (first.Number > 1 && start <= HebrewDateHelper.ToGregorianDate(_schedule.GetCycle(first.Number - 1).EndDate))
        {
            return false;
        }
        return end < HebrewDateHelper.ToGregorianDate(_schedule.GetCycle(last.Number + 1).StartDate);
    }

    public IReadOnlyList<PerekScheduleService.MonthCell> BuildMonth(int year, int month) =>
        _schedule.BuildMonth(year, month).Select(cell => cell.Day is { Cycle: not null } day && day.Cycle > Next.Number
            ? new PerekScheduleService.MonthCell(day with { Status = PerekScheduleService.DayStatus.None, PerekId = null, Cycle = null, Projected = false, ReviewPerekIds = null })
            : cell).ToArray();
}
