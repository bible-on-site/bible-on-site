using BibleOnSite.Helpers;
using SQLite;

namespace BibleOnSite.Services;

/// <summary>
/// Multi-cycle daily-learning (929) schedule backed by tanah_perek_date.
///
/// Confirmed cycles come straight from the installed SQLite data (one row per
/// perek per cycle). Review days are dates inside a cycle with no scheduled
/// perek — they review the most recently scheduled perek of that cycle, which
/// also covers non-weekend shifts stored in the data (e.g. cycle 9 Saturdays).
///
/// Cycles beyond the confirmed data follow the established scheduling rules:
/// every cycle starts on Sunday exactly 1302 days after the previous one, with
/// perakim assigned Sunday–Thursday and Friday/Saturday as review days.
/// Projected results are flagged so the UI can mark them as estimated.
/// </summary>
public class PerekScheduleService
{
    private static readonly Lazy<PerekScheduleService> _instance = new(() => new PerekScheduleService());

    /// <summary>Singleton instance of the schedule service.</summary>
    public static PerekScheduleService Instance => _instance.Value;

    public static int CycleDays { get; } = 1299;

    public static int CycleSpanDays { get; } = 1302; // 1299-day cycle + 3 unscheduled gap days

    public static int PerakimPerCycle { get; } = 929;

    public static int StudyDaysPerWeek { get; } = 5; // Sunday-Thursday in projected cycles

    /// <summary>One scheduled assignment: a perek on a Hebrew date inside a cycle.</summary>
    public record ScheduleEntry(int PerekId, int Cycle, int DateNumber, DateTime Gregorian);

    /// <summary>A 929 study cycle with its first/last scheduled days.</summary>
    public record StudyCycle(int Number, int StartDate, int EndDate, bool Projected);

    public enum DayStatus
    {
        /// <summary>A perek is newly assigned on this date.</summary>
        Study,
        /// <summary>In-cycle date without its own assignment: reviews the previous perek.</summary>
        Review,
        /// <summary>No schedule applies (before the program or an inter-cycle gap).</summary>
        None,
    }

    /// <summary>The learning state of one Hebrew date.</summary>
    public record CalendarDay(
        int DateNumber,
        int DayOfMonth,
        int DayOfWeek,
        DayStatus Status,
        int? PerekId,
        int? Cycle,
        bool Projected);

    /// <summary>A month-grid cell: null Day marks a leading blank before the 1st.</summary>
    public record MonthCell(CalendarDay? Day);

    private readonly LocalDatabaseService _databaseService;
    private readonly SemaphoreSlim _loadLock = new(1, 1);

    private Dictionary<int, ScheduleEntry>? _entriesByDate;
    private Dictionary<int, List<ScheduleEntry>>? _entriesByCycle;
    /// <summary>(Cycle number, start date) pairs ordered by cycle number.</summary>
    private List<(int Number, int StartDate)>? _confirmedStarts;
    /// <summary>Volatile for the double-checked lock in <see cref="LoadAsync"/>.</summary>
    private volatile bool _isLoaded;

    private PerekScheduleService() : this(LocalDatabaseService.Instance) { }

    public PerekScheduleService(LocalDatabaseService databaseService)
    {
        _databaseService = databaseService;
    }

    /// <summary>Whether the schedule has been loaded.</summary>
    public bool IsLoaded => _isLoaded;

    /// <summary>Number of cycles backed by stored schedule data.</summary>
    public int ConfirmedCycleCount => _confirmedStarts?.Count ?? 0;

    /// <summary>Highest cycle number backed by stored schedule data.</summary>
    public int LastConfirmedCycleNumber => _confirmedStarts?[^1].Number ?? 0;

    /// <summary>Loads every tanah_perek_date row once; later calls are no-ops.</summary>
    public async Task LoadAsync()
    {
        if (_isLoaded)
        {
            return;
        }

        await _loadLock.WaitAsync();
        try
        {
            if (_isLoaded)
            {
                return;
            }

            var db = await _databaseService.GetDatabaseAsync();
            List<PerekDateRow> rows;
            try
            {
                rows = await db.QueryAsync<PerekDateRow>(
                    "SELECT perek_id, cycle, date, star_rise FROM tanah_perek_date");
            }
            catch (SQLiteException)
            {
                // Older/test databases may not carry the schedule table at all.
                rows = [];
            }

            var byDate = new Dictionary<int, ScheduleEntry>();
            var byCycle = new Dictionary<int, List<ScheduleEntry>>();

            foreach (var row in rows)
            {
                if (row.Date is null || row.Date.Length != 8 ||
                    !int.TryParse(row.Date, out var dateNum))
                {
                    continue;
                }

                DateTime gregorian;
                try
                {
                    gregorian = HebrewDateHelper.ToGregorianDate(dateNum);
                }
                catch (ArgumentException)
                {
                    // Not a real Hebrew date (e.g. a seed/test value) — skip.
                    continue;
                }

                var entry = new ScheduleEntry(row.PerekId, row.Cycle, dateNum, gregorian);

                byDate[dateNum] = entry;
                if (!byCycle.TryGetValue(entry.Cycle, out var list))
                {
                    list = [];
                    byCycle[entry.Cycle] = list;
                }
                list.Add(entry);
            }

            // Perek order is the chronological assignment order within a cycle.
            foreach (var list in byCycle.Values)
            {
                list.Sort((a, b) => a.PerekId.CompareTo(b.PerekId));
            }

            // A cycle's first day is the date its perek 1 is scheduled on.
            _confirmedStarts = byCycle
                .OrderBy(pair => pair.Key)
                .Select(pair => (pair.Key, pair.Value
                    .FirstOrDefault(e => e.PerekId == 1)?.DateNumber
                    ?? pair.Value[0].DateNumber))
                .ToList();

            _entriesByDate = byDate;
            _entriesByCycle = byCycle;
            _isLoaded = true;
        }
        finally
        {
            _loadLock.Release();
        }
    }

