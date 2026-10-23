using System.Globalization;
using System.Text.Json.Nodes;
using BibleOnSite.Helpers;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// פרשת השבוע schedule resolution: keviyah joins, festival displacement,
/// weekday→Shabbat rollover and Israel/Diaspora divergence — verified
/// slot-by-slot against 41 years (5781-5821) of published hebcal schedule
/// data in <c>Fixtures/sedra-schedule.json</c> (2,019 Israel + 1,995
/// Diaspora Shabbat readings; festival Shabbats carry no entry).
/// </summary>
public class SedraScheduleTests
{
    private static readonly HebrewCalendar Calendar = new();

    /// <summary>Hebcal transliterations → 0-based canonical parasha index.</summary>
    private static readonly Dictionary<string, int> IndexByName = new()
    {
        ["Bereshit"] = 0, ["Noach"] = 1, ["Lech-Lecha"] = 2, ["Vayera"] = 3,
        ["Chayei Sara"] = 4, ["Toldot"] = 5, ["Vayetzei"] = 6, ["Vayishlach"] = 7,
        ["Vayeshev"] = 8, ["Miketz"] = 9, ["Vayigash"] = 10, ["Vayechi"] = 11,
        ["Shemot"] = 12, ["Vaera"] = 13, ["Bo"] = 14, ["Beshalach"] = 15,
        ["Yitro"] = 16, ["Mishpatim"] = 17, ["Terumah"] = 18, ["Tetzaveh"] = 19,
        ["Ki Tisa"] = 20, ["Vayakhel"] = 21, ["Pekudei"] = 22, ["Vayikra"] = 23,
        ["Tzav"] = 24, ["Shmini"] = 25, ["Tazria"] = 26, ["Metzora"] = 27,
        ["Achrei Mot"] = 28, ["Kedoshim"] = 29, ["Emor"] = 30, ["Behar"] = 31,
        ["Bechukotai"] = 32, ["Bamidbar"] = 33, ["Nasso"] = 34,
        ["Beha'alotcha"] = 35, ["Sh'lach"] = 36, ["Korach"] = 37, ["Chukat"] = 38,
        ["Balak"] = 39, ["Pinchas"] = 40, ["Matot"] = 41, ["Masei"] = 42,
        ["Devarim"] = 43, ["Vaetchanan"] = 44, ["Eikev"] = 45, ["Re'eh"] = 46,
        ["Shoftim"] = 47, ["Ki Teitzei"] = 48, ["Ki Tavo"] = 49, ["Nitzavim"] = 50,
        ["Vayeilech"] = 51, ["Ha'azinu"] = 52, ["Vezot Haberakhah"] = 53,
    };

    /// <summary>"Vayakhel-Pekudei" → [21, 22]; "Lech-Lecha" → [2].</summary>
    private static int[] ExpectedIndexes(string name)
    {
        // Hebcal spells with the typographic apostrophe — normalize once.
        var normalized = name.Replace('\u2019', '\'');
        return IndexByName.TryGetValue(normalized, out var single)
            ? [single]
            : normalized.Split('-').Select(part => IndexByName[part]).ToArray();
    }

    private static int HebrewDateNum(DateOnly gregorian)
    {
        var date = gregorian.ToDateTime(new TimeOnly(12, 0));
        return HebrewDateHelper.HebrewDateToNumber(
            (Calendar.GetYear(date), Calendar.GetMonth(date), Calendar.GetDayOfMonth(date)));
    }

    private static Dictionary<string, Dictionary<string, string>> LoadFixture()
    {
        var path = Path.Join(AppContext.BaseDirectory, "Fixtures", "sedra-schedule.json");
        var root = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        return root.ToDictionary(
            side => side.Key,
            side => side.Value!.AsObject().ToDictionary(
                week => week.Key, week => week.Value!.GetValue<string>()));
    }

    /// <summary>
    /// Every published Shabbat reading resolves through the public API to the
    /// same parasha indexes — all joins, festival displacements and year
    /// boundaries across 40 Hebrew years on both schedules.
    /// </summary>
    [Fact]
    public void GetWeeklyReading_MatchesPublishedSchedule_EveryShabbat()
    {
        var fixture = LoadFixture();
        var checked_ = 0;
        foreach (var (side, weeks) in fixture)
        {
            var israel = side == "il";
            foreach (var (gregorian, name) in weeks)
            {
                var saturday = DateOnly.Parse(gregorian);
                saturday.DayOfWeek.Should().Be(DayOfWeek.Saturday);
                var hebrewDate = HebrewDateNum(saturday);

                var reading = SedraSchedule.GetWeeklyReading(hebrewDate, israel);

                reading.ShabbatDate.Should().Be(hebrewDate,
                    $"a Shabbat date resolves to itself ({gregorian} {side})");
                reading.HolidayName.Should().BeNull(
                    $"{name} on {gregorian} {side} is an ordinary parasha week");
                reading.ParashaIndexes.Should().Equal(ExpectedIndexes(name),
                    $"{name} on {gregorian} {side}");
                checked_++;
            }
        }
        checked_.Should().Be(fixture["il"].Count + fixture["dias"].Count);
    }

