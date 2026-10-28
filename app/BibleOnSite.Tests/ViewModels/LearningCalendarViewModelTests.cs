using System.Collections.ObjectModel;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Microsoft.Maui.ApplicationModel;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

public class LearningCalendarViewModelTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";

    // Confirmed cycle 1 opens Sunday 29 Kislev 5775; perek 999 is deliberately
    // referenced by the schedule but absent from tanah_perek.
    private static readonly string[] CycleOneAndTwo =
    [
        "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
        "INSERT INTO tanah_perek_date VALUES (999,1,'57750330','57750330','17:16')",
        "INSERT INTO tanah_perek_date VALUES (1,2,'57781103','57781103','20:24')"
    ];

    private static readonly string[] CyclesOneToFour =
    [
        "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
        "INSERT INTO tanah_perek_date VALUES (1,2,'57781103','57781103','20:24')",
        "INSERT INTO tanah_perek_date VALUES (1,3,'57821305','57821305','17:52')",
        "INSERT INTO tanah_perek_date VALUES (1,4,'57851207','57851207','17:16')"
    ];

    // Cycle 1 with three study days inside one calendar week (Sunday-Wednesday)
    // so Friday/Saturday resolve to a whole-week review (#2365).
    private static readonly string[] WeekReviewCycle =
    [
        "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
        "INSERT INTO tanah_perek_date VALUES (2,1,'57750401','57750401','17:16')",
        "INSERT INTO tanah_perek_date VALUES (3,1,'57750402','57750402','17:16')"
    ];

    private sealed class Fixture : IAsyncDisposable
    {
        public required TestStorage Storage { get; init; }
        public required PerekScheduleService Schedule { get; init; }
        public required PerekDataService PerekData { get; init; }
        public required Mock<IAppNavigator> Navigator { get; init; }
        public required LearningCalendarViewModel ViewModel { get; init; }

        public async ValueTask DisposeAsync()
        {
            await Storage.DisposeAsync();
        }
    }

    private static async Task<Fixture> CreateFixtureAsync(string[] scheduleInserts)
    {
        var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
        await db.ExecuteAsync("WITH RECURSIVE chapters(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM chapters WHERE id<929) " +
            "INSERT INTO tanah_perek SELECT id,id,NULL FROM chapters");
        foreach (var insert in scheduleInserts)
        {
            await db.ExecuteAsync(insert);
        }

        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var schedule = new PerekScheduleService(localDb);
        var perekData = new PerekDataService(localDb, schedule);
        var navigator = new Mock<IAppNavigator>();
        var viewModel = new LearningCalendarViewModel(schedule, perekData, navigator.Object);
        return new Fixture
        {
            Storage = storage,
            Schedule = schedule,
            PerekData = perekData,
            Navigator = navigator,
            ViewModel = viewModel
        };
    }

    private static LearningCalendarViewModel.PickerOption Option(
        ObservableCollection<LearningCalendarViewModel.PickerOption> options,
        int value)
    {
        return options.First(o => o.Value == value);
    }

    [Fact]
    public void Ctor_Default_WiresSingletonsWithoutLoading()
    {
        // The XAML page uses the parameterless constructor; it must not touch
        // the database before InitializeAsync runs.
        var vm = new LearningCalendarViewModel();

        vm.Cells.Should().BeEmpty();
        vm.IsLoading.Should().BeFalse();
        vm.ErrorMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task Initialize_PopulatesGridPickersAndLabels()
    {
        await using var fixture = await CreateFixtureAsync(CycleOneAndTwo);
        var vm = fixture.ViewModel;

        await vm.InitializeAsync();

        vm.IsLoading.Should().BeFalse();
        vm.ErrorMessage.Should().BeEmpty();

        var today = HebrewDateHelper.GetTodayDateNumber();
        var (year, month, day) = HebrewDateHelper.NumberToHebrewDate(today);
        var expectedMonthName = HebrewDateHelper.GetHebrewMonthName(month, HebrewDateHelper.IsHebrewLeapYear(year));
        vm.MonthLabel.Should().Be($"{expectedMonthName} ה'{GimatryHelper.ToLetters(year % 1000)}");

        vm.MonthOptions.Select(o => o.Value).Should().Equal(HebrewDateHelper.GetMonthOrder(year));
        vm.SelectedMonth.Should().Be(vm.MonthOptions.First(o => o.Value == month));
        vm.SelectedYear.Should().Be(vm.YearOptions.First(o => o.Value == year));
        vm.YearOptions.Select(o => o.Value).Should().Contain(5775);

        // Only cycles 1-2 are confirmed, so the current month projects a later
        // cycle and both the label and the options are marked as estimated.
        vm.SelectedCycle.Should().NotBeNull();
        vm.CycleLabel.Should().Contain($"מחזור {GimatryHelper.ToDisplayLetters(vm.SelectedCycle!.Value)}");
        vm.CycleOptions.Select(o => o.Label).Should().ContainMatch("*משוער*");

        var dayCells = vm.Cells.Where(c => !c.IsBlank).ToList();
        var daysInMonth = HebrewDateHelper.GetDaysInMonth(year, month);
        dayCells.Should().HaveCount(daysInMonth);
        dayCells.Should().OnlyContain(c => c.DateNumber / 100 == year * 100 + month);

        var todayCell = dayCells.Single(c => c.DateNumber == today);
        todayCell.IsToday.Should().BeTrue();
        todayCell.DayText.Should().Be(day.ToHebrewLetters());
    }

    [Fact]
    public async Task Initialize_WhenLoadFails_SetsErrorMessageAndStopsLoading()
    {
        // No database file at all: the load throws and surfaces as an error.
        await using var storage = new TestStorage();
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var schedule = new PerekScheduleService(localDb);
        var perekData = new PerekDataService(localDb, schedule);
        var vm = new LearningCalendarViewModel(schedule, perekData, new Mock<IAppNavigator>().Object);

        await vm.InitializeAsync();

        vm.ErrorMessage.Should().Contain("טעינת הלוח נכשלה");
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task Initialize_WhenAlreadyLoading_ReturnsImmediately()
    {
        var storage = new TestStorage();
        await storage.BundleDatabaseAsync(DbName,
            [.. PerekDataServiceTests.Schema,
                "INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,1)",
                "INSERT INTO tanah_perek VALUES (1,1,NULL)",
                "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')"]);
        // Hold the packaged-database stream open so the first initialization
        // stays in flight while the second call arrives.
        var gate = new TaskCompletionSource<Stream>();
        storage.FileSystem
            .Setup(f => f.OpenAppPackageFileAsync(It.IsAny<string>()))
            .Returns(gate.Task);
        var localDb = new LocalDatabaseService(storage.FileSystem.Object);
        var schedule = new PerekScheduleService(localDb);
        var perekData = new PerekDataService(localDb, schedule);
        var vm = new LearningCalendarViewModel(schedule, perekData, new Mock<IAppNavigator>().Object);
        await using var _ = storage;

        var first = vm.InitializeAsync();
        vm.IsLoading.Should().BeTrue();

        await vm.InitializeAsync();

        using var packageStream = new MemoryStream(storage.PackageFiles[DbName]);
        gate.SetResult(packageStream);
        await first;
        vm.ErrorMessage.Should().BeEmpty();
        vm.Cells.Should().NotBeEmpty();
    }

    [Fact]
    public async Task SelectedMonth_Change_RebuildsTheViewedMonth()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        // Jump to Kislev 5775, the month cycle 1 starts in.
        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 3);

        vm.MonthLabel.Should().Be("כסלו ה'תשעה");
        var cycleStart = vm.Cells.Single(c => c.DateNumber == 57750329);
        cycleStart.PerekId.Should().Be(1);
        cycleStart.PerekSource.Should().Be("בראשית א");
        cycleStart.IsReview.Should().BeFalse();
        cycleStart.IsNone.Should().BeFalse();
        cycleStart.IsTappable.Should().BeTrue();
        // כט כסלו ה'תשעה was a Sunday - the accessibility text opens with the
        // spoken weekday so screen readers and layout tests can anchor each
        // cell to its real weekday.
        cycleStart.AccessibilityText.Should().StartWith("יום ראשון,")
            .And.Contain("כסלו").And.Contain("בראשית א");

        // In-cycle days without their own assignment are review days.
        var review = vm.Cells.Single(c => c.DateNumber == 57750330);
        review.IsReview.Should().BeTrue();
        review.PerekId.Should().Be(1);
        review.AccessibilityText.Should().Contain("חזרה").And.Contain("בראשית א");
    }

    [Fact]
    public async Task SelectedMonth_SameValueOrNull_DoesNotRebuild()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var cells = vm.Cells;

        vm.SelectedMonth = Option(vm.MonthOptions, vm.SelectedMonth!.Value);
        vm.Cells.Should().BeSameAs(cells);

        vm.SelectedMonth = null;
        vm.Cells.Should().BeSameAs(cells);
    }

    [Fact]
    public async Task SelectedYear_ToNonLeapYear_FallsBackToPlainAdar()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        // View Adar II of the leap year 5784, then move to non-leap 5785.
        vm.SelectedYear = Option(vm.YearOptions, 5784);
        vm.SelectedMonth = Option(vm.MonthOptions, 14);
        vm.MonthLabel.Should().Be("אדר ב ה'תשפד");

        vm.SelectedYear = Option(vm.YearOptions, 5785);

        vm.MonthLabel.Should().Be("אדר ה'תשפה");
    }

    [Fact]
    public async Task SelectedYear_SameValueOrNull_DoesNotRebuild()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var cells = vm.Cells;

        vm.SelectedYear = Option(vm.YearOptions, vm.SelectedYear!.Value);
        vm.Cells.Should().BeSameAs(cells);

        vm.SelectedYear = null;
        vm.Cells.Should().BeSameAs(cells);
    }

    [Fact]
    public async Task SelectedCycle_JumpsToTheCyclesStartMonth()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        vm.SelectedCycle = Option(vm.CycleOptions, 1);

        vm.MonthLabel.Should().Be("כסלו ה'תשעה");

        // Re-selecting the already displayed cycle keeps the current grid.
        var cells = vm.Cells;
        vm.SelectedCycle = Option(vm.CycleOptions, vm.SelectedCycle!.Value);
        vm.Cells.Should().BeSameAs(cells);

        vm.SelectedCycle = null;
        vm.Cells.Should().BeSameAs(cells);
    }

    [Fact]
    public async Task MonthCommands_NavigateAcrossYearBoundary()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        // Elul 5784 -> Tishrei 5785 via the next-month command.
        vm.SelectedYear = Option(vm.YearOptions, 5784);
        vm.SelectedMonth = Option(vm.MonthOptions, 12);

        vm.NextMonthCommand.Execute(null);
        vm.MonthLabel.Should().Be("תשרי ה'תשפה");

        vm.PrevMonthCommand.Execute(null);
        vm.MonthLabel.Should().Be("אלול ה'תשפד");
    }

    [Fact]
    public async Task TodayCommand_ReturnsToTheCurrentMonth()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var today = HebrewDateHelper.GetTodayDateNumber();
        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(today);
        var expectedLabel = $"{HebrewDateHelper.GetHebrewMonthName(month, HebrewDateHelper.IsHebrewLeapYear(year))} " +
            $"ה'{GimatryHelper.ToLetters(year % 1000)}";

        vm.NextMonthCommand.Execute(null);
        vm.MonthLabel.Should().NotBe(expectedLabel);

        vm.TodayCommand.Execute(null);
        vm.MonthLabel.Should().Be(expectedLabel);
    }

    [Fact]
    public async Task OpenPerek_StudyDay_OpensTheCalendarReaderRoute()
    {
        await using var fixture = await CreateFixtureAsync(CycleOneAndTwo);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        var tappable = vm.Cells.First(c => c.PerekId is not null);
        await vm.OpenPerekCommand.ExecuteAsync(tappable);

        fixture.Navigator.Verify(
            n => n.GoToAsync($"{AppRoutes.CalendarReader}?perekId={tappable.PerekId}"),
            Times.Once);

        // Blank and perek-less cells are not tappable and navigate nowhere.
        await vm.OpenPerekCommand.ExecuteAsync(new CalendarCellViewModel { IsBlank = true });
        await vm.OpenPerekCommand.ExecuteAsync(null);
        fixture.Navigator.Verify(
            n => n.GoToAsync(It.IsAny<string>()),
            Times.Once);
    }

    [Fact]
    public async Task Cells_PreProgramMonth_AreUnscheduledWithNoCycle()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        // Cheshvan 5775 ends before cycle 1 starts on 29 Kislev.
        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 2);

        vm.MonthLabel.Should().Be("חשוון ה'תשעה");
        // 1 Cheshvan 5775 was a Saturday: six leading blank cells.
        vm.Cells.Take(6).Should().OnlyContain(c => c.IsBlank);
        var dayCells = vm.Cells.Skip(6).ToList();
        dayCells.Should().OnlyContain(c =>
            c.IsNone && c.PerekId == null && !c.IsTappable && !c.IsToday);
        dayCells.Should().OnlyContain(c => c.AccessibilityText.Contains("לא משובץ"));
        vm.SelectedCycle.Should().BeNull();
        vm.CycleLabel.Should().BeEmpty();
    }

    [Fact]
    public async Task Cells_MonthPartiallyInCycle_OwnsTheIncomingCycle()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        // Kislev 5775 starts unscheduled but cycle 1 opens on the 29th.
        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 3);

        vm.SelectedCycle.Should().Be(Option(vm.CycleOptions, 1));
        vm.CycleLabel.Should().Contain("מחזור א'").And.NotContain("משוער");
        vm.IsCycleRangeVisible.Should().BeTrue();
    }

    [Fact]
    public async Task Cells_PerekMissingFromCatalog_ShowsEmptySource()
    {
        await using var fixture = await CreateFixtureAsync(CycleOneAndTwo);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 3);

        // 30 Kislev is scheduled with perek 999, which has no catalog entry:
        // the cell stays tappable but shows no source text.
        var missing = vm.Cells.Single(c => c.DateNumber == 57750330);
        missing.PerekId.Should().Be(999);
        missing.PerekSource.Should().BeEmpty();
        missing.IsTappable.Should().BeTrue();
    }

    [Fact]
    public async Task ReviewDays_CoverTheWholeStudiedWeek()
    {
        await using var fixture = await CreateFixtureAsync(WeekReviewCycle);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        fixture.Schedule.ResolveDay(57750404).ReviewPerekIds.Should().Equal(1, 2, 3);
        fixture.Schedule.ResolveDay(57750405).ReviewPerekIds.Should().Equal(1, 2, 3);

        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 4); // Tevet

        var friday = vm.Cells.First(c => c.DateNumber == 57750404);
        var saturday = vm.Cells.First(c => c.DateNumber == 57750405);
        friday.IsReview.Should().BeTrue();
        friday.PerekSource.Should().Be("בראשית א-ג");
        friday.AccessibilityText.Should().Contain("חזרה: בראשית א-ג");
        saturday.IsReview.Should().BeTrue();
        saturday.PerekSource.Should().Be("בראשית א-ג");
    }

    [Fact]
    public async Task MonthWeeks_MergeFridayAndSaturdayReviewIntoOneBlock()
    {
        // The canonical Cells list keeps one cell per date (#2365 keeps the
        // daily assignments intact); MonthWeeks is the rendered layout.
        await using var fixture = await CreateFixtureAsync(WeekReviewCycle);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 4); // Tevet

        var week = vm.MonthWeeks.Single(w =>
            w.Cells.Any(c => c.DateNumber == 57750404));
        var merged = week.Cells.Single(c => c.DateNumber == 57750404);
        merged.Column.Should().Be(5);
        merged.ColumnSpan.Should().Be(2);
        merged.DayText.Should().Be(4.ToHebrewLetters());
        merged.MergedDayText.Should().Be(5.ToHebrewLetters());
        merged.PerekSource.Should().Be("בראשית א-ג");
        merged.AccessibilityText.Should()
            .Contain("יום שישי").And.Contain("שבת").And.Contain("חזרה: בראשית א-ג");
        merged.MergedDayAccessibilityText.Should()
            .StartWith("שבת").And.Contain("חזרה: בראשית א-ג");
        // Saturday's standalone cell is folded into the merged block.
        week.Cells.Should().NotContain(c => c.DateNumber == 57750405);
        week.Cells.Should().HaveCount(6);
    }

    [Fact]
    public async Task GroupedView_MiniMonthWeeksMergeTheReviewPair()
    {
        await using var fixture = await CreateFixtureAsync(WeekReviewCycle);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);
        vm.SelectedYear = Option(vm.YearOptions, 5775);

        var week = vm.MonthGroups
            .SelectMany(g => g.Weeks)
            .Single(w => w.Cells.Any(c => c.DateNumber == 57750404));
        var merged = week.Cells.Single(c => c.DateNumber == 57750404);
        merged.ColumnSpan.Should().Be(2);
        merged.MergedDayText.Should().Be(5.ToHebrewLetters());
        week.Cells.Should().NotContain(c => c.DateNumber == 57750405);
    }

    [Fact]
    public async Task YearView_GroupsEveryMonthOfTheYear()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var today = HebrewDateHelper.GetTodayDateNumber();
        var (year, _, _) = HebrewDateHelper.NumberToHebrewDate(today);

        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);

        vm.ViewMode.Should().Be(CalendarViewMode.Year);
        vm.IsGroupedView.Should().BeTrue();
        vm.IsMonthView.Should().BeFalse();
        vm.MonthLabel.Should().Be($"שנת ה'{GimatryHelper.ToLetters(year % 1000)}");
        vm.MonthGroups.Should().HaveCount(HebrewDateHelper.GetMonthOrder(year).Length);
        vm.MonthGroups.SelectMany(g => g.Cells)
            .Should().Contain(c => c.PerekId != null);
    }

    [Fact]
    public async Task GroupedView_WeeksAssignRealWeekdayColumns()
    {
        // The grouped-view week rows bind Grid.Column to the cell's Column: a
        // wrong index collapses or misaligns every mini-month on the page.
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);

        foreach (var group in vm.MonthGroups)
        {
            foreach (var week in group.Weeks)
            {
                week.Cells.Select(cell => cell.Column)
                    .Should().Equal(Enumerable.Range(0, week.Cells.Count));
            }
            var firstDay = group.Cells.First(cell => !cell.IsBlank);
            var (year, month, day) = HebrewDateHelper.NumberToHebrewDate(firstDay.DateNumber);
            firstDay.Column.Should().Be(HebrewDateHelper.GetDayOfWeek(year, month, day));
        }
    }

    [Fact]
    public async Task CycleView_GroupsTheWholeCycle_AndDimsOutsideDays()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();

        vm.SetViewModeCommand.Execute(CalendarViewMode.Cycle);

        vm.ViewMode.Should().Be(CalendarViewMode.Cycle);
        var displayed = fixture.Schedule.GetCycleForDate(HebrewDateHelper.GetTodayDateNumber());
        var expected = displayed?.Number ?? 1;
        vm.SelectedCycle!.Value.Should().Be(expected);
        vm.MonthLabel.Should().StartWith($"מחזור {GimatryHelper.ToDisplayLetters(expected)}");

        // The heading is the one authoritative cycle description — the
        // beside-picker range that repeated it stays hidden (#2725).
        vm.IsCycleRangeVisible.Should().BeFalse();
        vm.CycleLabel.Should().BeEmpty();
        vm.CycleOptions.Select(o => o.Label).Should().Contain("מחזור ד'");

        vm.MonthGroups.Should().HaveCountGreaterThan(1);

        var cells = vm.MonthGroups.SelectMany(g => g.Cells).Where(c => !c.IsBlank).ToList();
        cells.Should().Contain(c => !c.IsDimmed);
        cells.Should().Contain(c => c.IsDimmed);
        // Scheduled in-cycle days remain navigable.
        cells.Where(c => !c.IsDimmed && c.PerekId != null).Should().NotBeEmpty();
    }

    [Fact]
    public async Task CycleView_NavigationMovesBetweenCycles()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        vm.SetViewModeCommand.Execute(CalendarViewMode.Cycle);
        var before = vm.SelectedCycle!.Value;

        vm.NextMonthCommand.Execute(null);
        vm.SelectedCycle!.Value.Should().Be(before + 1);
        vm.MonthLabel.Should().StartWith($"מחזור {GimatryHelper.ToDisplayLetters(before + 1)}");

        vm.PrevMonthCommand.Execute(null);
        vm.SelectedCycle!.Value.Should().Be(before);

        // Previous is disabled on the first cycle.
        vm.SelectedCycle = Option(vm.CycleOptions, 1);
        vm.PrevMonthCommand.CanExecute(null).Should().BeFalse();
    }

    [Fact]
    public async Task MonthCommands_InYearView_MoveBetweenYears()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var today = HebrewDateHelper.GetTodayDateNumber();
        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(today);
        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);

        vm.NextMonthCommand.Execute(null);
        vm.MonthLabel.Should().Be($"שנת ה'{GimatryHelper.ToLetters((year + 1) % 1000)}");
        // The viewed month is preserved across the year jump when it exists.
        vm.SelectedMonth!.Value.Should().Be(
            HebrewDateHelper.GetMonthOrder(year + 1).Contains(month) ? month : 6);
    }

    [Fact]
    public async Task SetViewMode_ToCurrentMode_LeavesCalendarUntouched()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var cells = vm.Cells;
        var groups = vm.MonthGroups;

        vm.SetViewModeCommand.Execute(vm.ViewMode);

        vm.Cells.Should().BeSameAs(cells);
        vm.MonthGroups.Should().BeSameAs(groups);
    }

    [Fact]
    public async Task SetViewMode_ToGroupedView_DoesNotRebuildHiddenMonthGrid()
    {
        // #2455: building the hidden month grid's cells in year/cycle mode only
        // flooded the invisible CollectionView with redundant work.
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var cells = vm.Cells;

        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);

        vm.Cells.Should().BeSameAs(cells);
        vm.MonthGroups.Should().NotBeEmpty();

        vm.SetViewModeCommand.Execute(CalendarViewMode.Cycle);
        vm.Cells.Should().BeSameAs(cells);

        vm.SetViewModeCommand.Execute(CalendarViewMode.Month);
        vm.Cells.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task YearView_NavigationStopsAtTheLastVisibleYear()
    {
        // The last year belongs to the next cycle. Navigation must never add
        // another cycle's years to the picker.
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);
        var maxListed = vm.YearOptions.Max(o => o.Value);

        while (vm.NextMonthCommand.CanExecute(null))
        {
            vm.NextMonthCommand.Execute(null);
        }

        vm.SelectedYear.Should().NotBeNull();
        vm.SelectedYear!.Value.Should().Be(maxListed);
        vm.NextMonthCommand.Execute(null);
        vm.SelectedYear!.Value.Should().Be(maxListed);
        vm.YearOptions.Select(o => o.Value).Should().Contain(vm.SelectedYear.Value);
        vm.MonthGroups.Should().NotBeEmpty();
    }

    [Fact]
    public async Task CycleView_FromMonthBeforeCycleOne_DefaultsToCycleOne()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        // Tishrei 5775 precedes cycle 1's start (29 Kislev 5775), so no cycle
        // covers the viewed month and the picker falls back to the first cycle.
        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 1);

        vm.SetViewModeCommand.Execute(CalendarViewMode.Cycle);

        vm.ViewMode.Should().Be(CalendarViewMode.Cycle);
        vm.SelectedCycle!.Value.Should().Be(1);
        vm.MonthGroups.Should().NotBeEmpty();
    }

    [Fact]
    public async Task MonthCommands_InYearView_MoveBackOneYear()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        var (year, _, _) = HebrewDateHelper.NumberToHebrewDate(HebrewDateHelper.GetTodayDateNumber());
        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);

        vm.PrevMonthCommand.Execute(null);

        vm.MonthLabel.Should().Be($"שנת ה'{GimatryHelper.ToLetters((year - 1) % 1000)}");
    }

    [Fact]
    public async Task SelectingCycle_WithinViewedYear_NavigatesToItsStartMonth()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        // View Tishrei 5775 while picking cycle 1, whose start is Kislev 5775:
        // same year, different month, so only the month has to move.
        vm.SelectedYear = Option(vm.YearOptions, 5775);
        vm.SelectedMonth = Option(vm.MonthOptions, 1);

        vm.SelectedCycle = Option(vm.CycleOptions, 1);

        vm.SelectedMonth!.Value.Should().Be(3);
        vm.SelectedYear!.Value.Should().Be(5775);
    }

    [Fact]
    public async Task CycleView_PrevEnabledPastTheFirstCycle()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var vm = fixture.ViewModel;
        await vm.InitializeAsync();
        vm.SetViewModeCommand.Execute(CalendarViewMode.Cycle);
        vm.NextMonthCommand.Execute(null);

        vm.PrevMonthCommand.CanExecute(null).Should().BeTrue();
        vm.SetViewModeCommand.Execute(CalendarViewMode.Month);
        vm.PrevMonthCommand.CanExecute(null).Should().BeTrue();
    }

    private sealed class StubPdfAssets(Func<string, Task<Uri?>> resolve) : ICalendarPdfAssetResolver
    {
        public List<string> Keys { get; } = [];

        public Task<Uri?> TryResolveAsync(string artifactKey)
        {
            Keys.Add(artifactKey);
            return resolve(artifactKey);
        }
    }

    private static readonly Uri PublishedAsset =
        new("https://assets.example/generated/calendar-pdf/objects/deadbeef.pdf");

    [Theory]
    [InlineData(57880708, false)]
    [InlineData(57880709, true)]
    [InlineData(57880710, true)]
    public async Task CalendarPolicy_NextCycleOpensAtTheHebrewAnniversary(int today, bool expected)
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        await fixture.Schedule.LoadAsync();
        var policy = new LearningCalendarPolicy(fixture.Schedule, today);
        policy.Current!.Number.Should().Be(4);
        policy.Next.Number.Should().Be(5);
        policy.CanExport("cycle", 0, 0, 5).Should().Be(expected);
        foreach (var year in new[] { 5790, 5791, 5792 })
        {
            policy.CanExport("year", year, 1, 0).Should().Be(expected);
        }
        policy.CanExport("year", 5789, 1, 0).Should().Be(expected);
        policy.CanExport("year", 5793, 1, 0).Should().BeFalse();
        policy.CanExport("cycle", 0, 0, 4).Should().BeTrue();
        policy.CanExport("cycle", 0, 0, 3).Should().BeFalse();
        policy.CanExport("cycle", 0, 0, 6).Should().BeFalse();
    }

    [Theory]
    [InlineData(57841330, 57830629)]
    [InlineData(57841405, 57830605)]
    [InlineData(57850605, 57841405)]
    public void CalendarPolicy_AnniversaryPreservesHebrewMonthNames(int start, int expected)
    {
        var cycle = new PerekScheduleService.StudyCycle(1, start, start, true);
        LearningCalendarPolicy.ExportOpens(cycle).Should().Be(HebrewDateHelper.ToGregorianDate(expected));
    }

    [Fact]
    public async Task CalendarPolicy_ClampsMonthsAndHidesDaysAfterNextCycle()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        await fixture.Schedule.LoadAsync();
        var policy = new LearningCalendarPolicy(fixture.Schedule, 57870217);
        policy.ClampMonth(5774, 1).Should().Be(policy.MinMonth);
        policy.ClampMonth(5900, 1).Should().Be(policy.MaxMonth);
        policy.ClampMonth(5775, 1).Should().Be(policy.MinMonth);
        policy.ClampMonth(5793, 12).Should().Be(policy.MaxMonth);
        policy.ClampMonth(5787, 2).Should().Be((5787, 2));
        policy.Months(5775).Should().StartWith(1);
        policy.Months(5793).Should().Equal(1, 2);
        policy.CanExport("month", 5787, 2, 0).Should().BeTrue();
        policy.CanExport("year", 5787, 1, 0).Should().BeTrue();
        foreach (var year in new[] { 5774, 5784, 5785, 5789, 5790, 5793, 5900 })
        {
            policy.CanExport("year", year, 1, 0).Should().BeFalse();
        }
        policy.CanExport("month", 5785, 13, 0).Should().BeFalse();
        policy.CanExport("month", 5789, 8, 0).Should().BeFalse();
        policy.CanExport("month", 5785, 12, 0).Should().BeFalse();
        var beyond = policy.BuildMonth(5793, 2).Select(c => c.Day)
            .Where(d => d is not null && HebrewDateHelper.ToGregorianDate(d.DateNumber) > HebrewDateHelper.ToGregorianDate(policy.Next.EndDate));
        beyond.Should().NotBeEmpty();
        beyond.Should().OnlyContain(d => d!.PerekId == null && d.Cycle == null && d.Status == PerekScheduleService.DayStatus.None);
    }

    [Fact]
    public async Task CalendarPolicy_HandlesBeforeProgrammeAndInterCycleGaps()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        await fixture.Schedule.LoadAsync();
        var first = fixture.Schedule.GetCycle(1);
        var early = new LearningCalendarPolicy(fixture.Schedule, HebrewDateHelper.AddDays(first.StartDate, -800));
        early.Current.Should().BeNull();
        early.Next.Number.Should().Be(1);
        early.CanExport("year", 5775, 1, 0).Should().BeFalse();
        new LearningCalendarPolicy(fixture.Schedule, first.StartDate).CanExport("year", 5775, 1, 0).Should().BeTrue();
        for (var offset = 1; offset <= 3; offset++)
        {
            var policy = new LearningCalendarPolicy(fixture.Schedule, HebrewDateHelper.AddDays(fixture.Schedule.GetCycle(4).EndDate, offset));
            policy.Current.Should().BeNull();
            policy.Next.Number.Should().Be(5);
            policy.CanExport("cycle", 0, 0, 5).Should().BeTrue();
        }
    }

    [Fact]
    public async Task NavigationAndPdfCommands_RespectTheLiveCycleWindow()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var assets = new StubPdfAssets(_ => Task.FromResult<Uri?>(PublishedAsset));
        var launcher = LauncherCapturing(out var opened);
        var vm = new LearningCalendarViewModel(fixture.Schedule, fixture.PerekData, fixture.Navigator.Object,
            assets, launcher.Object, () => 57870217);
        await vm.InitializeAsync();
        vm.CycleOptions.Select(o => o.Value).Should().Equal(1, 2, 3, 4, 5);
        vm.YearOptions.Last().Value.Should().Be(5793);
        vm.SetViewModeCommand.Execute(CalendarViewMode.Cycle);
        vm.SelectedCycle = Option(vm.CycleOptions, 5);
        vm.NextMonthCommand.CanExecute(null).Should().BeFalse();
        vm.NextMonthCommand.Execute(null);
        vm.SelectedCycle!.Value.Should().Be(5);
        vm.DownloadPdfCommand.CanExecute(null).Should().BeFalse();
        vm.PdfAvailabilityText.Should().Be(LearningCalendarPolicy.PdfUnavailable);
        await vm.DownloadPdfCommand.ExecuteAsync(null);
        assets.Keys.Should().BeEmpty();
        opened().Should().BeNull();
        vm.SelectedCycle = Option(vm.CycleOptions, 3);
        vm.DownloadPdfCommand.CanExecute(null).Should().BeFalse();
        vm.TodayCommand.Execute(null);
        vm.SelectedCycle!.Value.Should().Be(4);
        vm.DownloadPdfCommand.CanExecute(null).Should().BeTrue();
        vm.PdfAvailabilityText.Should().BeEmpty();
        vm.SetViewModeCommand.Execute(CalendarViewMode.Month);
        vm.SelectedYear = Option(vm.YearOptions, 5793);
        vm.SelectedMonth!.Value.Should().Be(2);
        vm.MonthOptions.Select(o => o.Value).Should().Equal(1, 2);
        vm.NextMonthCommand.CanExecute(null).Should().BeFalse();
        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);
        vm.MonthGroups.Should().HaveCount(2);
        vm.NextMonthCommand.CanExecute(null).Should().BeFalse();
    }

    private static Mock<ILauncher> LauncherCapturing(out Func<Uri?> opened)
    {
        Uri? captured = null;
        var launcher = new Mock<ILauncher>();
        launcher.Setup(l => l.OpenAsync(It.IsAny<Uri>()))
            .Callback<Uri>(u => captured = u)
            .ReturnsAsync(true);
        opened = () => captured;
        return launcher;
    }

    [Fact]
    public async Task DownloadPdfCommand_OpensThePublishedArtifactUrl()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var assets = new StubPdfAssets(_ => Task.FromResult<Uri?>(PublishedAsset));
        var launcher = LauncherCapturing(out var opened);
        var vm = new LearningCalendarViewModel(
            fixture.Schedule, fixture.PerekData, fixture.Navigator.Object, assets, launcher.Object);
        await vm.InitializeAsync();

        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(HebrewDateHelper.GetTodayDateNumber());
        await vm.DownloadPdfCommand.ExecuteAsync(null);

        // Month view resolves `month:YYYYMM` to the published object — the
        // website API is never consulted for an available artifact (#2622).
        assets.Keys.Should().Equal($"month:{year * 100 + month}");
        opened().Should().Be(PublishedAsset);
    }

    [Fact]
    public async Task DownloadPdfCommand_ResolvesYearAndCycleKeysPerView()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var assets = new StubPdfAssets(_ => Task.FromResult<Uri?>(PublishedAsset));
        var launcher = LauncherCapturing(out var opened);
        var vm = new LearningCalendarViewModel(
            fixture.Schedule, fixture.PerekData, fixture.Navigator.Object, assets, launcher.Object);
        await vm.InitializeAsync();
        var (year, _, _) = HebrewDateHelper.NumberToHebrewDate(HebrewDateHelper.GetTodayDateNumber());

        vm.SetViewModeCommand.Execute(CalendarViewMode.Year);
        await vm.DownloadPdfCommand.ExecuteAsync(null);
        assets.Keys.Should().Equal($"year:{year}");
        opened().Should().Be(PublishedAsset);

        vm.SetViewModeCommand.Execute(CalendarViewMode.Cycle);
        await vm.DownloadPdfCommand.ExecuteAsync(null);
        assets.Keys.Should().Equal($"year:{year}", $"cycle:{vm.SelectedCycle!.Value}");
        opened().Should().Be(PublishedAsset);
    }

    [Fact]
    public async Task DownloadPdfCommand_WhenArtifactMissing_OpensTheLegacyApiUrl()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var assets = new StubPdfAssets(_ => Task.FromResult<Uri?>(null));
        var launcher = LauncherCapturing(out var opened);
        var vm = new LearningCalendarViewModel(
            fixture.Schedule, fixture.PerekData, fixture.Navigator.Object, assets, launcher.Object);
        await vm.InitializeAsync();

        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(HebrewDateHelper.GetTodayDateNumber());
        await vm.DownloadPdfCommand.ExecuteAsync(null);

        opened().Should().Be(new Uri(
            $"{BibleOnSite.Config.AppConfig.Instance.GetWebsiteUrl()}/api/calendar-pdf" +
            $"?month={year * 100 + month}&view=month&cycle=1"));
    }

    [Fact]
    public async Task DownloadPdfCommand_WhenResolutionThrows_StillOpensTheLegacyApiUrl()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var assets = new StubPdfAssets(_ => throw new HttpRequestException("offline"));
        var launcher = LauncherCapturing(out var opened);
        var vm = new LearningCalendarViewModel(
            fixture.Schedule, fixture.PerekData, fixture.Navigator.Object, assets, launcher.Object);
        await vm.InitializeAsync();

        await vm.DownloadPdfCommand.ExecuteAsync(null);

        opened().Should().NotBeNull();
        opened()!.AbsoluteUri.Should().Contain("/api/calendar-pdf");
    }

    [Fact]
    public async Task DownloadPdfCommand_KeepsThePeriodSelectedAtClickTime()
    {
        await using var fixture = await CreateFixtureAsync(CyclesOneToFour);
        var gate = new TaskCompletionSource<Uri?>();
        var assets = new StubPdfAssets(_ => gate.Task);
        var launcher = LauncherCapturing(out var opened);
        var vm = new LearningCalendarViewModel(
            fixture.Schedule, fixture.PerekData, fixture.Navigator.Object, assets, launcher.Object);
        await vm.InitializeAsync();
        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(HebrewDateHelper.GetTodayDateNumber());

        var pending = vm.DownloadPdfCommand.ExecuteAsync(null);
        // Navigating mid-resolution must not swap the artifact being fetched.
        vm.NextMonthCommand.Execute(null);
        gate.SetResult(PublishedAsset);
        await pending;

        assets.Keys.Should().Equal($"month:{year * 100 + month}");
        opened().Should().Be(PublishedAsset);
    }

    [Fact]
    public void AppRoutes_CalendarRoutes_AreDistinctReaderAndFlyoutTargets()
    {
        // The calendar page is a flyout destination while the reader route is
        // pushed above it, and neither may collide with existing routes.
        AppRoutes.LearningCalendar.Should().Be("LearningCalendarPage");
        AppRoutes.CalendarReader.Should().Be("calendarReader");
        AppRoutes.CalendarReader.Should().NotBe(AppRoutes.Perek);
        AppRoutes.CalendarReader.Should().NotBe(AppRoutes.SearchReader);
    }
}
