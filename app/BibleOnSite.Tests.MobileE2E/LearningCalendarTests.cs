using BibleOnSite.Tests.MobileE2E.Pages;
using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// לוח לימוד יומי grouped views (#2595, #2600): week rows inside a mini-month
// must span the section width like the weekday header — HorizontalStackLayout
// ignored FillAndExpand on iOS and shrank them to a right-side strip. Row width
// alone is not enough: the day cells must also land on the seven RTL weekday
// columns below their matching headers, and each cell must sit under the
// weekday its real date falls on - not merely somewhere inside a full-width
// row. The harness's passing screenshots are also the rendered evidence for
// the fix.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class LearningCalendarTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    private static readonly string[] WeekdaysRightToLeft = ["א", "ב", "ג", "ד", "ה", "ו", "ש"];

    // Spoken weekday names the calendar announces in each day's accessibility
    // text; the index is the weekday (0=Sunday ... 6=Saturday).
    private static readonly string[] WeekdayNames =
        ["יום ראשון", "יום שני", "יום שלישי", "יום רביעי", "יום חמישי", "יום שישי", "שבת"];

    [Fact]
    public void YearViewWeekRowsFillTheirMiniMonth() => Scenario(() =>
    {
        var calendar = OpenCalendarIn("CalendarViewYear");
        var title = calendar.FirstInViewport("MiniMonthTitle").Frame;
        var week = calendar.FirstInViewport("MiniMonthWeek").Frame;
        Assert.True(
            week.Size.Width >= title.Size.Width * 0.9,
            $"Week row is {week.Size.Width}px wide inside a {title.Size.Width}px mini-month — " +
                "the collapsed-column regression renders roughly a third of the section width.");
    });

    [Fact]
    public void YearViewDayCellsAlignWithWeekdayColumns() => Scenario(() =>
    {
        AssertDayCellsFillWeekdayColumns(OpenCalendarIn("CalendarViewYear"));
    });

    [Fact]
    public void CycleViewDayCellsAlignWithWeekdayColumns() => Scenario(() =>
    {
        AssertDayCellsFillWeekdayColumns(OpenCalendarIn("CalendarViewCycle"));
    });

    // #2975: a mini cell's source must be a rendered label — the day's semantic
    // description already carried it, which never helped a sighted reader. The
    // old 24px date-only template has no MiniMonthDaySource element at all, so
    // these checks fail there by timeout rather than by a weak text match.
    [Fact]
    public void YearViewDayCellsShowPerekSources() => Scenario(() =>
    {
        AssertMiniCellsShowSources(OpenCalendarIn("CalendarViewYear", "MiniMonthDaySource", "MiniMonthReviewBadge"));
    });

    [Fact]
    public void CycleViewDayCellsShowPerekSources() => Scenario(() =>
    {
        AssertMiniCellsShowSources(OpenCalendarIn("CalendarViewCycle", "MiniMonthDaySource", "MiniMonthReviewBadge"));
    });

    private static void AssertMiniCellsShowSources(CalendarSnapshot calendar)
    {
        var source = calendar.FirstInViewport("MiniMonthDaySource");
        Assert.False(
            string.IsNullOrWhiteSpace(source.Text),
            "A mini-cell source label rendered but carried no text.");

        var badge = calendar.FirstInViewport("MiniMonthReviewBadge");
        Assert.Equal("חזרה", badge.Text);

        // The taller cells must still land centered under their weekday columns.
        AssertDayCellsFillWeekdayColumns(calendar);
    }

    private CalendarSnapshot OpenCalendarIn(string viewButton, params string[] extraIds)
    {
        Assert.NotEmpty(Page.FirstPasuk);
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutLearningCalendar");
        Page.Tap(viewButton);
        return CalendarSnapshot.WaitFor(Driver!, Platform,
            ["MiniMonthTitle", "MiniMonthWeek", "MiniMonthWeekday", "MiniMonthDayText", .. extraIds]);
    }

    private static void AssertDayCellsFillWeekdayColumns(CalendarSnapshot calendar)
    {
        var title = calendar.FirstInViewport("MiniMonthTitle").Frame;
        var week = calendar.FirstInViewport("MiniMonthWeek").Frame;
        Assert.True(
            week.Size.Width >= title.Size.Width * 0.9,
            $"Week row is {week.Size.Width}px wide inside a {title.Size.Width}px mini-month — " +
                "the collapsed-column regression renders roughly a third of the section width.");

        // Readiness and all labels came from the same fresh native tree,
        // after BindableLayout realized headers and days. No per-label native
        // enrichment or property queries run between these assertions.

        // Any rendered header row gives the same seven column positions: every
        // mini-month is built from the identical template on one shared width.
        var headerRow = calendar.Rendered("MiniMonthWeekday")
            .GroupBy(header => header.Frame.Location.Y)
            .OrderBy(group => group.Key)
            .Select(group => group.ToArray())
            // A row clipped by the scroll edge reports fewer than seven labels.
            // The first complete row speaks for every section on the shared width.
            .FirstOrDefault(group => group.Length == 7) ?? [];
        Assert.Equal(7, headerRow.Length);

        // RTL: the Sunday column (א) is rightmost, Saturday (ש) leftmost.
        var rightToLeft = headerRow
            .OrderByDescending(header => CenterX(header.Frame))
            .Select(header => header.Text)
            .ToArray();
        Assert.Equal(WeekdaysRightToLeft, rightToLeft);

        var columns = headerRow.Select(header => CenterX(header.Frame)).OrderBy(x => x).ToArray();
        // A correct cell lands dead-center under its column; a collapsed strip's
        // cells sit a full column pitch away. Anchor the tolerance to the column
        // pitch rather than any single element's reported width.
        var columnPitch = columns.Zip(columns.Skip(1), (a, b) => b - a).Average();
        var tolerance = columnPitch * 0.4;

        // Every rendered day cell must sit centered under a weekday column, and
        // a whole month exercises all seven — a collapsed right-side strip maps
        // every cell onto one or two columns instead. The label is centered in
        // its cell, so its frame marks the cell's column.
        var dayLabels = calendar.Rendered("MiniMonthDayText")
            .Select(day => (Description: day.Text, day.Frame))
            .ToArray();
        Assert.NotEmpty(dayLabels);
        var usedColumns = new HashSet<int>();
        foreach (var center in dayLabels.Select(day => CenterX(day.Frame)))
        {
            var column = Array.FindIndex(columns, x => Math.Abs(x - center) <= tolerance);
            Assert.True(column >= 0,
                $"Day cell centered at x={center:F0} aligns with no weekday column " +
                    $"({string.Join(", ", columns.Select(x => x.ToString("F0")))}).");
            usedColumns.Add(column);
        }
        Assert.Equal(7, usedColumns.Count);

        // Absolute weekday anchor: every day label announces the weekday of its
        // real date ("יום ראשון"/"שבת" prefix, independent of its grid slot), so
        // a self-consistent slide - days moved one column while still filling
        // all seven - fails where the announced weekday does not match the
        // header the cell rendered under.
        foreach (var day in dayLabels)
        {
            var spoken = day.Description.Split(',', 2)[0].Trim();
            var weekday = Array.IndexOf(WeekdayNames, spoken);
            Assert.True(weekday >= 0,
                $"Day cell accessibility text '{day.Description}' does not open with a weekday name.");
            var center = CenterX(day.Frame);
            Assert.True(
                Math.Abs(center - columns[6 - weekday]) <= tolerance,
                $"Day cell for {spoken} centered at x={center:F0}, expected under weekday column " +
                    $"x={columns[6 - weekday]:F0} ({string.Join(", ", columns.Select(x => x.ToString("F0")))}).");
        }
    }

    private static double CenterX((System.Drawing.Point Location, System.Drawing.Size Size) frame) =>
        frame.Location.X + frame.Size.Width / 2.0;
}
