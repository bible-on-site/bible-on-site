using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

/// <summary>
/// MoedService (#3261): the public catalogue read — published filtering,
/// ordered sections/ranges, the server-resolved article id union, the
/// moadim_cache.json offline path, and slug resolution that fetches a moed
/// added since the cached load.
/// </summary>
public class MoedServiceTests
{
    private const string Response = """
        {"data":{"moadim":[
            {"id":2,"slug":"tisha-bav","name":"תשעה באב","summary":"אין בו אלא צום","hebrewMonth":"אב",
             "dateLabel":"ט' באב","annualOrder":20,"published":true,
             "sections":[
                {"id":21,"label":"מגילת איכה","position":1,"ranges":[
                    {"id":31,"position":1,"perekIdStart":700,"pasukStart":1,"perekIdEnd":700,"pasukEnd":22},
                    {"id":32,"position":2,"perekIdStart":700,"pasukStart":1,"perekIdEnd":700,"pasukEnd":10}
                ]},
                {"id":22,"label":"קינות","position":2,"ranges":[
                    {"id":33,"position":1,"perekIdStart":1,"pasukStart":5,"perekIdEnd":3,"pasukEnd":8}
                ]}
             ],
             "explicitArticleIds":[50],"articles":[{"id":7},{"id":50},{"id":7}]},
            {"id":3,"slug":"draft","name":"טיוטה","summary":null,"hebrewMonth":null,"dateLabel":null,
             "annualOrder":5,"published":false,"sections":[],"explicitArticleIds":[],"articles":[]},
            {"id":1,"slug":"rosh-hashana","name":"ראש השנה","summary":null,"hebrewMonth":"תשרי",
             "dateLabel":"א'-ב' בתשרי","annualOrder":1,"published":true,"sections":[],
             "explicitArticleIds":[],"articles":[{"id":9}]}
        ]}}
        """;

    private static MoedService ServiceWith(GraphQLTransport http, TestStorage storage) =>
        new(http.Client, storage.FileSystem.Object);

