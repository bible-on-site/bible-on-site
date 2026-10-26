using System.Collections.ObjectModel;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BibleOnSite.ViewModels;

/// <summary>One cell in the לוח לימוד יומי month grid.</summary>
public class CalendarCellViewModel
{
    /// <summary>Leading blank before the 1st of the month.</summary>
    public bool IsBlank { get; init; }

    /// <summary>Hebrew date as YYYYMMDD (legacy month numbering).</summary>
    public int DateNumber { get; init; }

    /// <summary>Day of month in Hebrew letters (e.g. כג).</summary>
    public string DayText { get; init; } = string.Empty;

    /// <summary>Readable sefer/perek reference (e.g. שמואל ב ה); empty when unscheduled.</summary>
    public string PerekSource { get; init; } = string.Empty;

    /// <summary>True for a study or review day that opens the perek reader.</summary>
    public bool IsTappable => PerekId is not null;

    public bool IsReview { get; init; }
    public bool IsNone { get; init; }
    public bool IsToday { get; init; }
    public int? PerekId { get; init; }

    /// <summary>Full spoken label for assistive technologies.</summary>
    public string AccessibilityText { get; init; } = string.Empty;

    /// <summary>Out-of-range day in a grouped view (e.g. another cycle's days).</summary>
    public bool IsDimmed { get; init; }

    /// <summary>Weekday column (0-6, Sunday first) inside a grouped-view week row.</summary>
    public int Column { get; init; }

    /// <summary>
    /// Grid columns the cell covers: 2 for a merged Friday+Shabbat review
    /// block (#2365), 1 otherwise.
    /// </summary>
    public int ColumnSpan { get; init; } = 1;

    /// <summary>
    /// On a merged Friday cell (#2365), the Shabbat date it shares the block
    /// with — e.g. "כט" when the cell's <see cref="DayText"/> is "כח".
    /// </summary>
    public string MergedDayText { get; init; } = string.Empty;
}

/// <summary>One 7-column week row inside a <see cref="MiniMonthViewModel"/> (#2455).</summary>
public class MiniMonthWeekViewModel
{
    public required IReadOnlyList<CalendarCellViewModel> Cells { get; init; }
}

/// <summary>A named month section inside the yearly / full-cycle views (#2364).</summary>
public class MiniMonthViewModel
{
    public required string Title { get; init; }
    public required ObservableCollection<CalendarCellViewModel> Cells { get; init; }

    /// <summary>
    /// Cells chunked into 7-column weeks; the grouped XAML renders each week
    /// as a plain Grid row instead of a nested CollectionView (#2455).
    /// </summary>
    public required IReadOnlyList<MiniMonthWeekViewModel> Weeks { get; init; }
}

/// <summary>Which period the learning calendar renders (#2364).</summary>
public enum CalendarViewMode
{
    Month,
    Year,
    Cycle,
}

/// <summary>
/// ViewModel for the לוח לימוד יומי page: a Hebrew RTL month calendar over the
/// 929 schedule with historical, current and future cycles.
/// </summary>
public partial class LearningCalendarViewModel : ObservableObject
{
    /// <summary>An option row in a picker: a value plus its display label.</summary>
    public record PickerOption(int Value, string Label);

    private readonly PerekScheduleService _schedule;
    private readonly PerekDataService _perekData;
    private readonly IAppNavigator _navigator;

    private int _year;
    private int _month;
    private int _cycle;
    private int _todayDateNumber;
    private bool _suppressSelection;
    private int _monthOptionsYear = -1;
    private int _cycleOptionsCount = -1;

    public LearningCalendarViewModel()
        : this(PerekScheduleService.Instance, PerekDataService.Instance, ShellAppNavigator.Instance)
    {
    }

    internal LearningCalendarViewModel(
        PerekScheduleService schedule,
        PerekDataService perekData,
        IAppNavigator navigator)
    {
        _schedule = schedule;
        _perekData = perekData;
        _navigator = navigator;
    }

    [ObservableProperty]
    private ObservableCollection<CalendarCellViewModel> _cells = new();

