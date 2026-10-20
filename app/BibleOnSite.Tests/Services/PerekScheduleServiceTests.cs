using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

public class PerekScheduleServiceTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
    private static readonly string[] Schema =
    [
        "CREATE TABLE tanah_perek_date (perek_id INTEGER, cycle INTEGER, date TEXT, hebdate TEXT, star_rise TEXT)"
    ];

    // Canonical schedule slice: cycle 1 opens Sunday 29 Kislev 5775 and its
    // first study week assigns perakim 1-5 to Sun-Thu.
    private static readonly string[] CycleOne =
    [
        "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
        "INSERT INTO tanah_perek_date VALUES (2,1,'57750330','57750330','17:17')",
        "INSERT INTO tanah_perek_date VALUES (3,1,'57750401','57750401','17:17')",
        "INSERT INTO tanah_perek_date VALUES (4,1,'57750402','57750402','17:18')",
        "INSERT INTO tanah_perek_date VALUES (5,1,'57750403','57750403','17:19')"
    ];

    private static async Task<(PerekScheduleService Service, TestStorage Storage)> CreateServiceAsync(
        params string[] inserts)
    {
        var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        foreach (var insert in inserts)
        {
            await db.ExecuteAsync(insert);
        }
        var service = new PerekScheduleService(new LocalDatabaseService(storage.FileSystem.Object));
        return (service, storage);
    }

    [Fact]
    public async Task Load_LoadsConfirmedCyclesFromRows()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16'),(1,2,'57781103','57781103','20:24'),(1,3,'57821305','57821305','17:52')");
        var service = new PerekScheduleService(new LocalDatabaseService(storage.FileSystem.Object));

        service.IsLoaded.Should().BeFalse();
        await service.LoadAsync();

        service.IsLoaded.Should().BeTrue();
        service.ConfirmedCycleCount.Should().Be(3);
    }

    [Fact]
    public async Task ResolveDay_ScheduledDate_ReturnsExactStudyPerek()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        var day = service.ResolveDay(57750330);

        day.Status.Should().Be(PerekScheduleService.DayStatus.Study);
        day.PerekId.Should().Be(2);
        day.Cycle.Should().Be(1);
        day.Projected.Should().BeFalse();
        day.DayOfWeek.Should().Be(1); // Monday
    }

    [Fact]
    public async Task ResolveDay_WeekendInsideCycle_ReviewsPreviousPerek()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        // 4-5 Tevet 5775 are the Friday/Saturday after the first study week:
        // they review Thursday's perek 5 instead of assigning a new one.
        service.ResolveDay(57750404).Should().BeEquivalentTo(new
        {
            Status = PerekScheduleService.DayStatus.Review,
            PerekId = 5,
            Cycle = (int?)1
        });
        service.ResolveDay(57750405).Should().BeEquivalentTo(new
        {
            Status = PerekScheduleService.DayStatus.Review,
            PerekId = 5,
            Cycle = (int?)1
        });
    }

    [Fact]
    public async Task ResolveDay_NonWeekendGapInsideCycle_ReviewsPreviousPerek()
    {
        var (service, storage) = await CreateServiceAsync(
            "INSERT INTO tanah_perek_date VALUES (895,9,'58070229','58070229','18:00')",
            "INSERT INTO tanah_perek_date VALUES (896,9,'58070303','58070303','18:00')",
            "INSERT INTO tanah_perek_date VALUES (1,9,'58030920','58030920','20:16')");
        await using var _ = storage;
        await service.LoadAsync();

        // Cycle 9 skips several days between perek 895 and 896; the skipped
        // days are review days of perek 895, not unscheduled days.
        foreach (var day in new[] { 58070230, 58070301, 58070302 }.Select(service.ResolveDay))
        {
            day.Status.Should().Be(PerekScheduleService.DayStatus.Review);
            day.PerekId.Should().Be(895);
            day.Cycle.Should().Be(9);
        }
        service.ResolveDay(58070303).PerekId.Should().Be(896);
    }

    [Fact]
    public async Task ResolveDay_ScheduledSaturday_StaysStudyDay()
    {
        // Canonical cycle-9 anomaly: part of the cycle shifts to a
        // Saturday-Wednesday week. 2 Kislev 5806 (a Saturday) assigns
        // perek 621 — it must stay a study day, not become a review day.
        var (service, storage) = await CreateServiceAsync(
            "INSERT INTO tanah_perek_date VALUES (1,9,'58030920','58030920','20:16')",
            "INSERT INTO tanah_perek_date VALUES (620,9,'58060229','58060229','18:00')",
            "INSERT INTO tanah_perek_date VALUES (621,9,'58060302','58060302','18:00')");
        await using var _ = storage;
        await service.LoadAsync();

        var saturday = service.ResolveDay(58060302);
        saturday.DayOfWeek.Should().Be(6);
        saturday.Status.Should().Be(PerekScheduleService.DayStatus.Study);
        saturday.PerekId.Should().Be(621);
        saturday.Cycle.Should().Be(9);

        // The Friday inside that shifted week still reviews Thursday.
        var friday = service.ResolveDay(58060301);
        friday.DayOfWeek.Should().Be(5);
        friday.Status.Should().Be(PerekScheduleService.DayStatus.Review);
        friday.PerekId.Should().Be(620);
    }

    [Fact]
    public async Task ResolveDay_BetweenCycles_IsUnscheduled()
    {
        var (service, storage) = await CreateServiceAsync(
            "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
            "INSERT INTO tanah_perek_date VALUES (1,2,'57781103','57781103','20:24')");
        await using var _ = storage;
        await service.LoadAsync();

        // Cycle 1 ends 1298 days after its start; the next 3 days are a gap.
        // The fixture stores only perek 1, so the end day reviews it.
        var cycle1End = HebrewDateHelper.AddDays(57750329, PerekScheduleService.CycleDays - 1);
        service.ResolveDay(cycle1End).Status.Should().Be(PerekScheduleService.DayStatus.Review);
        for (var offset = 1; offset <= 3; offset++)
        {
            var gap = service.ResolveDay(HebrewDateHelper.AddDays(cycle1End, offset));
            gap.Status.Should().Be(PerekScheduleService.DayStatus.None);
            gap.PerekId.Should().BeNull();
        }
        service.ResolveDay(57781103).Should().BeEquivalentTo(new
        {
            Status = PerekScheduleService.DayStatus.Study,
            PerekId = 1,
            Cycle = (int?)2
        });
    }

    [Fact]
    public async Task ResolveDay_BeforeProgram_IsUnscheduled()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        service.ResolveDay(57750328).Status.Should().Be(PerekScheduleService.DayStatus.None);
        service.ResolveDay(55000101).Status.Should().Be(PerekScheduleService.DayStatus.None);
    }

    [Fact]
    public async Task ResolveDay_BeyondConfirmedData_ProjectsCycles()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        var cycle2 = service.GetCycle(2);
        cycle2.Projected.Should().BeTrue();
        HebrewDateHelper.DaysBetween(57750329, cycle2.StartDate)
            .Should().Be(PerekScheduleService.CycleSpanDays);

        // Projected cycle starts on Sunday with perek 1.
        var first = service.ResolveDay(cycle2.StartDate);
        first.Should().BeEquivalentTo(new
        {
            Status = PerekScheduleService.DayStatus.Study,
            PerekId = 1,
            Cycle = (int?)2,
            Projected = true
        });
        first.DayOfWeek.Should().Be(0);

        // Its Friday reviews Thursday's perek.
        var friday = service.ResolveDay(HebrewDateHelper.AddDays(cycle2.StartDate, 5));
        friday.Status.Should().Be(PerekScheduleService.DayStatus.Review);
        friday.Projected.Should().BeTrue();

        // Projected inter-cycle gap is unscheduled.
        var gap = service.ResolveDay(HebrewDateHelper.AddDays(cycle2.StartDate, PerekScheduleService.CycleDays));
        gap.Status.Should().Be(PerekScheduleService.DayStatus.None);
        gap.PerekId.Should().BeNull();
    }

    [Fact]
    public async Task BuildMonth_PadsLeadingBlanksAndResolvesDays()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        // 1 Kislev 5775 was a Sunday: no leading blanks; 29 Kislev is cycle start.
        var cells = service.BuildMonth(5775, 3);
        cells[0].Day.Should().NotBeNull();
        cells[0].Day!.DateNumber.Should().Be(57750301);
        cells.Should().HaveCountGreaterThanOrEqualTo(29);
        var cycleStart = cells.First(c => c.Day?.DateNumber == 57750329).Day!;
        cycleStart.Status.Should().Be(PerekScheduleService.DayStatus.Study);
        cycleStart.PerekId.Should().Be(1);
        cycleStart.DayOfMonth.Should().Be(29);
    }

    [Fact]
    public async Task BuildMonth_LeapYearBuildsAdarIAndAdarII()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        foreach (var month in new[] { 13, 14 })
        {
            var days = service.BuildMonth(5784, month)
                .Where(c => c.Day is not null)
                .Select(c => c.Day!)
                .ToList();
            days.Should().NotBeEmpty();
            days.Should().OnlyContain(d =>
                HebrewDateHelper.NumberToHebrewDate(d.DateNumber).Month == month);
        }
    }

    [Fact]
    public async Task GetCycleForDateOrUpcoming_GapDay_ReturnsNextCycle()
    {
        var (service, storage) = await CreateServiceAsync(
            "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
            "INSERT INTO tanah_perek_date VALUES (1,2,'57781103','57781103','20:24')");
        await using var _ = storage;
        await service.LoadAsync();

        var cycle1End = HebrewDateHelper.AddDays(57750329, PerekScheduleService.CycleDays - 1);
        var gap = HebrewDateHelper.AddDays(cycle1End, 1);
        service.GetCycleForDate(gap).Should().BeNull();
        service.GetCycleForDateOrUpcoming(gap).Number.Should().Be(2);
        service.GetCycleForDateOrUpcoming(57750328).Number.Should().Be(1);
    }

    [Fact]
    public async Task GetDisplayedCycle_ReturnsCycleOfMonth()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        var cells = service.BuildMonth(5775, 3);
        service.GetDisplayedCycle(cells)!.Number.Should().Be(1);
    }

    [Fact]
    public async Task ResolveDay_ThrowsWhenNotLoaded()
    {
        var (service, storage) = await CreateServiceAsync();
        await using var _ = storage;

        var act = () => service.ResolveDay(57750301);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public async Task LoadAsync_SecondCall_ReturnsWithoutReloading()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;

        await service.LoadAsync();
        // A loaded service short-circuits before touching the database again.
        var act = () => service.LoadAsync();
        await act.Should().NotThrowAsync();
        service.ConfirmedCycleCount.Should().Be(1);
    }

    [Fact]
    public async Task LoadAsync_ConcurrentCalls_LoadOnceAndAgree()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;

        // Racing callers exercise the double-checked lock: all pass the first
        // unloaded check, then losers see _isLoaded inside the semaphore.
        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => service.LoadAsync()));

        service.IsLoaded.Should().BeTrue();
        service.ConfirmedCycleCount.Should().Be(1);
    }

    [Fact]
    public async Task LoadAsync_MissingScheduleTable_LoadsAsEmpty()
    {
        // A database without tanah_perek_date at all (old/test installs)
        // loads as an empty schedule instead of failing.
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(DbName, "CREATE TABLE dummy (id INTEGER)");
        var service = new PerekScheduleService(new LocalDatabaseService(storage.FileSystem.Object));

        await service.LoadAsync();

        service.IsLoaded.Should().BeTrue();
        service.ConfirmedCycleCount.Should().Be(0);
        service.LastConfirmedCycleNumber.Should().Be(0);
        service.GetCycleForDate(57750329).Should().BeNull();
        service.GetCycleForDateOrUpcoming(57750329).Should()
            .BeEquivalentTo(new PerekScheduleService.StudyCycle(1, 0, 0, true));
        var act = () => service.GetCycle(1);
        act.Should().Throw<InvalidOperationException>().WithMessage("*confirmed*");
    }

    [Fact]
    public async Task LoadAsync_SkipsMalformedRows()
    {
        var (service, storage) = await CreateServiceAsync(
            "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
            // Null date, wrong length, non-numeric, and a numeric value that is
            // not a real Hebrew date are all skipped, leaving one valid cycle.
            "INSERT INTO tanah_perek_date VALUES (2,1,NULL,NULL,NULL)",
            "INSERT INTO tanah_perek_date VALUES (3,1,'2024-01-01','x','17:16')",
            "INSERT INTO tanah_perek_date VALUES (4,1,'ABCDEFGH','x','17:16')",
            "INSERT INTO tanah_perek_date VALUES (5,1,'99999999','x','17:16')");
        await using var _ = storage;

        await service.LoadAsync();

        service.ConfirmedCycleCount.Should().Be(1);
        service.ResolveDay(57750329).PerekId.Should().Be(1);
        service.ResolveDay(57750330).Status.Should().Be(PerekScheduleService.DayStatus.Review);
    }

    [Fact]
    public async Task LoadAsync_CycleWithoutPerekOne_StartsAtFirstStoredEntry()
    {
        var (service, storage) = await CreateServiceAsync(
            "INSERT INTO tanah_perek_date VALUES (5,1,'57750329','57750329','17:16')",
            "INSERT INTO tanah_perek_date VALUES (9,1,'57750330','57750330','17:16')");
        await using var _ = storage;
        await service.LoadAsync();

        // No perek 1 row: the cycle starts on its earliest perek-id entry.
        service.GetCycle(1).StartDate.Should().Be(57750329);
    }

    [Fact]
    public async Task GetCycle_InvalidNumber_Throws()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        var act = () => service.GetCycle(0);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public async Task GetCycle_BeforeFirstConfirmed_ProjectsBackward()
    {
        var (service, storage) = await CreateServiceAsync(
            "INSERT INTO tanah_perek_date VALUES (1,2,'57781103','57781103','20:24')");
        await using var _ = storage;
        await service.LoadAsync();

        // Cycle 1 precedes the earliest confirmed anchor: project backward on
        // the same 1302-day cadence.
        var cycle1 = service.GetCycle(1);
        cycle1.Projected.Should().BeTrue();
        HebrewDateHelper.DaysBetween(cycle1.StartDate, 57781103)
            .Should().Be(PerekScheduleService.CycleSpanDays);
    }

    [Fact]
    public async Task GetCycleForDateOrUpcoming_ScheduledDate_ReturnsOwningCycle()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        service.GetCycleForDateOrUpcoming(57750330).Number.Should().Be(1);
    }

    [Fact]
    public async Task GetCycleForDateOrUpcoming_GapAfterLastConfirmed_WalksProjectedCycles()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        // The 3-day gap after cycle 1 resolves to projected cycle 2...
        var cycle1End = HebrewDateHelper.AddDays(57750329, PerekScheduleService.CycleDays - 1);
        var gap = HebrewDateHelper.AddDays(cycle1End, 1);
        service.GetCycleForDate(gap).Should().BeNull();
        service.GetCycleForDateOrUpcoming(gap).Should().BeEquivalentTo(new
        {
            Number = 2,
            Projected = true
        });

        // ...and a date inside a projected gap further ahead iterates the walk
        // until it finds the following projected cycle.
        var cycle3 = service.GetCycle(3);
        var gap2 = HebrewDateHelper.AddDays(cycle3.StartDate, -2);
        service.GetCycleForDateOrUpcoming(gap2).Number.Should().Be(3);
    }

    [Fact]
    public async Task ResolveDay_EndOfProjectedCycle_AssignsFinalPerakim()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        var cycle2 = service.GetCycle(2);
        // The last study week of a projected cycle ends on day 1298 (a
        // Thursday) with perek 929; no day can run past the cycle's perakim.
        var last = service.ResolveDay(HebrewDateHelper.AddDays(cycle2.StartDate, PerekScheduleService.CycleDays - 1));
        last.Status.Should().Be(PerekScheduleService.DayStatus.Study);
        last.PerekId.Should().Be(PerekScheduleService.PerakimPerCycle);
        last.Cycle.Should().Be(2);
        last.Projected.Should().BeTrue();
    }

    [Fact]
    public async Task GetDisplayedCycle_UnscheduledMonth_ReturnsNull()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;
        await service.LoadAsync();

        // Cheshvan 5775 ends before cycle 1 starts on 29 Kislev.
        var cells = service.BuildMonth(5775, 2);
        cells.Should().OnlyContain(c => c.Day == null || c.Day.Cycle == null);
        service.GetDisplayedCycle(cells).Should().BeNull();
    }

    [Fact]
    public async Task GetTodaysPerekId_BeforeLoad_ReturnsDefault()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;

        service.LastConfirmedCycleNumber.Should().Be(0);
        service.GetTodaysPerekId().Should().Be(1);
    }

[Fact]
    public async Task LastConfirmedCycleNumber_IsZeroBeforeLoad()
    {
        var (service, storage) = await CreateServiceAsync(CycleOne);
        await using var _ = storage;

        service.LastConfirmedCycleNumber.Should().Be(0);
    }

    [Fact]
    public async Task GetCycle_WithNoConfirmedRows_Throws()
    {
        var (service, storage) = await CreateServiceAsync();
        await using var _ = storage;
        await service.LoadAsync();

        var act = () => service.GetCycle(5);

        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public async Task GetCycleForDateOrUpcoming_AfterAllConfirmedCycles_ReturnsTheLastCycle()
    {
        var (service, storage) = await CreateServiceAsync([..CycleOne,
            "INSERT INTO tanah_perek_date VALUES (6,2,'57781101','57781101','20:25')"]);
        await using var _ = storage;
        await service.LoadAsync();

        var upcoming = service.GetCycleForDateOrUpcoming(58000101);

        upcoming.Projected.Should().BeTrue();
        upcoming.Number.Should().BeGreaterThan(2);
    }
}
