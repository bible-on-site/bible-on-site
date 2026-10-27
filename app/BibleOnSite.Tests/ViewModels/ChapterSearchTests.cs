using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

public class ChapterSearchTests
{
    [Fact]
    public async Task Search_FindsChapterSources_RespectsBookFilters_AndStopsAtResultLimit()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
        await db.ExecuteAsync("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<150) INSERT INTO tanah_perek SELECT n,n,NULL FROM ids");
        var vm = new SearchViewModel(new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object))) { SearchPhrase = "בראשית" };
        vm.SetFilterEnabled(SearchFilter.Author, false);
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        var chapters = vm.SearchResults.Cast<PerekSearchResult>().ToList();
        chapters.Should().HaveCount(vm.ResultsLimit);
        chapters.First().Perek.PerekId.Should().Be(1);
        chapters.Last().Perek.PerekId.Should().Be(vm.ResultsLimit);
        vm.SetSeferFilterEnabled(1, false);
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.SearchResults.Should().BeEmpty();
        vm.SetSeferFilterEnabled(1, true);
        vm.SearchPhrase = "בראשית ב";
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.SearchResults.Cast<PerekSearchResult>().First().Perek.PerekId.Should().Be(2);
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task Search_WhenDatabaseUnavailable_ResetsLoadingAndPropagatesError()
    {
        await using var storage = new TestStorage();
        var vm = new SearchViewModel(new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object))) { SearchPhrase = "בראשית" };
        await FluentActions.Awaiting(() => vm.SearchAsync(CancellationToken.None)).Should().ThrowAsync<FileNotFoundException>();
        vm.IsLoading.Should().BeFalse();
        vm.SearchResults.Should().BeEmpty();
    }

    [Fact]
    public async Task Search_WhenArticleSearchReturnsNullData_ReportsTheNetworkRequirement()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
        await db.ExecuteAsync("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<150) INSERT INTO tanah_perek SELECT n,n,NULL FROM ids");
        var transport = new GraphQLTransport("{\"data\":null}");
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null, new ArticleService(transport.Client)) { SearchPhrase = "בראשית" };
        vm.SetFilterEnabled(SearchFilter.Articles, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        vm.AvailabilityMessage.Should().Be("חיפוש תוכן מאמרים זמין רק עם חיבור רשת");
    }

    [Fact]
    public async Task Search_WithoutAnInjectedTanahpediaService_SkipsTheRemoteMerge()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
        await db.ExecuteAsync("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<150) INSERT INTO tanah_perek SELECT n,n,NULL FROM ids");
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object))) { SearchPhrase = "בראשית" };
        vm.SetFilterEnabled(SearchFilter.Tanahpedia, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        // The merge short-circuits to null before any service call — no availability note.
        vm.AvailabilityMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task Search_MapsTanahpediaHits_BlankingMissingExcerpts()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
        await db.ExecuteAsync("WITH RECURSIVE ids(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM ids WHERE n<150) INSERT INTO tanah_perek SELECT n,n,NULL FROM ids");
        var transport = new GraphQLTransport("""
            {"data":{"searchTanahpediaEntries":[
                {"id":"e1","uniqueName":"torah","title":"תורה","excerpt":"מקור על בראשית","score":2},
                {"id":"e2","uniqueName":"bereshit","title":"בראשית","excerpt":null,"score":1}]}}
            """);
        var vm = new SearchViewModel(
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)),
            null, null, new TanahpediaService(transport.Client)) { SearchPhrase = "בראשית" };
        // Keep only the Tanahpedia merge visible so score-ordering cannot
        // truncate the remote hits below the perek results.
        vm.SetFilterEnabled(SearchFilter.Perek, false);
        vm.SetFilterEnabled(SearchFilter.Tanahpedia, true);

        await vm.SearchAsync(TestContext.Current.CancellationToken);

        var hits = vm.SearchResults.OfType<TanahpediaSearchResult>().ToList();
        hits.Should().HaveCount(2);
        hits.Single(h => h.Title == "בראשית").SubtitleHtml.Should().BeEmpty();
        hits.Single(h => h.Title == "תורה").SubtitleHtml.Should().NotBeEmpty();
    }

    [Fact]
    public async Task CanceledQueuedSearch_DoesNotClearTheCurrentResults()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL)");
        var vm = new SearchViewModel(new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object))) { SearchPhrase = "בראשיט 1" };
        await vm.SearchAsync(TestContext.Current.CancellationToken);
        var result = vm.SearchResults.Should().ContainSingle().Subject;
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();

        await vm.SearchAsync(canceled.Token);

        vm.SearchResults.Should().ContainSingle().Which.Should().BeSameAs(result);
        vm.IsLoading.Should().BeFalse();
        vm.ErrorMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task CanceledQueuedSearch_DoesNotCancelTheNewerInFlightSearch()
    {
        await using var storage = new TestStorage();
        var db = await storage.CreateDatabaseAsync("sefaria-dump-5784-sivan-4.tanah_view.sqlite", PerekDataServiceTests.Schema);
        await db.ExecuteAsync("INSERT INTO tanah_sefer VALUES (1,'בראשית','Genesis',1,929)");
        await db.ExecuteAsync("INSERT INTO tanah_perek VALUES (1,1,NULL)");
        var data = new GatedPerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var vm = new SearchViewModel(data) { SearchPhrase = "בראשיט 1" };
        var current = vm.SearchAsync(TestContext.Current.CancellationToken);
        vm.IsLoading.Should().BeTrue();
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();
        try
        {
            await vm.SearchAsync(canceled.Token);
            vm.IsLoading.Should().BeTrue();
            current.IsCompleted.Should().BeFalse();
        }
        finally
        {
            data.Ready.SetResult();
            // LoadAsync is shared work and outlives cancellation of its waiter.
            await data.LoadAsync();
            await current;
        }
        vm.SearchResults.Should().ContainSingle().Which.Title.Should().Be("בראשית א");
        vm.IsLoading.Should().BeFalse();
    }

    private sealed class GatedPerekDataService(LocalDatabaseService database) : PerekDataService(database)
    {
        public TaskCompletionSource Ready { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async Task LoadAsync()
        {
            await Ready.Task;
            await base.LoadAsync();
        }
    }

}
