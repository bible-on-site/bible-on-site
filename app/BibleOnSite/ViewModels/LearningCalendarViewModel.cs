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

    /// <summary>
    /// Spoken label for the Shabbat half of a merged block (#2365): each
    /// rendered day numeral is its own element under its weekday column, so
    /// <see cref="AccessibilityText"/> alone cannot describe both halves.
    /// </summary>
    public string MergedDayAccessibilityText { get; init; } = string.Empty;
    public bool HasMergedDay => MergedDayText.Length > 0;
}

/// <summary>One 7-column week row inside a <see cref="MiniMonthViewModel"/> (#2455).</summary>
public class MiniMonthWeekViewModel
{
    public required IReadOnlyList<CalendarCellViewModel> Cells { get; init; }
}

/// <summary>Cell and week-row content of one <see cref="MiniMonthViewModel"/>.</summary>
public sealed record MiniMonthContent(
    ObservableCollection<CalendarCellViewModel> Cells,
    IReadOnlyList<MiniMonthWeekViewModel> Weeks);

/// <summary>A named month section inside the yearly / full-cycle views (#2364).</summary>
public class MiniMonthViewModel
{
    private readonly Lazy<MiniMonthContent> _content;

    /// <summary>
    /// A grouped-view month section whose cells and week rows materialize on
    /// first access. The full-cycle view lists ~44 months: building every
    /// section's cells eagerly at view-switch time blocked the UI thread long
    /// enough to ANR on device, so only the shells are built up front.
    /// </summary>
    public MiniMonthViewModel(string title, Func<MiniMonthContent> content)
    {
        Title = title;
        _content = new Lazy<MiniMonthContent>(content);
    }

    /// <summary>Month title shown above the mini calendar.</summary>
    public string Title { get; }

    /// <summary>One cell per date — the canonical daily assignments.</summary>
    public ObservableCollection<CalendarCellViewModel> Cells => _content.Value.Cells;

    /// <summary>
    /// Cells chunked into 7-column weeks; the grouped XAML renders each week
    /// as a plain Grid row instead of a nested CollectionView (#2455).
    /// </summary>
    public IReadOnlyList<MiniMonthWeekViewModel> Weeks => _content.Value.Weeks;
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
    private readonly ICalendarPdfAssetResolver _calendarPdfAssets;
    private readonly ILauncher _launcher;

    private int _year;
    private int _month;
    private int _cycle;
    private int _todayDateNumber;
    private bool _suppressSelection;
    private int _monthOptionsYear = -1;
    private int _cycleOptionsCount = -1;
    private LearningCalendarPolicy? _policy;
    private int _yearOptionsMax = -1;
    private readonly Func<int> _today;

    public LearningCalendarViewModel()
        : this(PerekScheduleService.Instance, PerekDataService.Instance, ShellAppNavigator.Instance)
    {
    }