    [Fact]
    public async Task Load_ReadsThePublicQuery_AndOrdersByAnnualOrder()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);

        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeTrue();
        service.IsFromCache.Should().BeFalse();
        // The catalogue displays in annual order, not response order.
        service.Moadim.Select(m => m.Id).Should().Equal(1, 2);
        http.Requests.Single().Should().Contain("GetMoadim");
        http.Requests.Single().Should().NotContain("moadim_admin",
            "the public surface never issues the admin read (#3261)");
    }

    [Fact]
    public async Task Load_FiltersUnpublished_AndResolvesSlugAsUnavailable()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();

        service.Moadim.Should().NotContain(m => m.Slug == "draft",
            "published=false stays off the public catalogue");
        service.GetMoedBySlug("draft").Should().BeNull();
        service.GetMoedBySlug("tisha-bav").Should().NotBeNull();
    }

    [Fact]
    public async Task Load_PreservesSectionOrder_RangeOrder_AndRepeatedRanges()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();

        var moed = service.GetMoedBySlug("tisha-bav")!;
        moed.Sections.Select(s => s.Label).Should().Equal("מגילת איכה", "קינות");
        var first = moed.Sections[0];
        first.Ranges.Should().HaveCount(2);
        // A deliberately repeated overlapping range keeps its declared place.
        first.Ranges.Select(r => (r.StartPasuk, r.EndPasuk)).Should().Equal((1, 22), (1, 10));
        moed.Sections[1].Ranges[0].Should().Match<BibleOnSite.Models.MoedRange>(r =>
            r.StartPerekId == 1 && r.StartPasuk == 5 && r.EndPerekId == 3 && r.EndPasuk == 8,
            "a cross-perek range keeps its canonical bounds");
    }

    [Fact]
    public async Task Load_CarriesTheServerArticleUnion_WithoutDuplication()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();

        // The API's union order is kept; the client dedupes repeats defensively.
        service.GetMoedBySlug("tisha-bav")!.ArticleIds.Should().Equal(7, 50);
        service.GetMoedBySlug("rosh-hashana")!.ArticleIds.Should().Equal(9);
    }

    [Fact]
    public async Task Load_PersistsResponseBeforeCompleting_AndRestartsOfflineFromCache()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var online = ServiceWith(http, storage);
        await online.LoadWithRetryAsync();
        var cache = Path.Join(storage.Root, "moadim_cache.json");
        File.Exists(cache).Should().BeTrue();
        (await File.ReadAllTextAsync(cache, TestContext.Current.CancellationToken))
            .Should().Contain("tisha-bav");

        http.Respond = _ => throw new HttpRequestException("offline");
        var offline = ServiceWith(http, storage);
        await offline.LoadWithRetryAsync();

        offline.IsLoaded.Should().BeTrue();
        offline.IsFromCache.Should().BeTrue();
        offline.Moadim.Select(m => m.Slug).Should().Equal("rosh-hashana", "tisha-bav");
        offline.GetMoedBySlug("tisha-bav")!.Sections.Select(s => s.Label)
            .Should().Equal("מגילת איכה", "קינות");
        offline.GetMoedBySlug("tisha-bav")!.ArticleIds.Should().Equal(7, 50);
    }

    [Fact]
    public async Task Load_WithoutApiOrCache_LeavesAnEmptyCatalogue()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport("{\"data\":{\"moadim\":null}}");
        var service = ServiceWith(http, storage);

        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeFalse();
        service.Moadim.Should().BeEmpty();
    }

    [Fact]
    public async Task GetMoedBySlug_FetchesAMiss_AndMergesItIntoTheCatalogue()
    {
        await using var storage = new TestStorage();
        var detail = """
            {"data":{"moed":{"id":9,"slug":"chanuka","name":"חנוכה","summary":null,
             "hebrewMonth":"כסלו","dateLabel":"כ\"ה בכסלו","annualOrder":3,"published":true,
             "sections":[],"explicitArticleIds":[],"articles":[{"id":4}]}}}
            """;
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(detail));

        var moed = await service.GetMoedBySlugAsync("chanuka");

        moed.Should().NotBeNull();
        moed!.Name.Should().Be("חנוכה");
        service.Moadim.Select(m => m.Slug).Should().Contain("chanuka",
            "a slug miss merged into the catalogue so the detail stays cached");
        http.Requests[^1].Should().Contain("GetMoed").And.Contain("chanuka");
        // The merged catalogue persisted — an offline restart keeps the detail.
        http.Respond = _ => throw new HttpRequestException("offline");
        var offline = ServiceWith(http, storage);
        await offline.LoadWithRetryAsync();
        offline.GetMoedBySlug("chanuka").Should().NotBeNull();
    }

    [Fact]
    public async Task GetMoedBySlug_UnpublishedDetail_ResolvesAsUnavailable()
    {
        await using var storage = new TestStorage();
        var draft = """
            {"data":{"moed":{"id":9,"slug":"draft","name":"טיוטה","summary":null,
             "hebrewMonth":null,"dateLabel":null,"annualOrder":3,"published":false,
             "sections":[],"explicitArticleIds":[],"articles":[]}}}
            """;
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(draft));

        (await service.GetMoedBySlugAsync("draft")).Should().BeNull();
    }

    [Fact]
    public async Task GetAdjacentMoadim_ReturnsAnnualOrderNeighbors()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();

        service.GetAdjacentMoadim(1).Should().Be((null, service.GetMoed(2)));
        service.GetAdjacentMoadim(2).Prev!.Id.Should().Be(1);
        service.GetAdjacentMoadim(2).Next.Should().BeNull();
        service.GetAdjacentMoadim(999).Should().Be((null, null));
    }

    [Fact]
    public async Task TryRefresh_UpdatesTheCatalogue()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();

        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(Response.Replace("ראש השנה", "ראש השנה!")));
        await service.TryRefreshAsync();

        service.GetMoedBySlug("rosh-hashana")!.Name.Should().Be("ראש השנה!");
        http.Requests.Should().HaveCount(2);
    }
}