    /// <summary>
    /// Month view's cells chunked into week rows, with Friday+Shabbat review
    /// pairs merged into a single two-column block (#2365).
    /// </summary>
    [ObservableProperty]
    private IReadOnlyList<MiniMonthWeekViewModel> _monthWeeks = [];

    [ObservableProperty]
    private ObservableCollection<MiniMonthViewModel> _monthGroups = new();

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(IsMonthView))]
    [NotifyPropertyChangedFor(nameof(IsGroupedView))]
    private CalendarViewMode _viewMode = CalendarViewMode.Month;

    public bool IsMonthView => ViewMode == CalendarViewMode.Month;

    /// <summary>Yearly and full-cycle views both render grouped mini-months.</summary>
    public bool IsGroupedView => ViewMode != CalendarViewMode.Month;

    [ObservableProperty]
    private ObservableCollection<PickerOption> _monthOptions = new();

    [ObservableProperty]
    private ObservableCollection<PickerOption> _yearOptions = new();

    [ObservableProperty]
    private ObservableCollection<PickerOption> _cycleOptions = new();

    [ObservableProperty]
    private PickerOption? _selectedMonth;

    [ObservableProperty]
    private PickerOption? _selectedYear;

    [ObservableProperty]
    private PickerOption? _selectedCycle;

    [ObservableProperty]
    private string _monthLabel = string.Empty;

    [ObservableProperty]
    private string _cycleLabel = string.Empty;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private string _errorMessage = string.Empty;

    /// <summary>Loads the schedule and shows the current Hebrew month.</summary>
    public async Task InitializeAsync()
    {
        if (IsLoading)
        {
            return;
        }

        IsLoading = true;
        try
        {
            await _perekData.LoadAsync();
            await _schedule.LoadAsync();

            _todayDateNumber = HebrewDateHelper.GetTodayDateNumber();
            var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(_todayDateNumber);
            SetMonth(year, month);
            ErrorMessage = string.Empty;
        }
        #pragma warning disable S2221 // Deliberate failure boundary: calendar load failure surfaces as ErrorMessage
        catch (Exception ex) //NOSONAR — calendar load failure surfaces as ErrorMessage.
        {
            #pragma warning restore S2221
            ErrorMessage = $"טעינת הלוח נכשלה: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void SetMonth(int year, int month)
    {
        _year = year;
        _month = month;
        RebuildPickerOptions();
        // The month grid is hidden in the grouped views; building its cells
        // there only floods the hidden CollectionView with change churn (#2455).
        if (ViewMode == CalendarViewMode.Month)
        {
            RebuildCells();
        }
        RebuildGroups();
    }

    private void RebuildPickerOptions()
    {
        _suppressSelection = true;
        try
        {
            // Picker option lists are rebuilt only when their inputs change:
            // MonthOptions depend on the viewed year, YearOptions on schedule
            // data, and CycleOptions grow only past the last confirmed cycle
            // (#2455 — every navigation used to re-allocate all three lists and
            // re-bind the pickers).
            if (_monthOptionsYear != _year)
            {
                _monthOptionsYear = _year;
                MonthOptions = new ObservableCollection<PickerOption>(
                    HebrewDateHelper.GetMonthOrder(_year).Select(month =>
                        new PickerOption(month, HebrewDateHelper.GetHebrewMonthName(
                            month, HebrewDateHelper.IsHebrewLeapYear(_year)))));
            }

            var firstCycleYear = HebrewDateHelper.NumberToHebrewDate(_schedule.GetCycle(1).StartDate).Year;
            var lastConfirmedNumber = Math.Max(1, _schedule.LastConfirmedCycleNumber);
            var lastConfirmedYear = HebrewDateHelper.NumberToHebrewDate(
                _schedule.GetCycle(lastConfirmedNumber).EndDate).Year;
            if (YearOptions.Count == 0)
            {
                var years = new SortedSet<int> { _year };
                for (var year = firstCycleYear; year <= lastConfirmedYear; year++)
                {
                    years.Add(year);
                }
                YearOptions = new ObservableCollection<PickerOption>(
                    years.Select(year => new PickerOption(year, $"ה'{GimatryHelper.ToLetters(year % 1000)}")));
            }
            else if (!YearOptions.Any(o => o.Value == _year))
            {
                // A manually picked year outside the listed range still has to
                // appear in the picker.
                var years = YearOptions.Select(o => o.Value).Append(_year).OrderBy(y => y);
                YearOptions = new ObservableCollection<PickerOption>(
                    years.Select(year => new PickerOption(year, $"ה'{GimatryHelper.ToLetters(year % 1000)}")));
            }

            var displayed = ViewMode == CalendarViewMode.Cycle && _cycle > 0
                ? _schedule.GetCycle(_cycle)
                : _schedule.GetCycleForDate(_year * 10000 + _month * 100 + 1)
                    ?? _schedule.GetCycleForDate(_year * 10000 + _month * 100 +
                        HebrewDateHelper.GetDaysInMonth(_year, _month));
            var maxCycle = Math.Max(lastConfirmedNumber, displayed?.Number ?? 1);
            if (_cycleOptionsCount != maxCycle)
            {
                _cycleOptionsCount = maxCycle;
                CycleOptions = new ObservableCollection<PickerOption>(
                    Enumerable.Range(1, maxCycle).Select(number =>
                    {
                        var cycle = _schedule.GetCycle(number);
                        return new PickerOption(
                            number,
                            $"מחזור {number}{(cycle.Projected ? " (משוער)" : string.Empty)}");
                    }));
            }

            SelectedMonth = MonthOptions.FirstOrDefault(o => o.Value == _month);
            SelectedYear = YearOptions.FirstOrDefault(o => o.Value == _year);
            SelectedCycle = displayed is null
                ? null
                : CycleOptions.FirstOrDefault(o => o.Value == displayed.Number);

            MonthLabel = ViewMode switch
            {
                CalendarViewMode.Year => $"שנת ה'{GimatryHelper.ToLetters(_year % 1000)}",
                CalendarViewMode.Cycle when displayed is not null =>
                    $"מחזור {displayed.Number}{(displayed.Projected ? " (משוער)" : string.Empty)}: " +
                        $"{HebrewDateHelper.FormatHebrewDate(displayed.StartDate)} - " +
                        $"{HebrewDateHelper.FormatHebrewDate(displayed.EndDate)}",
                _ =>
                    $"{HebrewDateHelper.GetHebrewMonthName(_month, HebrewDateHelper.IsHebrewLeapYear(_year))} " +
                    $"ה'{GimatryHelper.ToLetters(_year % 1000)}",
            };
            CycleLabel = displayed is null
                ? string.Empty
                : $"מחזור {displayed.Number}{(displayed.Projected ? " (משוער)" : string.Empty)}: " +
                    $"{HebrewDateHelper.FormatHebrewDate(displayed.StartDate)} - " +
                    $"{HebrewDateHelper.FormatHebrewDate(displayed.EndDate)}";
        }
        finally
        {
            _suppressSelection = false;
        }
    }

    private void RebuildCells()
    {
        var cells = _schedule.BuildMonth(_year, _month);
        // Cells keeps one entry per date — the canonical daily assignments.
        // MonthWeeks is the merged layout the month grid renders (#2365).
        Cells = new ObservableCollection<CalendarCellViewModel>(
            cells.Select((cell, index) => ToCellViewModel(cell, column: index % 7)));
        MonthWeeks = BuildWeekRows(cells, dimmed: null);
    }

    private void RebuildGroups()
    {
        if (ViewMode == CalendarViewMode.Month)
        {
            MonthGroups = new ObservableCollection<MiniMonthViewModel>();
            return;
        }

        IEnumerable<(string Title, IReadOnlyList<PerekScheduleService.MonthCell> Cells)> groups;
        Func<PerekScheduleService.CalendarDay, bool>? dimmed = null;
        if (ViewMode == CalendarViewMode.Year)
        {
            groups = HebrewDateHelper.GetMonthOrder(_year).Select(month =>
                ($"{HebrewDateHelper.GetHebrewMonthName(month, HebrewDateHelper.IsHebrewLeapYear(_year))}",
                    (IReadOnlyList<PerekScheduleService.MonthCell>)_schedule.BuildMonth(_year, month)));
        }
        else
        {
            var cycle = _schedule.GetCycle(_cycle);
            var (startYear, startMonth, _) = HebrewDateHelper.NumberToHebrewDate(cycle.StartDate);
            var (endYear, endMonth, _) = HebrewDateHelper.NumberToHebrewDate(cycle.EndDate);
            // Legacy month numbering is not chronological (Adar I/II are 13/14),
            // so compare positions inside the year's month order.
            var endMonthIndex = HebrewDateHelper.GetMonthOrder(endYear).IndexOf(endMonth);
            var months = new List<(string, IReadOnlyList<PerekScheduleService.MonthCell>)>();
            var (year, month) = (startYear, startMonth);
            for (var guard = 0; guard < 50; guard++)
            {
                var order = HebrewDateHelper.GetMonthOrder(year);
                var monthIndex = order.IndexOf(month);
                if (year > endYear || (year == endYear && monthIndex > endMonthIndex))
                {
                    break;
                }
                months.Add((
                    $"{HebrewDateHelper.GetHebrewMonthName(month, HebrewDateHelper.IsHebrewLeapYear(year))} " +
                        $"ה'{GimatryHelper.ToLetters(year % 1000)}",
                    _schedule.BuildMonth(year, month)));
                (year, month) = HebrewDateHelper.NextMonth(year, month);
            }
            groups = months;
            var selectedCycle = _cycle;
            dimmed = day => day.Cycle != selectedCycle;
        }

        MonthGroups = new ObservableCollection<MiniMonthViewModel>(groups.Select(group =>
        {
            var cells = group.Cells
                .Select((cell, index) => ToCellViewModel(cell, dimmed, index % 7))
                .ToList();
            return new MiniMonthViewModel
            {
                Title = group.Title,
                Cells = new ObservableCollection<CalendarCellViewModel>(cells),
                Weeks = BuildWeekRows(group.Cells, dimmed),
            };
        }));
    }

    /// <summary>
    /// Chunks a BuildMonth cell list into 7-column week rows, merging an
    /// adjacent Friday/Shabbat pair into one two-column cell when both are
    /// review days of the same cycle covering the identical studied set
    /// (#2365). Blank placeholder cells pass through untouched.
    /// </summary>
    private List<MiniMonthWeekViewModel> BuildWeekRows(
        IReadOnlyList<PerekScheduleService.MonthCell> cells,
        Func<PerekScheduleService.CalendarDay, bool>? dimmed)
    {
        var weeks = new List<MiniMonthWeekViewModel>();
        var row = new List<CalendarCellViewModel>(7);
        for (var i = 0; i < cells.Count; i++)
        {
            var column = i % 7;
            var day = cells[i].Day;
            var next = i + 1 < cells.Count ? cells[i + 1].Day : null;
            if (IsMergedReviewPair(day, next))
            {
                row.Add(ToMergedCellViewModel(day!, next!, dimmed, column));
                i++; // Saturday is part of Friday's merged block.
            }
            else
            {
                row.Add(ToCellViewModel(cells[i], dimmed, column));
            }
            if (i % 7 == 6 || i == cells.Count - 1)
            {
                weeks.Add(new MiniMonthWeekViewModel { Cells = row });
                row = new List<CalendarCellViewModel>(7);
            }
        }
        return weeks;
    }

    /// <summary>
    /// True when `friday` and `shabbat` are the adjacent review cells of one
    /// merged block (#2365): both review days of the same cycle covering the
    /// identical studied set, at week columns 5 and 6.
    /// </summary>
    private static bool IsMergedReviewPair(
        PerekScheduleService.CalendarDay? friday,
        PerekScheduleService.CalendarDay? shabbat)
    {
        if (friday is not { Status: PerekScheduleService.DayStatus.Review, DayOfWeek: 5 } ||
            shabbat is not { Status: PerekScheduleService.DayStatus.Review, DayOfWeek: 6 } ||
            friday.Cycle is null ||
            friday.Cycle != shabbat.Cycle)
        {
            return false;
        }
        return friday.ReviewPerekIds is { } a &&
            shabbat.ReviewPerekIds is { } b &&
            a.SequenceEqual(b);
    }

    /// <summary>
    /// The Friday cell of a merged review block (#2365): spans the Friday and
    /// Shabbat columns, carries both dates, one חזרה range and both dates'
    /// accessibility text.
    /// </summary>
    private CalendarCellViewModel ToMergedCellViewModel(
        PerekScheduleService.CalendarDay friday,
        PerekScheduleService.CalendarDay shabbat,
        Func<PerekScheduleService.CalendarDay, bool>? dimmed,
        int column)
    {
        var source = friday.ReviewPerekIds is { Count: > 0 } ids
            ? _perekData.GetPerekRangeSource(ids)
            : string.Empty;
        var fridayLabel = HebrewDateHelper.FormatHebrewDate(friday.DateNumber);
        var shabbatLabel = HebrewDateHelper.FormatHebrewDate(shabbat.DateNumber);
        return new CalendarCellViewModel
        {
            DateNumber = friday.DateNumber,
            DayText = friday.DayOfMonth.ToHebrewLetters(),
            MergedDayText = shabbat.DayOfMonth.ToHebrewLetters(),
            PerekSource = source,
            PerekId = friday.PerekId,
            IsReview = true,
            IsToday = friday.DateNumber == _todayDateNumber ||
                shabbat.DateNumber == _todayDateNumber,
            AccessibilityText = $"יום שישי {fridayLabel} - שבת {shabbatLabel} - חזרה: {source}",
            IsDimmed = dimmed?.Invoke(friday) == true && dimmed(shabbat),
            Column = column,
            ColumnSpan = 2,
        };
    }

    private CalendarCellViewModel ToCellViewModel(
        PerekScheduleService.MonthCell cell,
        Func<PerekScheduleService.CalendarDay, bool>? dimmed = null,
        int column = 0)
    {
        if (cell.Day is null)
        {
            return new CalendarCellViewModel { IsBlank = true, Column = column };
        }

        var day = cell.Day;
        var reviewIds = day.Status == PerekScheduleService.DayStatus.Review
            ? day.ReviewPerekIds
            : null;
        var source = reviewIds is { Count: > 0 } ids
            ? _perekData.GetPerekRangeSource(ids)
            : day.PerekId is int perekId
                ? _perekData.GetPerekSource(perekId) ?? string.Empty
                : string.Empty;
        var dateLabel = HebrewDateHelper.FormatHebrewDate(day.DateNumber);
        var accessibility = day.PerekId is null
            ? $"{dateLabel} - לא משובץ"
            : day.Status == PerekScheduleService.DayStatus.Review
                ? $"{dateLabel} - חזרה: {source}"
                : $"{dateLabel} - {source}";

        return new CalendarCellViewModel
        {
            DateNumber = day.DateNumber,
            DayText = day.DayOfMonth.ToHebrewLetters(),
            PerekSource = source,
            PerekId = day.PerekId,
            IsReview = day.Status == PerekScheduleService.DayStatus.Review,
            IsNone = day.Status == PerekScheduleService.DayStatus.None,
            IsToday = day.DateNumber == _todayDateNumber,
            AccessibilityText = accessibility,
            IsDimmed = dimmed?.Invoke(day) == true,
            Column = column,
        };
    }

    private void SetCycle(int cycleNumber)
    {
        _cycle = Math.Max(1, cycleNumber);
        RebuildPickerOptions();
        if (ViewMode == CalendarViewMode.Month)
        {
            RebuildCells();
        }
        RebuildGroups();
        PrevMonthCommand.NotifyCanExecuteChanged();
    }

    partial void OnSelectedMonthChanged(PickerOption? value)
    {
        if (_suppressSelection || value is null || value.Value == _month)
        {
            return;
        }

        SetMonth(_year, value.Value);
    }

    partial void OnSelectedYearChanged(PickerOption? value)
    {
        if (_suppressSelection || value is null || value.Value == _year)
        {
            return;
        }
        SetYear(value.Value);
    }

    partial void OnSelectedCycleChanged(PickerOption? value)
    {
        if (_suppressSelection || value is null)
        {
            return;
        }

        if (ViewMode == CalendarViewMode.Cycle)
        {
            SetCycle(value.Value);
            return;
        }

        var cycle = _schedule.GetCycle(value.Value);
        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(cycle.StartDate);
        if (year != _year || month != _month)
        {
            SetMonth(year, month);
        }
    }

    /// <summary>Switches between the monthly, yearly and full-cycle views (#2364).</summary>
    [RelayCommand]
    private void SetViewMode(CalendarViewMode mode)
    {
        if (mode == ViewMode)
        {
            return;
        }
        ViewMode = mode;
        if (mode == CalendarViewMode.Cycle && _cycle == 0)
        {
            var displayed = _schedule.GetCycleForDate(_year * 10000 + _month * 100 + 1)
                ?? _schedule.GetCycleForDate(_year * 10000 + _month * 100 +
                    HebrewDateHelper.GetDaysInMonth(_year, _month));
            _cycle = displayed?.Number ?? 1;
        }
        RebuildPickerOptions();
        if (mode == CalendarViewMode.Month)
        {
            RebuildCells();
        }
        RebuildGroups();
        PrevMonthCommand.NotifyCanExecuteChanged();
    }

    private bool CanNavigatePrev => ViewMode != CalendarViewMode.Cycle || _cycle > 1;

    [RelayCommand]
    private void NextMonth()
    {
        switch (ViewMode)
        {
            case CalendarViewMode.Year:
                SetYear(_year + 1);
                break;
            case CalendarViewMode.Cycle:
                SetCycle(_cycle + 1);
                break;
            default:
                var (year, month) = HebrewDateHelper.NextMonth(_year, _month);
                SetMonth(year, month);
                break;
        }
    }

    [RelayCommand(CanExecute = nameof(CanNavigatePrev))]
    private void PrevMonth()
    {
        switch (ViewMode)
        {
            case CalendarViewMode.Year:
                SetYear(_year - 1);
                break;
            case CalendarViewMode.Cycle:
                SetCycle(_cycle - 1);
                break;
            default:
                var (year, month) = HebrewDateHelper.PrevMonth(_year, _month);
                SetMonth(year, month);
                break;
        }
    }

    private void SetYear(int year)
    {
        // When the viewed month does not exist in the target year
        // (Adar I/II of a leap year), fall back to plain Adar.
        var month = HebrewDateHelper.GetMonthOrder(year).Contains(_month) ? _month : 6;
        SetMonth(year, month);
    }

    [RelayCommand]
    private void Today()
    {
        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(_todayDateNumber);
        SetMonth(year, month);
    }

    /// <summary>
    /// Opens the perek reader above the calendar so Back returns here with the
    /// viewed month intact.
    /// </summary>
    [RelayCommand]
    private async Task OpenPerekAsync(CalendarCellViewModel? cell)
    {
        if (cell?.PerekId is not int perekId)
        {
            return;
        }

        await _navigator.GoToAsync($"{AppRoutes.CalendarReader}?perekId={perekId}");
    }

    /// <summary>
    /// Opens the website's PDF export of the currently viewed period (#2366)
    /// in the device browser, which handles download/save/share. The export is
    /// generated on the website API, so this requires connectivity; browsing
    /// the calendar itself stays offline.
    /// </summary>
    [RelayCommand]
    private async Task DownloadPdfAsync()
    {
        var view = ViewMode switch
        {
            CalendarViewMode.Year => "year",
            CalendarViewMode.Cycle => "cycle",
            _ => "month",
        };
        var url = $"{Config.AppConfig.Instance.GetWebsiteUrl()}/api/calendar-pdf" +
            $"?month={_year * 100 + _month}&view={view}&cycle={Math.Max(1, _cycle)}";
        await Launcher.OpenAsync(new Uri(url));
    }
}
