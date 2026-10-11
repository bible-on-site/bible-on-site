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
            return;

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

            var displayed = _schedule.GetCycleForDate(_year * 10000 + _month * 100 + 1)
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

            MonthLabel =
                $"{HebrewDateHelper.GetHebrewMonthName(_month, HebrewDateHelper.IsHebrewLeapYear(_year))} " +
                $"ה'{GimatryHelper.ToLetters(_year % 1000)}";
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
        Cells = new ObservableCollection<CalendarCellViewModel>(cells.Select(cell =>
        {
            if (cell.Day is null)
            {
                return new CalendarCellViewModel { IsBlank = true };
            }

            var day = cell.Day;
            var source = day.PerekId is int perekId
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
            };
        }));
    }

    partial void OnSelectedMonthChanged(PickerOption? value)
    {
        if (_suppressSelection || value is null || value.Value == _month)
            return;
        SetMonth(_year, value.Value);
    }

    partial void OnSelectedYearChanged(PickerOption? value)
    {
        if (_suppressSelection || value is null || value.Value == _year)
            return;
        // When the viewed month does not exist in the target year
        // (Adar I/II of a leap year), fall back to plain Adar.
        var month = HebrewDateHelper.GetMonthOrder(value.Value).Contains(_month) ? _month : 6;
        SetMonth(value.Value, month);
    }

    partial void OnSelectedCycleChanged(PickerOption? value)
    {
        if (_suppressSelection || value is null)
            return;
        var cycle = _schedule.GetCycle(value.Value);
        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(cycle.StartDate);
        if (year != _year || month != _month)
        {
            SetMonth(year, month);
        }
    }

    [RelayCommand]
    private void NextMonth()
    {
        var (year, month) = HebrewDateHelper.NextMonth(_year, _month);
        SetMonth(year, month);
    }

    [RelayCommand]
    private void PrevMonth()
    {
        var (year, month) = HebrewDateHelper.PrevMonth(_year, _month);
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
            return;
        await _navigator.GoToAsync($"{AppRoutes.CalendarReader}?perekId={perekId}");
    }
}
