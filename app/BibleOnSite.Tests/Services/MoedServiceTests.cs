using System.Net;
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

    [Fact]
    public async Task CatalogueRevision_BumpsOnEveryCatalogueReplacement()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        var initial = service.CatalogueRevision;

        await service.LoadWithRetryAsync();
        var loaded = service.CatalogueRevision;
        loaded.Should().BeGreaterThan(initial);

        // The slug-miss merge is a catalogue replacement too — snapshot
        // consumers like the grouped landing rebuild on it (#3261 review).
        var detail = """
            {"data":{"moed":{"id":9,"slug":"chanuka","name":"חנוכה","summary":null,
             "hebrewMonth":"כסלו","dateLabel":null,"annualOrder":3,"published":true,
             "sections":[],"explicitArticleIds":[],"articles":[]}}}
            """;
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(detail));
        await service.GetMoedBySlugAsync("chanuka");

        service.CatalogueRevision.Should().BeGreaterThan(loaded);
    }

    [Fact]
    public async Task GetMoedBySlugAsync_ListHit_SkipsTheDetailCall()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();
        var calls = http.Requests.Count;

        var moed = await service.GetMoedBySlugAsync("rosh-hashana");

        moed!.Id.Should().Be(1);
        http.Requests.Should().HaveCount(calls,
            "a moed already present in the catalogue serves without a detail fetch");
    }

    [Fact]
    public async Task GetMoedBySlugAsync_UnpublishedMerge_IsDiscarded()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();
        var unpublished = """
            {"data":{"moed":{"id":9,"slug":"draft","name":"טיוטה","summary":null,
             "hebrewMonth":"אדר","dateLabel":null,"annualOrder":9,"published":false,
             "sections":[],"explicitArticleIds":[],"articles":[]}}}
            """;
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(unpublished));

        var moed = await service.GetMoedBySlugAsync("draft");

        moed.Should().BeNull("unpublished moedim are never cached");
        service.GetMoed(9).Should().BeNull();
    }

    [Fact]
    public async Task GetMoedBySlugAsync_NullDetail_StaysUncached()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse("{\"data\":{\"moed\":null}}"));

        var moed = await service.GetMoedBySlugAsync("missing");

        moed.Should().BeNull();
    }

    [Fact]
    public async Task LoadWithRetry_PrefersFreshCatalogue_OverStaleCache()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response.Replace("ראש השנה", "מהמטמון"));
        var seed = ServiceWith(http, storage);
        await seed.LoadWithRetryAsync(); // writes the stale cache
        http.Dispose();

        using var http2 = new GraphQLTransport(Response);
        var service = ServiceWith(http2, storage);
        await service.LoadWithRetryAsync();

        service.GetMoedBySlug("rosh-hashana")!.Name.Should().Be("ראש השנה",
            "a successful API load replaces the on-disk catalogue");
    }

    [Fact]
    public async Task LoadWithRetry_WhenApiDown_UsesCachedCatalogue()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var seed = ServiceWith(http, storage);
        await seed.LoadWithRetryAsync(); // writes the cache

        using var deadTransport = new GraphQLTransport();
        deadTransport.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var service = ServiceWith(deadTransport, storage);
        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeTrue();
        service.IsFromCache.Should().BeTrue();
        service.GetMoed(1).Should().NotBeNull("the disk cache carries the catalogue when the API is down");
        service.GetMoedBySlug("rosh-hashana").Should().NotBeNull();
    }

    [Fact]
    public async Task LoadWithRetry_CorruptCache_StaysEmptyAndIsRecoverable()
    {
        await using var storage = new TestStorage();
        var cacheFile = Path.Join(storage.FileSystem.Object.AppDataDirectory, "moadim_cache.json");
        Directory.CreateDirectory(Path.GetDirectoryName(cacheFile)!);
        await File.WriteAllTextAsync(cacheFile, "not-json{{{");
        using var deadTransport = new GraphQLTransport();
        deadTransport.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var service = ServiceWith(deadTransport, storage);

        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeFalse(
            "a corrupt cache is swallowed — the list surfaces its unavailable state");

        // Recovery: a working API repopulates even with the corrupt file.
        deadTransport.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(Response));
        await service.TryRefreshAsync();
        service.GetMoed(1).Should().NotBeNull();
    }

    [Fact]
    public async Task LoadWithRetry_NullCachePayload_StaysUnloaded()
    {
        await using var storage = new TestStorage();
        var cacheFile = Path.Join(storage.FileSystem.Object.AppDataDirectory, "moadim_cache.json");
        Directory.CreateDirectory(Path.GetDirectoryName(cacheFile)!);
        await File.WriteAllTextAsync(cacheFile, "{\"moadim\":null}");
        using var deadTransport = new GraphQLTransport();
        deadTransport.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var service = ServiceWith(deadTransport, storage);

        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeFalse();
    }

    [Fact]
    public async Task LoadWithRetry_UnwritableCache_StillLoadsFromApi()
    {
        var fileSystem = new Moq.Mock<IFileSystem>();
        fileSystem.SetupGet(f => f.AppDataDirectory).Throws(new IOException("no cache dir"));
        fileSystem.SetupGet(f => f.CacheDirectory).Returns("cache");
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = new MoedService(http.Client, fileSystem.Object);

        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeTrue(
            "cache-save failure is best-effort — the catalogue still serves");
    }

    [Fact]
    public async Task TryRefresh_Failure_KeepsCatalogueLoaded()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();
        http.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));

        await service.TryRefreshAsync();

        service.IsLoaded.Should().BeTrue();
        service.GetMoed(1)!.Name.Should().Be("ראש השנה",
            "a failed refresh must not corrupt the cached catalogue");
    }

    [Fact]
    public async Task Load_NullDataEnvelope_LeavesAnEmptyCatalogue()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport("{\"data\":null}");
        var service = ServiceWith(http, storage);

        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeFalse();
        service.Moadim.Should().BeEmpty();
    }

    [Fact]
    public async Task GetMoedBySlugAsync_NullDataEnvelope_ResolvesAsUnavailable()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse("{\"data\":null}"));

        (await service.GetMoedBySlugAsync("missing")).Should().BeNull();
    }

    [Fact]
    public async Task LoadWithRetry_NullJsonCache_StaysUnloaded()
    {
        await using var storage = new TestStorage();
        var cacheFile = Path.Join(storage.FileSystem.Object.AppDataDirectory, "moadim_cache.json");
        Directory.CreateDirectory(Path.GetDirectoryName(cacheFile)!);
        // A deserializable-but-null payload is not a corrupt file — it still
        // carries no catalogue.
        await File.WriteAllTextAsync(cacheFile, "null");
        using var deadTransport = new GraphQLTransport();
        deadTransport.Respond = _ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var service = ServiceWith(deadTransport, storage);

        await service.LoadWithRetryAsync();

        service.IsLoaded.Should().BeFalse();
    }

    [Fact]
    public async Task Load_SparseMoedPayload_DefaultsItsOptionalLists()
    {
        // Fields the API may omit entirely — sections, per-range lists and
        // articles — must not turn a published moed into a crash.
        const string sparse = """
            {"data":{"moadim":[
                {"id":6,"slug":"sparse","name":"מועד דל","summary":null,"hebrewMonth":null,
                 "dateLabel":null,"annualOrder":1,"published":true,
                 "sections":[{"id":61,"label":"קריאה","position":1}]},
                {"id":7,"slug":"barren","name":"מועד עקר","summary":null,"hebrewMonth":null,
                 "dateLabel":null,"annualOrder":2,"published":true}
            ]}}
            """;
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(sparse);
        var service = ServiceWith(http, storage);

        await service.LoadWithRetryAsync();

        var moed = service.GetMoedBySlug("sparse");
        moed.Should().NotBeNull();
        moed!.Sections.Should().ContainSingle();
        moed.Sections[0].Ranges.Should().BeEmpty();
        moed.ArticleIds.Should().BeEmpty();
        // A moed whose payload omits the sections list entirely defaults to none.
        service.GetMoedBySlug("barren")!.Sections.Should().BeEmpty();
    }

    [Fact]
    public async Task TryRefresh_SequentialAfterLoad_PerformsItsOwnFetch()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = ServiceWith(http, storage);
        await service.LoadWithRetryAsync();

        await service.TryRefreshAsync();

        http.Requests.Should().HaveCount(2, "the completed load does not satisfy a later refresh");
    }
}