    internal LearningCalendarViewModel(
        PerekScheduleService schedule,
        PerekDataService perekData,
        IAppNavigator navigator,
        ICalendarPdfAssetResolver? calendarPdfAssets = null,
        ILauncher? launcher = null,
        Func<int>? today = null)
    {
        _schedule = schedule;
        _perekData = perekData;
        _navigator = navigator;
        _calendarPdfAssets = calendarPdfAssets ?? CalendarPdfAssetService.Instance;
        _launcher = launcher ?? Launcher.Default;
        _today = today ?? HebrewDateHelper.GetTodayDateNumber;
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
    [NotifyPropertyChangedFor(nameof(IsCycleRangeVisible))]
    private CalendarViewMode _viewMode = CalendarViewMode.Month;

    public bool IsMonthView => ViewMode == CalendarViewMode.Month;

    /// <summary>Yearly and full-cycle views both render grouped mini-months.</summary>
    public bool IsGroupedView => ViewMode != CalendarViewMode.Month;

    /// <summary>
    /// The contextual cycle range beside the picker shows only in month/year
    /// views; the full-cycle heading already carries that label (#2725).
    /// </summary>
    public bool IsCycleRangeVisible => ViewMode != CalendarViewMode.Cycle;

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

            _todayDateNumber = _today();
            _policy = new LearningCalendarPolicy(_schedule, _todayDateNumber);
            _monthOptionsYear = -1;
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
        (_year, _month) = _policy!.ClampMonth(year, month);
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
            // data, and CycleOptions follow today's current/next cycle window
            // (#2455 — every navigation used to re-allocate all three lists and
            // re-bind the pickers).
            if (_monthOptionsYear != _year)
            {
                _monthOptionsYear = _year;
                MonthOptions = new ObservableCollection<PickerOption>(
                    _policy!.Months(_year).Select(month =>
                        new PickerOption(month, HebrewDateHelper.GetHebrewMonthName(
                            month, HebrewDateHelper.IsHebrewLeapYear(_year)))));
            }

            var firstCycleYear = HebrewDateHelper.NumberToHebrewDate(_schedule.GetCycle(1).StartDate).Year;
            var lastVisibleYear = _policy!.MaxMonth.Year;
            if (_yearOptionsMax != lastVisibleYear)
            {
                _yearOptionsMax = lastVisibleYear;
                var years = new SortedSet<int>();
                for (var year = firstCycleYear; year <= lastVisibleYear; year++)
                {
                    years.Add(year);
                }
                YearOptions = new ObservableCollection<PickerOption>(
                    years.Select(year => new PickerOption(year, $"ה'{GimatryHelper.ToLetters(year % 1000)}")));
            }

            var displayed = ViewMode == CalendarViewMode.Cycle && _cycle > 0
                ? _schedule.GetCycle(_cycle)
                : _schedule.GetCycleForDate(_year * 10000 + _month * 100 + 1)
                    ?? _schedule.GetCycleForDate(_year * 10000 + _month * 100 +
                        HebrewDateHelper.GetDaysInMonth(_year, _month));
            var maxCycle = _policy.Next.Number;
            if (_cycleOptionsCount != maxCycle)
            {
                _cycleOptionsCount = maxCycle;
                CycleOptions = new ObservableCollection<PickerOption>(
                    Enumerable.Range(1, maxCycle).Select(number =>
                        new PickerOption(
                            number,
                            CycleDisplayFormatter.Name(_schedule.GetCycle(number)))));
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
                    CycleDisplayFormatter.Label(displayed),
                _ =>
                    $"{HebrewDateHelper.GetHebrewMonthName(_month, HebrewDateHelper.IsHebrewLeapYear(_year))} " +
                    $"ה'{GimatryHelper.ToLetters(_year % 1000)}",
            };
            // Beside the picker, month/year views show the contextual cycle's
            // range once. The full-cycle view's heading already carries the
            // selected cycle's label — repeating it here duplicated it (#2725).
            CycleLabel = displayed is null || ViewMode == CalendarViewMode.Cycle
                ? string.Empty
                : CycleDisplayFormatter.Label(displayed);
        }
        finally
        {
            _suppressSelection = false;
        }
        PrevMonthCommand.NotifyCanExecuteChanged();
        NextMonthCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(CanExportPdf));
        OnPropertyChanged(nameof(PdfAvailabilityText));
        DownloadPdfCommand.NotifyCanExecuteChanged();
    }

    private void RebuildCells()
    {
        var days = _policy!.BuildMonth(_year, _month);
        // Cells keeps one entry per date — the canonical daily assignments.
        // MonthWeeks is the merged layout the month grid renders (#2365); it
        // reuses the same cell instances instead of building a second model.
        var cells = days.Select((cell, index) =>
            ToCellViewModel(cell, column: index % 7)).ToList();
        Cells = new ObservableCollection<CalendarCellViewModel>(cells);
        MonthWeeks = BuildWeekRows(cells, days, dimmed: null);
    }

    private void RebuildGroups()
    {
        if (ViewMode == CalendarViewMode.Month)
        {
            MonthGroups = new ObservableCollection<MiniMonthViewModel>();
            return;
        }

        // Each group's day cells resolve lazily with the rest of its content,
        // so switching to the ~44-month cycle view only pays for the visible
        // sections instead of blocking on ~2500 view models up front.
        IEnumerable<(string Title, Func<IReadOnlyList<PerekScheduleService.MonthCell>> Days)> groups;
        Func<PerekScheduleService.CalendarDay, bool>? dimmed = null;
        if (ViewMode == CalendarViewMode.Year)
        {
            var year = _year;
            groups = _policy!.Months(year).Select(month =>
                ($"{HebrewDateHelper.GetHebrewMonthName(month, HebrewDateHelper.IsHebrewLeapYear(year))}",
                    (Func<IReadOnlyList<PerekScheduleService.MonthCell>>)(
                        () => _policy.BuildMonth(year, month))));
        }
        else
        {
            var cycle = _schedule.GetCycle(_cycle);
            var (startYear, startMonth, _) = HebrewDateHelper.NumberToHebrewDate(cycle.StartDate);
            var (endYear, endMonth, _) = HebrewDateHelper.NumberToHebrewDate(cycle.EndDate);
            // Legacy month numbering is not chronological (Adar I/II are 13/14),
            // so compare positions inside the year's month order.
            var endMonthIndex = HebrewDateHelper.GetMonthOrder(endYear).IndexOf(endMonth);
            var months = new List<(string, Func<IReadOnlyList<PerekScheduleService.MonthCell>>)>();
            var (year, month) = (startYear, startMonth);
            for (var guard = 0; guard < 50; guard++)
            {
                var order = HebrewDateHelper.GetMonthOrder(year);
                var monthIndex = order.IndexOf(month);
                if (year > endYear || (year == endYear && monthIndex > endMonthIndex))
                {
                    break;
                }
                var monthYear = year;
                var monthNumber = month;
                months.Add((
                    $"{HebrewDateHelper.GetHebrewMonthName(month, HebrewDateHelper.IsHebrewLeapYear(year))} " +
                        $"ה'{GimatryHelper.ToLetters(year % 1000)}",
                    () => _policy!.BuildMonth(monthYear, monthNumber)));
                (year, month) = HebrewDateHelper.NextMonth(year, month);
            }
            groups = months;
            var selectedCycle = _cycle;
            dimmed = day => day.Cycle != selectedCycle;
        }

        MonthGroups = new ObservableCollection<MiniMonthViewModel>(groups.Select(group =>
            new MiniMonthViewModel(group.Title, () =>
            {
                var days = group.Days();
                var cells = days
                    .Select((cell, index) => ToCellViewModel(cell, dimmed, index % 7))
                    .ToList();
                return new MiniMonthContent(
                    new ObservableCollection<CalendarCellViewModel>(cells),
                    BuildWeekRows(cells, days, dimmed));
            })));
    }

    /// <summary>
    /// Chunks a BuildMonth cell list into 7-column week rows, merging an
    /// adjacent Friday/Shabbat pair into one two-column cell when both are
    /// review days of the same cycle covering the identical studied set
    /// (#2365). `cells` reuses the already-built per-date view models so the
    /// merged layout never formats a day twice; `days` supplies the raw
    /// schedule entry each cell came from for the merge check.
    /// </summary>
    private List<MiniMonthWeekViewModel> BuildWeekRows(
        IReadOnlyList<CalendarCellViewModel> cells,
        IReadOnlyList<PerekScheduleService.MonthCell> days,
        Func<PerekScheduleService.CalendarDay, bool>? dimmed)
    {
        var weeks = new List<MiniMonthWeekViewModel>();
        var i = 0;
        while (i < cells.Count)
        {
            var row = new List<CalendarCellViewModel>(7);
            var weekEnd = Math.Min(i + 7, cells.Count);
            while (i < weekEnd)
            {
                var day = days[i].Day;
                var next = i + 1 < weekEnd ? days[i + 1].Day : null;
                if (IsMergedReviewPair(day, next))
                {
                    row.Add(ToMergedCellViewModel(day!, next!, dimmed, row.Count));
                    i += 2; // Saturday is part of Friday's merged block.
                }
                else
                {
                    row.Add(cells[i]);
                    i++;
                }
            }
            weeks.Add(new MiniMonthWeekViewModel { Cells = row });
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
            AccessibilityText = $"יום שישי, {fridayLabel} - שבת {shabbatLabel} - חזרה: {source}",
            MergedDayAccessibilityText = $"שבת, {shabbatLabel} - חזרה: {source}",
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
        // The weekday is derived from the real date, not the grid column, so a
        // screen reader - and a layout regression check - can compare the spoken
        // weekday against where the cell actually rendered.
        var weekdayName = HebrewDateHelper.GetHebrewWeekdayName(
            (int)HebrewDateHelper.ToGregorianDate(day.DateNumber).DayOfWeek);
        var accessibility = day.PerekId is null
            ? $"{weekdayName}, {dateLabel} - לא משובץ"
            : day.Status == PerekScheduleService.DayStatus.Review
                ? $"{weekdayName}, {dateLabel} - חזרה: {source}"
                : $"{weekdayName}, {dateLabel} - {source}";

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
        _cycle = Math.Clamp(cycleNumber, 1, _policy!.Next.Number);
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

    private bool CanNavigatePrev => _policy is not null && (ViewMode == CalendarViewMode.Cycle ? _cycle > 1
        : ViewMode == CalendarViewMode.Year ? _year > _policy.MinMonth.Year
        : (_year, _month) != _policy.MinMonth);

    private bool CanNavigateNext => _policy is not null && (ViewMode == CalendarViewMode.Cycle ? _cycle < _policy.Next.Number
        : ViewMode == CalendarViewMode.Year ? _year < _policy.MaxMonth.Year
        : (_year, _month) != _policy.MaxMonth);

    [RelayCommand(CanExecute = nameof(CanNavigateNext))]
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
        _cycle = _policy!.Current?.Number ?? _policy.Next.Number;
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

    public bool CanExportPdf => _policy?.CanExport(ViewMode switch
    {
        CalendarViewMode.Year => "year",
        CalendarViewMode.Cycle => "cycle",
        _ => "month",
    }, _year, _month, _cycle) == true;

    public string PdfAvailabilityText => CanExportPdf ? string.Empty : LearningCalendarPolicy.PdfUnavailable;

    /// <summary>
    /// Hands the PDF export of the currently viewed period (#2366) to the
    /// device browser, which owns download/save/share.
    ///
    /// Since #2622 the canonical artifact key is resolved against the static
    /// manifest published in the assets bucket, so an available artifact opens
    /// its published object URL directly — no per-download resolver/API call
    /// and no PDF bytes through the website's request path. When the manifest
    /// is unreachable or the artifact is not published, the legacy
    /// /api/calendar-pdf URL is opened instead (it re-checks a fresh manifest
    /// server-side and stays the compatibility path for older installs).
    /// Fetching a not-yet-cached PDF needs connectivity; browsing the
    /// calendar itself stays offline.
    /// </summary>
    [RelayCommand(CanExecute = nameof(CanExportPdf))]
    private async Task DownloadPdfAsync()
    {
        if (!CanExportPdf)
        {
            return;
        }
        // Capture the selection up-front: a navigation during the manifest
        // fetch must not change which artifact this download delivers.
        var mode = ViewMode;
        var year = _year;
        var month = _month;
        var cycle = Math.Max(1, _cycle);
        var view = mode switch
        {
            CalendarViewMode.Year => "year",
            CalendarViewMode.Cycle => "cycle",
            _ => "month",
        };
        var artifactKey = mode switch
        {
            CalendarViewMode.Cycle => $"cycle:{cycle}",
            CalendarViewMode.Year => $"year:{year}",
            _ => $"month:{year * 100 + month}",
        };

        Uri? resolved = null;
        try
        {
            resolved = await _calendarPdfAssets.TryResolveAsync(artifactKey);
        }
        #pragma warning disable S2221 // Deliberate failure boundary: resolution failure falls back to the legacy URL
        catch (Exception ex) //NOSONAR — resolution failure falls back to the legacy URL.
        {
            #pragma warning restore S2221
            Console.Error.WriteLine($"Calendar PDF asset resolution failed: {ex.Message}");
        }
        var url = resolved?.ToString()
            ?? $"{Config.AppConfig.Instance.GetWebsiteUrl()}/api/calendar-pdf" +
                $"?month={year * 100 + month}&view={view}&cycle={cycle}";
        await _launcher.OpenAsync(new Uri(url));
    }
}
