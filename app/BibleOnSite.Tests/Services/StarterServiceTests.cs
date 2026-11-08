using System.Reflection;
using BibleOnSite.Helpers;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using FluentAssertions;

namespace BibleOnSite.Tests.Services;

public class StarterServiceTests
{
    private const string CountersResponse = """
        {"data":{"starter":{"authors":[],"articles":[],
        "perekArticlesCounters":[3,0,1]}}}
        """;

    [Fact]
    public async Task GetPerekArticlesCount_ReadsStartupCountersWithBoundsGuard()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(CountersResponse);
        var service = new StarterService(http.Client, storage.FileSystem.Object);

        // Badge path before startup finishes: 0 instead of a network fetch.
        service.GetPerekArticlesCount(1).Should().Be(0);

        await service.LoadAsync();

        service.IsLoaded.Should().BeTrue();
        service.GetPerekArticlesCount(1).Should().Be(3);
        service.GetPerekArticlesCount(2).Should().Be(0);
        service.GetPerekArticlesCount(3).Should().Be(1);
        service.GetPerekArticlesCount(0).Should().Be(0, "perekId below 1 is out of range");
        service.GetPerekArticlesCount(4).Should().Be(0, "perekId beyond the counters length is out of range");
        http.Requests.Should().ContainSingle("the badge read never issues a second request");
    }

    [Fact]
    public void ApplyResponse_ShouldSortAuthorsAndLinkArticles()
    {
        var service = CreateService();
        var response = new StarterService.StarterResponse(
            new StarterService.StarterData(
                [
                    new StarterService.AuthorData(2, 1, "second", "Beta"),
                    new StarterService.AuthorData(1, 2, "first", "Alpha")
                ],
                [
                    new StarterService.ArticleData(10, 3, 2, null, "Linked", 7),
                    new StarterService.ArticleData(11, 3, 99, "kept", "Missing author", 1)
                ],
                [4, 0, 2]));

        ApplyResponse(service, response);

        service.Authors.Select(author => author.Name).Should().Equal("Alpha", "Beta");
        service.PerekArticlesCounters.Should().Equal(4, 0, 2);
        service.Articles.Should().HaveCount(2);
        service.Articles[0].Abstract.Should().BeEmpty();
        service.Articles[0].Author.Should().BeSameAs(service.Authors.Single(author => author.Id == 2));
        service.Articles[1].Abstract.Should().Be("kept");
        service.Articles[1].Author.Should().BeNull();
    }

    [Fact]
    public void GetArticlesByAuthorId_ShouldFilterAndOrderByPriority()
    {
        var service = CreateService();
        ApplyResponse(
            service,
            new StarterService.StarterResponse(
                new StarterService.StarterData(
                    [new StarterService.AuthorData(1, 3, "details", "Author")],
                    [
                        new StarterService.ArticleData(1, 8, 1, "third", "A", 30),
                        new StarterService.ArticleData(2, 8, 2, "other", "B", 10),
                        new StarterService.ArticleData(3, 9, 1, "first", "C", 5)
                    ],
                    [])));

        var articles = service.GetArticlesByAuthorId(1);

        articles.Select(article => article.Id).Should().Equal(3, 1);
    }

    [Fact]
    public void GetArticlesByPerekId_ShouldFilterAndOrderByPriority()
    {
        var service = CreateService();
        ApplyResponse(
            service,
            new StarterService.StarterResponse(
                new StarterService.StarterData(
                    [new StarterService.AuthorData(1, 3, "details", "Author")],
                    [
                        new StarterService.ArticleData(1, 8, 1, "second", "A", 20),
                        new StarterService.ArticleData(2, 8, 1, "first", "B", 10),
                        new StarterService.ArticleData(3, 9, 1, "other", "C", 5)
                    ],
                    [])));

        var articles = service.GetArticlesByPerekId(8);

        articles.Select(article => article.Id).Should().Equal(2, 1);
    }


    #region Daily Hebrew-date article overrides (#3098)

    private const string ScheduleDbName = "sefaria-dump-5784-sivan-4.tanah_view.sqlite";
    private static readonly string[] ScheduleSchema =
    [
        "CREATE TABLE tanah_perek_date (perek_id INTEGER, cycle INTEGER, date TEXT, hebdate TEXT, star_rise TEXT)"
    ];

    private const string DailyOverrideResponse = """
        {"data":{"starter":{"authors":[{"id":1,"articlesCount":2,"details":"d","name":"מחבר"}],
        "articles":[{"id":7,"perekId":2,"authorId":1,"abstract":null,"name":"פרק 2","priority":1},
        {"id":8,"perekId":9,"authorId":1,"abstract":null,"name":"תשעה באב","priority":1}],
        "perekArticlesCounters":[0,1,0,0,0,0,0,0,1],
        "articleHebrewDateOverrides":[{"articleId":8,"hebrewMonth":3,"hebrewDay":30}]}}}
        """;

    private static async Task<(PerekScheduleService Schedule, TestStorage Storage)> CreateScheduleAsync(
        params string[] inserts)
    {
        var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync(ScheduleDbName, ScheduleSchema);
        foreach (var insert in inserts)
        {
            await db.ExecuteAsync(insert);
        }
        var schedule = new PerekScheduleService(new LocalDatabaseService(storage.FileSystem.Object));
        await schedule.LoadAsync();
        return (schedule, storage);
    }

    [Fact]
    public async Task GetDailyArticles_AssignedDate_ReturnsSoleArticleAcrossPerekBoundary()
    {
        // 30 Kislev 5775 studies perek 2; the (3,30) override binds article 8,
        // whose primary perek is 9 — the override intentionally crosses the
        // scheduled-perek boundary.
        var (schedule, storage) = await CreateScheduleAsync(
            "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
            "INSERT INTO tanah_perek_date VALUES (2,1,'57750330','57750330','17:17')");
        await using var _ = storage;
        await using var starterStorage = new TestStorage();
        using var http = new GraphQLTransport(DailyOverrideResponse);
        var service = new StarterService(http.Client, starterStorage.FileSystem.Object, schedule);
        await service.LoadAsync();

        var articles = service.GetDailyArticles(2, 57750330);

        articles.Select(article => article.Id).Should().Equal(8);
        service.GetDailyPerekArticlesCount(2, 57750330).Should().Be(1);
    }

    [Fact]
    public async Task GetDailyArticles_NeighboringDatesAndOtherPerakim_KeepOrdinaryLists()
    {
        var (schedule, storage) = await CreateScheduleAsync(
            "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
            "INSERT INTO tanah_perek_date VALUES (2,1,'57750330','57750330','17:17')");
        await using var _ = storage;
        await using var starterStorage = new TestStorage();
        using var http = new GraphQLTransport(DailyOverrideResponse);
        var service = new StarterService(http.Client, starterStorage.FileSystem.Object, schedule);
        await service.LoadAsync();

        // Same perek, a different selected date — no assignment applies.
        service.GetDailyArticles(2, 57750329).Select(article => article.Id).Should().Equal(7);
        // The assigned date but a different viewed perek — the override
        // binds the date's daily perek, not the article's own perek.
        service.GetDailyArticles(9, 57750330).Select(article => article.Id).Should().Equal(8);
        service.GetDailyPerekArticlesCount(2, 57750329).Should().Be(1);
    }

    [Fact]
    public async Task GetDailyArticles_TodaysContext_AppliesOnAnyEntryPath()
    {
        // Today is always an active daily context: whichever perek the live
        // schedule resolves for today shows its assigned article (#3098).
        var today = HebrewDateHelper.GetTodayDateNumber();
        var (_, month, day) = HebrewDateHelper.NumberToHebrewDate(today);
        var (schedule, storage) = await CreateScheduleAsync(
            "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
            "INSERT INTO tanah_perek_date VALUES (2,1,'57750330','57750330','17:17')");
        await using var _ = storage;
        var todaysPerek = schedule.ResolveDay(today).PerekId;
        await using var starterStorage = new TestStorage();
        using var http = new GraphQLTransport(DailyOverrideResponse.Replace(
            "\"hebrewMonth\":3,\"hebrewDay\":30",
            $"\"hebrewMonth\":{month},\"hebrewDay\":{day}"));
        var service = new StarterService(http.Client, starterStorage.FileSystem.Object, schedule);
        await service.LoadAsync();

        if (todaysPerek is int perekId)
        {
            service.GetDailyArticles(perekId).Select(article => article.Id).Should().Equal(8);
            service.GetDailyPerekArticlesCount(perekId).Should().Be(1);
        }
        else
        {
            // Unscheduled today: no daily perek means no daily slot to override.
            service.GetDailyArticles(2).Select(article => article.Id).Should().Equal(7);
        }
    }

    private const string StarterWithoutOverridesResponse = """
        {"data":{"starter":{"authors":[{"id":1,"articlesCount":1,"details":"d","name":"מחבר"}],
        "articles":[{"id":7,"perekId":2,"authorId":1,"abstract":null,"name":"פרק 2","priority":1}],
        "perekArticlesCounters":[0,1,0,0,0,0,0,0,1]}}}
        """;

    [Fact]
    public async Task GetDailyArticles_StartersWithoutOverrides_FallBackToPerekList()
    {
        // Older API payloads (and caches written before the field existed)
        // carry no override rows — selection stays the ordinary perek list
        // even on the scheduled date itself.
        var (schedule, storage) = await CreateScheduleAsync(
            "INSERT INTO tanah_perek_date VALUES (1,1,'57750329','57750329','17:16')",
            "INSERT INTO tanah_perek_date VALUES (2,1,'57750330','57750330','17:17')");
        await using var _ = storage;
        await using var starterStorage = new TestStorage();
        using var http = new GraphQLTransport(StarterWithoutOverridesResponse);
        var service = new StarterService(http.Client, starterStorage.FileSystem.Object, schedule);
        await service.LoadAsync();

        service.GetDailyArticles(2, 57750330).Select(article => article.Id).Should().Equal(7);
        service.GetDailyPerekArticlesCount(2, 57750330).Should().Be(1);
    }

    #endregion

    private static StarterService CreateService()
    {
        var constructor = typeof(StarterService).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic,
            binder: null,
            types: Type.EmptyTypes,
            modifiers: null);

        constructor.Should().NotBeNull();
        return (StarterService)constructor!.Invoke(null);
    }

    private static void ApplyResponse(StarterService service, StarterService.StarterResponse response)
    {
        var method = typeof(StarterService).GetMethod(
            "ApplyResponse",
            BindingFlags.Instance | BindingFlags.NonPublic);

        method.Should().NotBeNull();
        method!.Invoke(service, [response]);
    }
}