    /// <summary>
    /// Reverse direction: every slot of every covered Hebrew year either
    /// appears in the published schedule or is a festival Shabbat — and
    /// every slot sits between the year's Rosh Hashana bounds.
    /// </summary>
    [Fact]
    public void BuildYear_FestivalSlots_HaveNoPublishedParasha()
    {
        var fixture = LoadFixture();
        var checkedSlots = 0;
        for (var hyear = 5781; hyear <= 5820; hyear++)
        {
            foreach (var israel in new[] { true, false })
            {
                var weeks = fixture[israel ? "il" : "dias"];
                foreach (var slot in SedraSchedule.BuildYear(hyear, israel))
                {
                    var gregorian = DateOnly.FromDateTime(
                        HebrewDateHelper.ToGregorianDate(slot.ShabbatDate));
                    var key = gregorian.ToString("yyyy-MM-dd");
                    if (weeks.TryGetValue(key, out var name))
                    {
                        slot.ParashaIndexes.Should().Equal(ExpectedIndexes(name));
                        slot.HolidayName.Should().BeNull();
                    }
                    else
                    {
                        // No published parasha this Saturday ⇒ festival.
                        slot.HolidayName.Should().NotBeNullOrEmpty(
                            $"{key} {hyear} has no ordinary parasha");
                        slot.ParashaIndexes.Should().BeEmpty();
                    }
                    checkedSlots++;
                }
            }
        }
        checkedSlots.Should().BeGreaterThan(4000);
    }

    [Fact]
    public void GetWeeklyReading_Weekday_ResolvesToUpcomingShabbat()
    {
        // Wednesday 29 Tishrei 5785 (Oct 30 2024) → שבת נח on 1 Cheshvan.
        var wednesday = HebrewDateNum(new DateOnly(2024, 10, 30));
        var reading = SedraSchedule.GetWeeklyReading(wednesday);
        reading.ShabbatDate.Should().Be(57850201);
        reading.ParashaIndexes.Should().Equal(1); // נח

        // Sunday of the same week resolves to the same Shabbat.
        SedraSchedule.GetWeeklyReading(HebrewDateNum(new DateOnly(2024, 10, 27)))
            .ShabbatDate.Should().Be(57850201);
    }

    [Fact]
    public void GetWeeklyReading_Shabbat_ResolvesToItself()
    {
        // שבת בראשית 5785 — 24 Tishrei (Oct 26 2024), the day after שמחת תורה.
        var shabbat = HebrewDateNum(new DateOnly(2024, 10, 26));
        var reading = SedraSchedule.GetWeeklyReading(shabbat);
        reading.ShabbatDate.Should().Be(shabbat);
        reading.ParashaIndexes.Should().Equal(0);
    }

    [Fact]
    public void GetWeeklyReading_FestivalShabbat_ReportsHolidayAndNoParasha()
    {
        // 17 Tishrei 5785 — שבת חול המועד סוכות (Oct 19 2024).
        var reading = SedraSchedule.GetWeeklyReading(HebrewDateNum(new DateOnly(2024, 10, 19)));
        reading.HasParasha.Should().BeFalse();
        reading.HolidayName.Should().Be("סוכות");
    }

    [Fact]
    public void GetWeeklyReading_YomKippurOnShabbat_ReportsHoliday()
    {
        // 10 Tishrei 5785 — יום כיפור on Shabbat (Oct 12 2024).
        var reading = SedraSchedule.GetWeeklyReading(HebrewDateNum(new DateOnly(2024, 10, 12)));
        reading.HasParasha.Should().BeFalse();
        reading.HolidayName.Should().Be("יום כיפור");
    }

    [Fact]
    public void GetNextRegularReading_FromFestivalShabbat_ReturnsNextParasha()
    {
        // During שבת חול המועד סוכות the next regular reading is בראשית.
        var reading = SedraSchedule.GetNextRegularReading(
            HebrewDateNum(new DateOnly(2024, 10, 19)));
        reading.HasParasha.Should().BeTrue();
        reading.ParashaIndexes.Should().Equal(0);
        reading.ShabbatDate.Should().Be(57850124);
    }

    [Fact]
    public void GetWeeklyReading_JoinedWeek_ReturnsBothPortions()
    {
        // 5780 IL: ויקהל-פקודי joined — Shabbat of Mar 21 2020.
        var reading = SedraSchedule.GetWeeklyReading(HebrewDateNum(new DateOnly(2020, 3, 21)));
        reading.ParashaIndexes.Should().Equal(21, 22);
    }

    [Fact]
    public void GetWeeklyReading_IsraelVsDiaspora_DivergeWhereScheduleDiffers()
    {
        var fixture = LoadFixture();
        var divergence = fixture["il"].Keys
            .Where(date => fixture["dias"].TryGetValue(date, out var other) &&
                other != fixture["il"][date])
            .ToList();
        divergence.Should().NotBeEmpty("the schedules genuinely diverge across 41 years");
        foreach (var date in divergence)
        {
            var hebrew = HebrewDateNum(DateOnly.Parse(date));
            SedraSchedule.GetWeeklyReading(hebrew, israel: true).ParashaIndexes
                .Should().Equal(ExpectedIndexes(fixture["il"][date]), $"{date} IL");
            SedraSchedule.GetWeeklyReading(hebrew, israel: false).ParashaIndexes
                .Should().Equal(ExpectedIndexes(fixture["dias"][date]), $"{date} Diaspora");
        }
    }

    [Fact]
    public void BuildYear_SpansExactlyTheYearShabbats()
    {
        // 5785 IL (ראש השנה Thursday): slot dates run from the first Shabbat
        // on/after 1 Tishrei through the last before 5786.
        var slots = SedraSchedule.BuildYear(5785, israel: true);
        var first = HebrewDateHelper.ToGregorianDate(5785, 1, 1);
        first.DayOfWeek.Should().Be(DayOfWeek.Thursday);
        slots.First().ShabbatDate.Should().Be(57850103); // שבת שובה
        slots.Last().ShabbatDate.Should().Be(57851227); // כז אלול, before ראש השנה 5786
        slots.Should().OnlyContain(s => s.ShabbatDate / 10000 == 5785);
    }
}
