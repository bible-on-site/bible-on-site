using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

public class PerekDataServiceTests
{
    private const string DbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
    internal static readonly string[] Schema =
    [
        "CREATE TABLE tanah_sefer (id INTEGER, name TEXT, tanach_us_name TEXT, perek_id_from INTEGER, perek_id_to INTEGER)",
        "CREATE TABLE tanah_perek (id INTEGER, perek INTEGER, header TEXT)",
        "CREATE TABLE tanah_additional (id INTEGER, sefer_id INTEGER, perek_from INTEGER, perek_to INTEGER, letter TEXT, tanach_us_name TEXT)",
        "CREATE TABLE tanah_perek_date (perek_id INTEGER, cycle INTEGER, date TEXT, hebdate TEXT, star_rise TEXT)",
        "CREATE TABLE tanah_pasuk_segment (id INTEGER, perek_id INTEGER, pasuk_id INTEGER, segment_type TEXT)",
        "CREATE TABLE tanah_pasuk_segment_value (id INTEGER, value TEXT)",
        "CREATE TABLE tanah_pasuk_segment_qri_ktiv_offset (id INTEGER, qri_ktiv_offset INTEGER)"
    ];

    [Fact]
    public async Task Load_MapsSplitBooks_UsesLatestCycle_AndCachesResults()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,50),(8,'שמואל','{\"א\":\"I_Samuel\",\"ב\":\"II_Samuel\"}',51,55),(9,NULL,'{}',56,56)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,'Creation'),(51,1,NULL),(52,2,'Second'),(56,1,NULL)");
        await db.ExecuteAsync("INSERT INTO tanah_additional VALUES (1,8,51,52,'א','I_Samuel')");
        await db.ExecuteAsync("INSERT INTO tanah_perek_date VALUES (1,1,'20240101','57840101','18:00'),(1,2,'2026-10-02T00:00:00','57870121','18:30')");
        var service = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        service.IsLoaded.Should().BeFalse();
        service.Perakim.Should().BeNull();
        service.GetPerek(1).Should().BeNull();
        service.GetPerekSource(1).Should().BeNull();
        service.GetTodaysPerekId().Should().Be(1);
        await service.LoadAsync();
        service.IsLoaded.Should().BeTrue();
        service.Perakim.Should().HaveCount(4);
        var first = service.GetPerek(1)!;
        first.Date.Should().Be("2026-10-02");
        first.HebDateNumeric.Should().Be(57870121);
        first.Tseit.Should().Be("18:30");
        first.Header.Should().Be("Creation");
        first.SeferTanahUsName.Should().Be("Genesis");
        first.HasRecording.Should().BeFalse();
        service.GetPerekSource(1).Should().Be("בראשית א");
        var split = service.GetPerek(52)!;
        split.PerekNumber.Should().Be(2);
        split.Additional.Should().Be(1);
        split.SeferTanahUsName.Should().Be("I_Samuel");
        split.Date.Should().BeEmpty();
        split.HebDate.Should().BeEmpty();
        split.HebDateNumeric.Should().Be(0);
        split.Tseit.Should().BeEmpty();
        service.GetPerekSource(52).Should().Be("שמואל א ב");
        service.GetPerek(56)!.SeferName.Should().BeEmpty();
        service.GetPerek(56)!.SeferTanahUsName.Should().Be("{}");
        service.GetTodaysPerekId().Should().BeInRange(1, 56);
        await db.ExecuteAsync("DELETE FROM tanah_perek");
        await service.LoadAsync();
        service.GetPerek(1).Should().BeSameAs(first, "a completed load is cached");
    }

    [Theory]
    [InlineData("א", 1)] [InlineData("ב", 2)] [InlineData("ג", 3)] [InlineData("ד", 4)]
    [InlineData("ה", 5)] [InlineData("ו", 6)] [InlineData("ז", 7)] [InlineData("ח", 8)]
    [InlineData("ט", 9)] [InlineData("י", 10)] [InlineData("unknown", null)] [InlineData(" ", null)]
    public async Task Load_ParsesAdditionalBookLetters(string letter, int? expected)
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'Book','Book',1,1)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL)");
        await db.ExecuteAsync("INSERT INTO tanah_additional VALUES (1,1,1,1,?,NULL)", letter);
        var service = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        await service.LoadAsync();
        service.GetPerek(1)!.Additional.Should().Be(expected);
        service.GetPerek(1)!.SeferTanahUsName.Should().Be("Book");
    }

    public static IEnumerable<object[]> Dates()
    {
        string[] leap = ["תשרי", "חשוון", "כסלו", "טבת", "שבט", "אדר ב", "ניסן", "אייר", "סיון", "תמוז", "אב", "אלול", "אדר א", "אדר ב"];
        string[] common = ["תשרי", "חשוון", "כסלו", "טבת", "שבט", "אדר", "ניסן", "אייר", "סיון", "תמוז", "אב", "אלול"];
        for (var month = 1; month <= leap.Length; month++) yield return [$"5784{month:00}01", $"א {leap[month - 1]} תשפד", int.Parse($"5784{month:00}01")];
        for (var month = 1; month <= common.Length; month++) yield return [$"5785{month:00}01", $"א {common[month - 1]} תשפה", int.Parse($"5785{month:00}01")];
        yield return ["57841501", "57841501", 57841501];
        yield return ["57851301", "57851301", 57851301];
        yield return ["nonnumer", "nonnumer", 0];
        yield return ["short", "short", 0];
        yield return [" ", "", 0];
    }

    [Theory]
    [MemberData(nameof(Dates))]
    public async Task Load_FormatsHebrewDatesForLeapAndCommonYears(string date, string expected, int numeric)
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'Book','Book',1,1)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL)");
        await db.ExecuteAsync("INSERT INTO tanah_perek_date VALUES (1,1,'20261002',?,NULL)", date);
        var service = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        await service.LoadAsync();
        service.GetPerek(1)!.HebDate.Should().Be(expected);
        service.GetPerek(1)!.HebDateNumeric.Should().Be(numeric);
        service.GetPerek(1)!.Date.Should().Be("2026-10-02");
    }

    [Fact]
    public async Task Load_UsesEveryLeapYearPositionInTheCalendarCycle()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'Book','Book',1,7)");
        int[] years = [5782, 5784, 5787, 5790, 5793, 5795, 5798];
        for (var i = 0; i < years.Length; i++)
        {
            await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (?,1,NULL)", i + 1);
            await db.ExecuteAsync("INSERT INTO tanah_perek_date VALUES (?,1,'short',?,NULL)", i + 1, $"{years[i]}1301");
        }
        var service = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        await service.LoadAsync();
        foreach (var perek in service.Perakim!.Values)
        {
            perek.HebDate.Should().Contain("אדר א");
            perek.Date.Should().Be("short");
        }
    }

    [Fact]
    public async Task Pasukim_GroupOrderedSegments_PreserveQriKtivOffsets_AndRespectMaqafAndParagraphs()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(DbName, Schema);
        await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment VALUES (1,1,1,'ptuha'),(2,1,1,'ktiv'),(3,1,1,'qri'),(4,1,1,'qri'),(5,1,1,'stuma'),(6,1,1,'ptuha'),(7,1,1,'qri'),(8,1,1,'qri'),(9,1,1,'unknown'),(10,1,2,'qri'),(11,2,1,'qri')");
        await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment_value VALUES (2,'כל־'),(3,'העם'),(4,'אמרו'),(7,'אמן'),(10,'סוף'),(11,'other perek')");
        await db.ExecuteAsync("INSERT INTO tanah_pasuk_segment_qri_ktiv_offset VALUES (2,1),(3,-1)");
        var service = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var verses = await service.LoadPasukimAsync(1);
        verses.Select(v => v.PasukNum).Should().Equal(1, 2);
        verses[0].Text.Should().Be("כל־העם אמרו\nאמן");
        verses[1].Text.Should().Be("סוף");
        verses[0].Segments.Should().HaveCount(9);
        verses[0].Segments![1].PairedOffset.Should().Be(1);
        verses[0].Segments[2].PairedOffset.Should().Be(-1);
        verses[0].Segments.Select(s => s.Type).Should().Equal(SegmentType.Ptuha, SegmentType.Ktiv,
            SegmentType.Qri, SegmentType.Qri, SegmentType.Stuma, SegmentType.Ptuha, SegmentType.Qri, SegmentType.Qri, SegmentType.Qri);
        verses[0].Segments[7].Value.Should().BeEmpty();
        (await service.LoadPasukimAsync(99)).Should().BeEmpty();
    }

    [Fact]
    public async Task Load_WithEmptyDatabase_ReturnsDefaultTodayAndEmptyDictionary()
    {
        await using var storage = new TestStorage();
        await storage.CreateDatabaseAsync(DbName, Schema);
        var service = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        await service.LoadAsync();
        service.Perakim.Should().BeEmpty();
        service.GetTodaysPerekId().Should().Be(1);
    }
}
