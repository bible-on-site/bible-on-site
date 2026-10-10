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
        await FluentActions.Awaiting(() => vm.SearchAsync()).Should().ThrowAsync<FileNotFoundException>();
        vm.IsLoading.Should().BeFalse();
        vm.SearchResults.Should().BeEmpty();
    }
}
