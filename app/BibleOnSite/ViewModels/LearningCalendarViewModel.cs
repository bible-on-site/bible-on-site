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
}

/// <summary>A named month section inside the yearly / full-cycle views (#2364).</summary>
public class MiniMonthViewModel
{
    public required string Title { get; init; }
    public required ObservableCollection<CalendarCellViewModel> Cells { get; init; }
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
        catch (Exception ex)
        {
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
        RebuildCells();
        RebuildGroups();
    }

    private void RebuildPickerOptions()
    {
        _suppressSelection = true;
        try
        {
            MonthOptions = new ObservableCollection<PickerOption>(
                HebrewDateHelper.GetMonthOrder(_year).Select(month =>
                    new PickerOption(month, HebrewDateHelper.GetHebrewMonthName(
                        month, HebrewDateHelper.IsHebrewLeapYear(_year)))));

            var firstCycleYear = HebrewDateHelper.NumberToHebrewDate(_schedule.GetCycle(1).StartDate).Year;
            var lastConfirmedNumber = Math.Max(1, _schedule.LastConfirmedCycleNumber);
            var lastConfirmedYear = HebrewDateHelper.NumberToHebrewDate(
                _schedule.GetCycle(lastConfirmedNumber).EndDate).Year;
            var years = new SortedSet<int> { _year };
            for (var year = firstCycleYear; year <= lastConfirmedYear; year++)
            {
                years.Add(year);
            }
            YearOptions = new ObservableCollection<PickerOption>(
                years.Select(year => new PickerOption(year, $"ה'{GimatryHelper.ToLetters(year % 1000)}")));

            var displayed = ViewMode == CalendarViewMode.Cycle && _cycle > 0
                ? _schedule.GetCycle(_cycle)
                : _schedule.GetCycleForDate(_year * 10000 + _month * 100 + 1)
                    ?? _schedule.GetCycleForDate(_year * 10000 + _month * 100 +
                        HebrewDateHelper.GetDaysInMonth(_year, _month));
            var maxCycle = Math.Max(lastConfirmedNumber, displayed?.Number ?? 1);
            CycleOptions = new ObservableCollection<PickerOption>(
                Enumerable.Range(1, maxCycle).Select(number =>
                {
                    var cycle = _schedule.GetCycle(number);
                    return new PickerOption(
                        number,
                        $"מחזור {number}{(cycle.Projected ? " (משוער)" : string.Empty)}");
                }));

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
        Cells = new ObservableCollection<CalendarCellViewModel>(
            cells.Select(cell => ToCellViewModel(cell)));
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
            new MiniMonthViewModel
            {
                Title = group.Title,
                Cells = new ObservableCollection<CalendarCellViewModel>(
                    group.Cells.Select(cell => ToCellViewModel(cell, dimmed))),
            }));
    }

    private CalendarCellViewModel ToCellViewModel(
        PerekScheduleService.MonthCell cell,
        Func<PerekScheduleService.CalendarDay, bool>? dimmed = null)
    {
        if (cell.Day is null)
        {
            return new CalendarCellViewModel { IsBlank = true };
        }

        var day = cell.Day;
        var reviewIds = day.Status == PerekScheduleService.DayStatus.Review
            ? day.ReviewPerekIds
            : null;
        var source = reviewIds is { Count: > 1 }
            ? $"{_perekData.GetPerekSource(reviewIds[0])} - {_perekData.GetPerekSource(reviewIds[^1])}"
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
        };
    }

    private void SetCycle(int cycleNumber)
    {
        _cycle = Math.Max(1, cycleNumber);
        RebuildPickerOptions();
        RebuildCells();
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
        RebuildCells();
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
}
