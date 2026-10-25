using Xunit;

namespace BibleOnSite.Tests.MobileE2E;

// לוח לימוד יומי grouped views (#2595): week rows inside a mini-month must span
// the section width like the weekday header — HorizontalStackLayout ignored
// FillAndExpand on iOS and shrank them to a right-side strip. The harness's
// passing screenshot is also the rendered evidence for the fix.
[Collection("Mobile device")]
[Trait("Category", "MobileE2E")]
[Trait("Platform", "Shared")]
public sealed class LearningCalendarTests(ITestOutputHelper output, MobileDeviceSession session)
    : MobileDeviceTest(output, session)
{
    [Fact]
    public void YearViewWeekRowsFillTheirMiniMonth() => Scenario(() =>
    {
        Assert.NotEmpty(Page.FirstPasuk);
        Page.Tap(Platform.FlyoutButton);
        Page.Tap("FlyoutLearningCalendar");
        Page.Tap("CalendarViewYear");

        var title = Page.WaitFor("MiniMonthTitle");
        var week = Page.WaitFor("MiniMonthWeek");
        Assert.True(
            week.Size.Width >= title.Size.Width * 0.9,
            $"Week row is {week.Size.Width}px wide inside a {title.Size.Width}px mini-month — " +
                "the collapsed-column regression renders roughly a third of the section width.");
    });
}
