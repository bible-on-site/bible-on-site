using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using Microsoft.Maui.ApplicationModel.DataTransfer;

namespace BibleOnSite.Tests.ViewModels;

public class AsyncCommandsTests
{
    private const string Response = """
        {"data":{"starter":{"authors":[{"id":1,"articlesCount":2,"details":"bio","name":"הרב משה"}],
        "articles":[{"id":7,"perekId":2,"authorId":1,"abstract":"intro","name":"Article","priority":3}],
        "perekArticlesCounters":[0,1,0]}}}
        """;

    [Fact]
    public async Task Authors_LoadsApiDataOnce_AndClearsLoadingState()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var starter = new StarterService(http.Client, storage.FileSystem.Object);
        var vm = new AuthorsViewModel(starter);
        await vm.LoadAuthorsCommand.ExecuteAsync(null);
        vm.Authors.Single().Name.Should().Be("הרב משה");
        vm.IsLoading.Should().BeFalse();
        vm.ErrorMessage.Should().BeEmpty();
        await vm.LoadAuthorsAsync();
        http.Requests.Should().ContainSingle();
    }

    [Fact]
    public async Task Lists_WhenRequestFails_ReportErrorAndResetLoadingState()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport();
        http.Respond = _ => throw new HttpRequestException("offline");
        var starter = new StarterService(http.Client, storage.FileSystem.Object);
        var authors = new AuthorsViewModel(starter);
        await authors.LoadAuthorsAsync();
        authors.IsLoading.Should().BeFalse();
        authors.ErrorMessage.Should().Contain("offline");
        var articles = new ArticlesViewModel(starter,
            new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object)), new Mock<IAppNavigator>().Object);
        await articles.LoadArticlesCommand.ExecuteAsync(null);
        articles.IsLoading.Should().BeFalse();
        articles.ErrorMessage.Should().Contain("offline");
    }

    [Fact]
    public async Task Articles_LoadsByPerekAndAuthor_AndNavigatesWithIds()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var starter = new StarterService(http.Client, storage.FileSystem.Object);
        var data = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var navigator = new Mock<IAppNavigator>();
        var vm = new ArticlesViewModel(starter, data, navigator.Object) { PerekId = 2 };
        await vm.LoadArticlesAsync();
        vm.Articles.Single().Id.Should().Be(7);
        vm.HasArticles.Should().BeTrue();
        vm.AuthorId = 1;
        await vm.LoadArticlesAsync();
        vm.Articles.Single().Author!.Name.Should().Be("הרב משה");
        await vm.OpenArticleCommand.ExecuteAsync(vm.Articles.Single());
        navigator.Verify(n => n.GoToAsync("articleDetail?articleId=7&perekId=2"), Times.Once);
        await vm.OpenArticleAsync(null!);
        vm.AuthorId = null;
        vm.PerekId = 0;
        await vm.LoadArticlesAsync();
        vm.Articles.Should().BeEmpty();
        vm.HasArticles.Should().BeFalse();
    }

    [Fact]
    public async Task ArticleDetail_SharesTextAndUrl_AndEscapesAuthorRoute()
    {
        var navigator = new Mock<IAppNavigator>();
        var share = new Mock<IShare>();
        var vm = new ArticleDetailViewModel(navigator.Object, share.Object);
        await vm.ShareAsync();
        await vm.GoToAuthorAsync();
        share.Verify(s => s.RequestAsync(It.IsAny<ShareTextRequest>()), Times.Never);
        vm.SetArticle(new Article { Id = 7, PerekId = 2, Name = "Article", Abstract = "<H1>Article</H1>", Author = new Author { Id = 9, Name = "משה & אהרן", Details = "" } });
        await vm.ShareCommand.ExecuteAsync(null);
        share.Verify(s => s.RequestAsync(It.Is<ShareTextRequest>(r => r.Uri == "https://תנך.co.il/929/2/7" && r.Text == "Article - משה & אהרן")), Times.Once);
        await vm.GoToAuthorCommand.ExecuteAsync(null);
        navigator.Verify(n => n.GoToAsync("ArticlesPage?authorId=9&authorName=" + Uri.EscapeDataString("משה & אהרן")), Times.Once);
        await vm.GoBackCommand.ExecuteAsync(null);
        navigator.Verify(n => n.GoToAsync(".."), Times.Once);
    }

    [Fact]
    public async Task Perek_NavigationUsesEscapedTitle_AndReportsRouteFailures()
    {
        var navigator = new Mock<IAppNavigator>();
        var vm = new PerekViewModel(PreferencesService.CreateForTesting(new InMemoryPreferencesStorage()), null,
            navigator: navigator.Object);
        await vm.GoToArticlesAsync();
        navigator.Verify(n => n.GoToAsync(It.IsAny<string>()), Times.Never);
        vm.Perek = new Perek { PerekId = 2, SeferName = "בראשית", PerekNumber = 2,
            Date = "", HebDate = "", SeferTanahUsName = "Genesis", Tseit = "" };
        await vm.GoToArticlesCommand.ExecuteAsync(null);
        navigator.Verify(n => n.GoToAsync("ArticlesPage?perekId=2&perekTitle=" + Uri.EscapeDataString("בראשית ב")), Times.Once);
        await vm.GoToAuthorsCommand.ExecuteAsync(null);
        navigator.Verify(n => n.GoToAsync("AuthorsPage"), Times.Once);
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>())).ThrowsAsync(new IOException("route unavailable"));
        await vm.GoToArticlesAsync();
        await vm.GoToAuthorsAsync();
        navigator.Verify(n => n.DisplayAlertAsync("שגיאה", It.Is<string>(m => m.Contains("route unavailable")), "אישור"), Times.Exactly(2));
    }

    [Fact]
    public async Task Search_ClearsEmptyQueries_AndPopulatesAuthorResultsWithEnabledFilters()
    {
        var vm = new SearchViewModel();
        vm.SetAuthors([new Author { Id = 1, Name = "הרב משה", Details = "" }]);
        vm.SetFilterEnabled(SearchFilter.Perek, false);
        vm.SearchPhrase = "משה";
        await vm.SearchAsync();
        vm.SearchResults.Should().ContainSingle().Which.Should().BeOfType<AuthorSearchResult>();
        vm.IsLoading.Should().BeFalse();
        vm.SetFilterEnabled(SearchFilter.Author, false);
        vm.SetFilterEnabled(SearchFilter.Perek, false);
        await vm.SearchAsync();
        vm.SearchResults.Should().BeEmpty();
        vm.SetSeferGroupFilterEnabled(0, true);
        vm.IsSeferGroupFilterEnabled(0).Should().BeTrue();
        vm.SearchPhrase = "";
        vm.GetAuthorResults().Should().BeEmpty("the author filter is disabled");
        vm.SetFilterEnabled(SearchFilter.Author, true);
        vm.GetAuthorResults().Should().ContainSingle().Which.Author.Name.Should().Be("הרב משה");
        await vm.SearchAsync();
        vm.SearchResults.Should().BeEmpty();
    }
}
