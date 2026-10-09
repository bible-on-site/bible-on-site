using BibleOnSite.Services;
using BibleOnSite.Tests.Support;

namespace BibleOnSite.Tests.Services;

public class StarterOfflineTests
{
    private const string Response = """
        {"data":{"starter":{"authors":[{"id":1,"articlesCount":2,"details":"bio","name":"Author"}],
        "articles":[{"id":7,"perekId":2,"authorId":1,"abstract":null,"name":"Article","priority":3}],
        "perekArticlesCounters":[0,1,0]}}}
        """;

    [Fact]
    public async Task Load_PersistsResponseBeforeCompleting_AndRestartsOfflineFromCache()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var online = new StarterService(http.Client, storage.FileSystem.Object);
        await online.LoadWithRetryAsync();
        online.IsLoaded.Should().BeTrue();
        online.IsFromCache.Should().BeFalse();
        online.Articles.Single().Author.Should().BeSameAs(online.Authors.Single());
        http.Requests.Single().Should().Contain("GetStarter");
        var cache = Path.Combine(storage.Root, "starter_cache.json");
        File.Exists(cache).Should().BeTrue();
        (await File.ReadAllTextAsync(cache, TestContext.Current.CancellationToken)).Should().Contain("Article");

        http.Respond = _ => throw new HttpRequestException("offline");
        var offline = new StarterService(http.Client, storage.FileSystem.Object);
        await offline.LoadWithRetryAsync();
        offline.IsLoaded.Should().BeTrue();
        offline.IsFromCache.Should().BeTrue();
        offline.Authors.Single().Name.Should().Be("Author");
        offline.Articles.Single().Abstract.Should().BeEmpty();
        offline.PerekArticlesCounters.Should().Equal(0, 1, 0);
        await offline.LoadWithRetryAsync();
        http.Requests.Should().HaveCount(2, "an already loaded service does not retry startup");
    }

    [Fact]
    public async Task Load_RespectsLoadedState_AndForceReloadRefreshesData()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var service = new StarterService(http.Client, storage.FileSystem.Object);
        await service.LoadAsync();
        await service.LoadAsync();
        await service.LoadAsync(false);
        http.Requests.Should().ContainSingle();
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(Response.Replace("Author", "Updated")));
        await service.LoadAsync(true);
        service.Authors.Single().Name.Should().Be("Updated");
        http.Requests.Should().HaveCount(2);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("null")]
    [InlineData("{\"Starter\":null}")]
    [InlineData("invalid json")]
    public async Task Startup_WithoutUsableApiOrCache_LeavesSafeEmptyState(string? cache)
    {
        await using var storage = new TestStorage();
        if (cache != null)
        {
            await File.WriteAllTextAsync(Path.Combine(storage.Root, "starter_cache.json"), cache, TestContext.Current.CancellationToken);
        }
        using var http = new GraphQLTransport();
        var service = new StarterService(http.Client, storage.FileSystem.Object);
        await service.LoadWithRetryAsync();
        service.IsLoaded.Should().BeFalse();
        service.IsFromCache.Should().BeFalse();
        service.Articles.Should().BeEmpty();
        service.Authors.Should().BeEmpty();
        service.PerekArticlesCounters.Should().HaveCount(929).And.OnlyContain(n => n == 0);
    }

    [Fact]
    public async Task Refresh_RecoversFromFailure_AndKeepsDataIfLaterRequestFails()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport();
        var service = new StarterService(http.Client, storage.FileSystem.Object);
        http.Respond = _ => throw new HttpRequestException("offline");
        await service.TryRefreshAsync();
        service.IsLoaded.Should().BeFalse();
        http.Respond = _ => Task.FromResult(GraphQLTransport.JsonResponse(Response));
        await service.TryRefreshAsync();
        service.IsLoaded.Should().BeTrue();
        http.Respond = _ => throw new HttpRequestException("offline again");
        await service.TryRefreshAsync();
        service.Authors.Single().Name.Should().Be("Author");
    }

    [Fact]
    public async Task Load_WhenCacheCannotBeWritten_StillRetainsOnlineData()
    {
        await using var storage = new TestStorage();
        Directory.CreateDirectory(Path.Combine(storage.Root, "starter_cache.json"));
        using var http = new GraphQLTransport(Response);
        var service = new StarterService(http.Client, storage.FileSystem.Object);
        await service.LoadAsync(false);
        service.IsLoaded.Should().BeTrue();
        service.Authors.Should().ContainSingle();
    }
}