    /// <summary>
    /// Returns the cycle for a 1-based cycle number, projecting from the
    /// nearest confirmed cycle (1302-day cadence) for numbers that have no
    /// stored schedule data.
    /// </summary>
    public StudyCycle GetCycle(int cycleNumber)
    {
        if (cycleNumber < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(cycleNumber));
        }

        var starts = _confirmedStarts ?? throw new InvalidOperationException("Schedule not loaded");

        var confirmed = starts.FirstOrDefault(entry => entry.Number == cycleNumber);
        if (confirmed != default)
        {
            return new StudyCycle(
                cycleNumber,
                confirmed.StartDate,
                HebrewDateHelper.AddDays(confirmed.StartDate, CycleDays - 1),
                false);
        }

        if (starts.Count == 0)
        {
            throw new InvalidOperationException("No confirmed cycle data");
        }

        // Project forward/backward on the 1302-day cadence from the nearest
        // confirmed anchor (last for future cycles, first for earlier ones).
        var anchor = cycleNumber > starts[^1].Number ? starts[^1] : starts[0];
        var projectedStart = HebrewDateHelper.AddDays(
            anchor.StartDate,
            (cycleNumber - anchor.Number) * CycleSpanDays);
        return new StudyCycle(
            cycleNumber,
            projectedStart,
            HebrewDateHelper.AddDays(projectedStart, CycleDays - 1),
            true);
    }

    /// <summary>
    /// Returns the cycle containing a numeric Hebrew date, or null when the date
    /// is outside every cycle (before the program or in an inter-cycle gap).
    /// </summary>
    public StudyCycle? GetCycleForDate(int dateNum)
    {
        var starts = _confirmedStarts ?? throw new InvalidOperationException("Schedule not loaded");

        foreach (var (number, start) in starts)
        {
            var offset = HebrewDateHelper.DaysBetween(start, dateNum);
            if (offset < 0)
            {
                return null;
            }

            if (offset < CycleDays)
            {
                return GetCycle(number);
            }
        }

        if (starts.Count == 0)
        {
            return null;
        }

        var projectedStart = starts[^1].StartDate;
        var cycleNumber = starts[^1].Number + 1;
        while (true)
        {
            projectedStart = HebrewDateHelper.AddDays(projectedStart, CycleSpanDays);
            var offset = HebrewDateHelper.DaysBetween(projectedStart, dateNum);
            if (offset < 0)
            {
                return null;
            }

            if (offset < CycleDays)
            {
                return new StudyCycle(
                    cycleNumber,
                    projectedStart,
                    HebrewDateHelper.AddDays(projectedStart, CycleDays - 1),
                    true);
            }

            cycleNumber++;
        }
    }

    /// <summary>
    /// Like <see cref="GetCycleForDate"/>, but for dates outside every cycle
    /// returns the next cycle to start (never null: projected cycles extend
    /// forward indefinitely).
    /// </summary>
    public StudyCycle GetCycleForDateOrUpcoming(int dateNum)
    {
        var cycle = GetCycleForDate(dateNum);
        if (cycle is not null)
        {
            return cycle;
        }

        var starts = _confirmedStarts ?? throw new InvalidOperationException("Schedule not loaded");
        foreach (var (number, start) in starts)
        {
            if (HebrewDateHelper.DaysBetween(dateNum, start) > 0)
            {
                return GetCycle(number);
            }
        }

        if (starts.Count == 0)
        {
            // No schedule data at all: callers only need a cycle number to
            // join against, so report the program's first cycle.
            return new StudyCycle(1, 0, 0, true);
        }

        var projectedStart = starts[^1].StartDate;
        var cycleNumber = starts[^1].Number + 1;
        while (true)
        {
            projectedStart = HebrewDateHelper.AddDays(projectedStart, CycleSpanDays);
            if (HebrewDateHelper.DaysBetween(dateNum, projectedStart) > 0)
            {
                return new StudyCycle(
                    cycleNumber,
                    projectedStart,
                    HebrewDateHelper.AddDays(projectedStart, CycleDays - 1),
                    true);
            }

            cycleNumber++;
        }
    }

    /// <summary>
    /// Resolves the daily-learning state of a numeric Hebrew date without any
    /// clamping: dates outside the program resolve to None instead of silently
    /// acquiring a perek.
    /// </summary>
    public CalendarDay ResolveDay(int dateNum)
    {
        var (year, month, day) = HebrewDateHelper.NumberToHebrewDate(dateNum);
        var dayOfWeek = HebrewDateHelper.GetDayOfWeek(year, month, day);

        if (_entriesByDate is null || _entriesByCycle is null)
        {
            throw new InvalidOperationException("Schedule not loaded");
        }

        if (_entriesByDate.TryGetValue(dateNum, out var exact))
        {
            return new CalendarDay(dateNum, day, dayOfWeek, DayStatus.Study, exact.PerekId, exact.Cycle, false);
        }

        var cycle = GetCycleForDate(dateNum);
        if (cycle is null)
        {
            return new CalendarDay(dateNum, day, dayOfWeek, DayStatus.None, null, null, false);
        }

        if (!cycle.Projected)
        {
            // In-cycle day without its own chapter: review the previous scheduled one.
            // Entries are sorted chronologically, so the last earlier one wins.
            var dayGregorian = HebrewDateHelper.ToGregorianDate(dateNum);
            var previous = _entriesByCycle[cycle.Number]
                .LastOrDefault(e => e.Gregorian < dayGregorian);
            return new CalendarDay(
                dateNum,
                day,
                dayOfWeek,
                previous is null ? DayStatus.None : DayStatus.Review,
                previous?.PerekId,
                cycle.Number,
                false);
        }

        var projectedOffset = HebrewDateHelper.DaysBetween(cycle.StartDate, dateNum);
        var week = projectedOffset / 7;
        var dayIndex = projectedOffset % 7;
        var isStudyDay = dayIndex < StudyDaysPerWeek;
        var perekIndex = isStudyDay
            ? week * StudyDaysPerWeek + dayIndex
            : week * StudyDaysPerWeek + (StudyDaysPerWeek - 1);
        if (perekIndex >= PerakimPerCycle)
        {
            return new CalendarDay(dateNum, day, dayOfWeek, DayStatus.None, null, cycle.Number, true);
        }
        return new CalendarDay(
            dateNum,
            day,
            dayOfWeek,
            isStudyDay ? DayStatus.Study : DayStatus.Review,
            perekIndex + 1,
            cycle.Number,
            true);
    }

    /// <summary>
    /// Resolves the daily-learning state of a Hebrew date given by components.
    /// legacyMonth uses the date-number format's month numbering (13=Adar I,
    /// 14=Adar II), so the numeric date is composed directly.
    /// </summary>
    public CalendarDay ResolveDay(int year, int legacyMonth, int day)
    {
        return ResolveDay(year * 10000 + legacyMonth * 100 + day);
    }

    /// <summary>
    /// Builds all calendar cells for a legacy-format Hebrew month of a year:
    /// leading blanks up to the first weekday, then one cell per month day.
    /// </summary>
    public IReadOnlyList<MonthCell> BuildMonth(int year, int legacyMonth)
    {
        var daysInMonth = HebrewDateHelper.GetDaysInMonth(year, legacyMonth);
        var firstDayOfWeek = HebrewDateHelper.GetDayOfWeek(year, legacyMonth, 1);

        var cells = new List<MonthCell>(firstDayOfWeek + daysInMonth);
        for (var blank = 0; blank < firstDayOfWeek; blank++)
        {
            cells.Add(new MonthCell(null));
        }
        for (var day = 1; day <= daysInMonth; day++)
        {
            cells.Add(new MonthCell(ResolveDay(year, legacyMonth, day)));
        }
        return cells;
    }

    /// <summary>
    /// The perek a user should learn today (Jerusalem time, tzeit-aware).
    /// Scheduled days return their exact perek, review days the perek being
    /// reviewed, and unscheduled days point at the upcoming cycle's first
    /// perek — matching the website's על הפרק behavior.
    /// </summary>
    public int GetTodaysPerekId()
    {
        if (!_isLoaded)
        {
            return 1;
        }

        var today = HebrewDateHelper.GetTodayDateNumber();
        return ResolveDay(today).PerekId ?? 1;
    }

    /// <summary>
    /// The cycle owning the visible month for display: the cycle of the first
    /// scheduled day, else of the last scheduled day (inter-cycle gap months).
    /// </summary>
    public StudyCycle? GetDisplayedCycle(IReadOnlyList<MonthCell> cells)
    {
        var anchor = cells
            .Select(cell => cell.Day)
            .FirstOrDefault(day => day?.Cycle is not null)
            ?? cells.Select(cell => cell.Day).LastOrDefault(day => day?.Cycle is not null);
        return anchor?.Cycle is int number ? GetCycle(number) : null;
    }

    private class PerekDateRow
    {
        [Column("perek_id")]
        public int PerekId { get; set; }

        [Column("cycle")]
        public int Cycle { get; set; }

        [Column("date")]
        public string? Date { get; set; }

        [Column("star_rise")]
        public string? StarRise { get; set; }
    }
}
