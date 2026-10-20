using System.Diagnostics;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using FluentAssertions;
using Xunit;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// Regression checks for #2455 (לוח לימוד יומי performance): resolving a whole
/// cycle's days and rebuilding calendar periods must stay cheap, and repeated
/// resolution must reuse prior work instead of recomputing every day.
/// </summary>
public class PerekSchedulePerformanceTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
    private static readonly string[] Schema =
    [
        "CREATE TABLE tanah_perek_date (perek_id INTEGER, cycle INTEGER, date TEXT, hebdate TEXT, star_rise TEXT)"
    ];

    // Real cycle starts (same data as production tanah_perek_date).
    private static readonly int[] CycleStarts =
    [
        57750329, 57781103, 57821305, 57851207,
        57890709, 57930212, 57960814, 58000317, 58030920, 58070422,
    ];

    /// <summary>Seeds all 10 confirmed cycles with the full 929-perakim schedule.</summary>
    private static async Task<PerekScheduleService> CreateFullScheduleAsync(TestStorage storage)
    {
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        var inserts = new List<string>();
        foreach (var (cycleIndex, start) in CycleStarts.Select((s, i) => (i + 1, s)))
        {
            for (var perek = 1; perek <= 929; perek++)
            {
                // Sun-Thu study layout used by the real data: 5 study days/week.
                var index = perek - 1;
                var offset = (index / 5) * 7 + (index % 5);
                var date = HebrewDateHelper.AddDays(start, offset);
                inserts.Add($"({perek},{cycleIndex},'{date}','{date}','18:00')");
            }
        }
        foreach (var batch in inserts.Chunk(400))
        {
            await db.ExecuteAsync(
                "INSERT INTO tanah_perek_date (perek_id, cycle, date, hebdate, star_rise) VALUES " +
                string.Join(',', batch));
        }
        return new PerekScheduleService(new LocalDatabaseService(storage.FileSystem.Object));
    }

    private static IEnumerable<(int Year, int Month)> MonthsOfCycle(int startDate, int endDate)
    {
        var (year, month, _) = HebrewDateHelper.NumberToHebrewDate(startDate);
        var (endYear, endMonth, _) = HebrewDateHelper.NumberToHebrewDate(endDate);
        while (year < endYear || (year == endYear && month != endMonth))
        {
            yield return (year, month);
            (year, month) = HebrewDateHelper.NextMonth(year, month);
        }
        yield return (endYear, endMonth);
    }

    [Fact]
    public async Task ResolveDay_FullCycle_StaysWithinTimeBudget()
    {
        await using var storage = new TestStorage();
        var service = await CreateFullScheduleAsync(storage);
        await service.LoadAsync();

        var cycle = service.GetCycle(1);
        var watch = Stopwatch.StartNew();
        var resolved = 0;
        for (var offset = 0; offset < PerekScheduleService.CycleDays; offset++)
        {
            service.ResolveDay(HebrewDateHelper.AddDays(cycle.StartDate, offset));
            resolved++;
        }
        watch.Stop();

        resolved.Should().Be(1299);
        Assert.True(watch.ElapsedMilliseconds < 500,
            $"Resolving a full cycle took {watch.ElapsedMilliseconds}ms (budget 500ms).");
    }

    [Fact]
    public async Task ResolveDay_RepeatCall_ReturnsCachedDay()
    {
        await using var storage = new TestStorage();
        var service = await CreateFullScheduleAsync(storage);
        await service.LoadAsync();

        service.ResolveDay(57750404).Should().BeSameAs(service.ResolveDay(57750404),
            "re-resolving an unchanged day should reuse the cached result");
    }

    [Fact]
    public async Task BuildMonth_RepeatCalls_ReturnCachedCells()
    {
        await using var storage = new TestStorage();
        var service = await CreateFullScheduleAsync(storage);
        await service.LoadAsync();

        var first = service.BuildMonth(5775, 4);
        var second = service.BuildMonth(5775, 4);

        ReferenceEquals(first, second).Should().BeTrue(
            "rebuilding an unchanged month should reuse the cached cells");
    }

    [Fact]
    public async Task BuildMonth_WholeCycle_ScaleLinearlyNotQuadratically()
    {
        await using var storage = new TestStorage();
        var service = await CreateFullScheduleAsync(storage);
        await service.LoadAsync();

        var cycle = service.GetCycle(1);
        var watch = Stopwatch.StartNew();
        var months = 0;
        foreach (var (year, month) in MonthsOfCycle(cycle.StartDate, cycle.EndDate))
        {
            service.BuildMonth(year, month);
            months++;
        }
        watch.Stop();

        months.Should().BeGreaterThan(40);
        Assert.True(watch.ElapsedMilliseconds < 1000,
            $"Building {months} months of a full cycle took {watch.ElapsedMilliseconds}ms (budget 1000ms).");
    }

    [Fact]
    public async Task GetCycleForDate_FarFutureDate_ProjectsWithoutWalkingEveryCycle()
    {
        await using var storage = new TestStorage();
        var service = await CreateFullScheduleAsync(storage);
        await service.LoadAsync();

        // A date ~50 cycles past the confirmed data must not iterate one
        // projected cycle at a time (each iteration cost Hebrew conversions).
        var farDate = HebrewDateHelper.AddDays(CycleStarts[^1], 50 * PerekScheduleService.CycleSpanDays);
        var watch = Stopwatch.StartNew();
        var cycle = service.GetCycleForDate(farDate);
        watch.Stop();

        cycle.Should().NotBeNull();
        Assert.True(watch.ElapsedMilliseconds < 50,
            $"Projecting a far-future cycle took {watch.ElapsedMilliseconds}ms (budget 50ms).");
    }
}
