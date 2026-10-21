using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using FluentAssertions;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

public class ArticlesViewModelTests
{
    #region Constructor Tests

    [Fact]
    public void Constructor_WithPerekId_ShouldSetPerekIdAndTitle()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית א - 123");

        viewModel.PerekId.Should().Be(123);
        viewModel.PerekTitle.Should().Be("בראשית א - 123");
        viewModel.AuthorId.Should().BeNull();
        viewModel.AuthorName.Should().BeEmpty();
    }

    [Fact]
    public void Constructor_WithAuthorId_ShouldSetAuthorIdAndName()
    {
        var viewModel = ArticlesViewModel.ForAuthor(5, "הרב משה לוי");

        viewModel.AuthorId.Should().Be(5);
        viewModel.AuthorName.Should().Be("הרב משה לוי");
        viewModel.PerekId.Should().Be(0);
        viewModel.PerekTitle.Should().BeEmpty();
    }

    #endregion

    #region Filter Mode Tests

    [Fact]
    public void IsFilterByPerek_WhenPerekIdSet_ShouldBeTrue()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית א");

        viewModel.IsFilterByPerek.Should().BeTrue();
        viewModel.IsFilterByAuthor.Should().BeFalse();
    }

    [Fact]
    public void IsFilterByAuthor_WhenAuthorIdSet_ShouldBeTrue()
    {
        var viewModel = ArticlesViewModel.ForAuthor(5, "הרב משה");

        viewModel.IsFilterByAuthor.Should().BeTrue();
        viewModel.IsFilterByPerek.Should().BeFalse();
    }

    #endregion

    #region Display Title Tests

    [Fact]
    public void DisplayTitle_WhenFilterByPerek_ShouldShowPerekTitle()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית א - 123");

        viewModel.DisplayTitle.Should().Be("מאמרים על בראשית א - 123");
    }

    [Fact]
    public void DisplayTitle_WhenFilterByAuthor_ShouldShowAuthorName()
    {
        var viewModel = ArticlesViewModel.ForAuthor(5, "הרב משה לוי");

        viewModel.DisplayTitle.Should().Be("מאמרים של הרב משה לוי");
    }

    [Fact]
    public void DisplayTitle_WhenPerekTitleChanges_ShouldRaisePropertyChanged()
    {
        var viewModel = new ArticlesViewModel(123, "בראשית א");
        var changed = new List<string?>();
        viewModel.PropertyChanged += (_, args) => changed.Add(args.PropertyName);

        viewModel.PerekTitle = "שמות ב";

        changed.Should().Contain(nameof(viewModel.DisplayTitle));
        viewModel.DisplayTitle.Should().Be("מאמרים על שמות ב");
    }

    #endregion

    #region Articles Collection Tests

    [Fact]
    public void SetArticles_ShouldUpdateArticlesCollection()
    {
        var viewModel = new ArticlesViewModel(1, "Test");
        var articles = CreateTestArticles();

        viewModel.SetArticles(articles);

        viewModel.Articles.Should().HaveCount(3);
        viewModel.HasArticles.Should().BeTrue();
    }

    [Fact]
    public void HasArticles_WhenEmpty_ShouldBeFalse()
    {
        var viewModel = new ArticlesViewModel(1, "Test");

        viewModel.HasArticles.Should().BeFalse();
    }

    [Fact]
    public void SetArticles_ShouldClearPreviousArticles()
    {
        var viewModel = new ArticlesViewModel(1, "Test");
        viewModel.SetArticles(CreateTestArticles());
        viewModel.Articles.Should().HaveCount(3);

        viewModel.SetArticles(new List<Article> { CreateTestArticle(1) });

        viewModel.Articles.Should().HaveCount(1);
    }

    #endregion

    #region Author Article-Content Search Tests

    private const string SearchResponse = """
        {"data":{"searchArticles":{"total":1,"hits":[
        {"articleId":42,"name":"מאמר תואם","authorName":"הרב משה","authorId":5,"perekId":3,"source":"בראשית ז","excerpt":"הביטוי מופיע רק בגוף המאמר","score":0.9}]}}}
        """;

    private static (ArticlesViewModel vm, GraphQLTransport http) CreateAuthorViewModel(string searchResponse)
    {
        var storage = new TestStorage();
        var http = new GraphQLTransport(searchResponse);
        var starter = new StarterService(new GraphQLTransport("{}").Client, storage.FileSystem.Object);
        var data = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var vm = new ArticlesViewModel(starter, data, new Mock<IAppNavigator>().Object,
            new ArticleService(http.Client));
        vm.AuthorId = 5;
        vm.AuthorName = "הרב משה";
        vm.SetArticles(new List<Article> { CreateTestArticle(1), CreateTestArticle(2) });
        return (vm, http);
    }

    [Fact]
    public async Task ApplySearch_SendsAuthorScope_AndReplacesListingWithContentHits()
    {
        var (vm, http) = CreateAuthorViewModel(SearchResponse);

        await vm.ApplySearchAsync("הביטוי");

        http.Requests.Should().ContainSingle();
        http.Requests[0].Should().Contain("\"authorId\":5");
        vm.Articles.Should().HaveCount(1);
        var article = vm.Articles[0];
        article.Id.Should().Be(42);
        article.PerekDisplayName.Should().Be("בראשית ז");
        article.Author.Should().NotBeNull();
        article.Author!.Name.Should().Be("הרב משה");
        // The body-only match excerpt lands on the card, not the stored abstract.
        article.ShortAbstract.Should().Contain("הביטוי");
        vm.SearchMessage.Should().BeEmpty();
        vm.IsSearching.Should().BeFalse();
        vm.ShowSearchStatus.Should().BeFalse();
    }

    [Fact]
    public async Task ApplySearch_ClearingQuery_RestoresFullListing()
    {
        var (vm, _) = CreateAuthorViewModel(SearchResponse);
        await vm.ApplySearchAsync("הביטוי");
        vm.Articles.Should().HaveCount(1);

        await vm.ApplySearchAsync("");

        vm.Articles.Should().HaveCount(2);
        vm.Articles.Select(a => a.Id).Should().BeEquivalentTo(new[] { 1, 2 });
        vm.SearchMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task ApplySearch_NoMatches_ReportsWithoutPretendingEmptyAuthor()
    {
        var (vm, _) = CreateAuthorViewModel("""{"data":{"searchArticles":{"total":0,"hits":[]}}}""");

        await vm.ApplySearchAsync("חיפוש");

        vm.Articles.Should().BeEmpty();
        vm.SearchMessage.Should().Contain("לא נמצאו");
        vm.EmptyStateText.Should().Be(vm.SearchMessage);
        vm.ShowSearchStatus.Should().BeTrue();
    }

    [Fact]
    public void EmptyStateText_WithoutSearchContext_ShowsPlainCaption()
    {
        var (vm, _) = CreateAuthorViewModel(SearchResponse);

        // No articles yet, no search message: the plain caption wins.
        vm.SetArticles(new List<Article>());
        vm.EmptyStateText.Should().Be("אין מאמרים");

        // A non-empty list also yields the plain caption.
        vm.SetArticles(new List<Article> { CreateTestArticle(1) });
        vm.EmptyStateText.Should().Be("אין מאמרים");
    }

    [Fact]
    public async Task ApplySearch_RequestFails_KeepsListingAndReportsAvailability()
    {
        var (vm, http) = CreateAuthorViewModel(SearchResponse);
        http.Respond = _ => throw new HttpRequestException("offline");

        await vm.ApplySearchAsync("חיפוש");

        vm.Articles.Should().HaveCount(2);
        vm.SearchMessage.Should().NotBeEmpty();
        vm.ErrorMessage.Should().BeEmpty();
        vm.IsSearching.Should().BeFalse();
    }

    [Fact]
    public async Task ApplySearch_NullPage_ReportsAvailabilityWithoutClearingList()
    {
        var (vm, _) = CreateAuthorViewModel("""{"data":{"searchArticles":null}}""");

        await vm.ApplySearchAsync("חיפוש");

        vm.Articles.Should().HaveCount(2);
        vm.SearchMessage.Should().Contain("רשת");
    }

    [Fact]
    public async Task ApplySearch_WhenNotFilteringByAuthor_DoesNothing()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(SearchResponse);
        var starter = new StarterService(http.Client, storage.FileSystem.Object);
        var data = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var vm = new ArticlesViewModel(starter, data, new Mock<IAppNavigator>().Object,
            new ArticleService(http.Client)) { PerekId = 2 };
        vm.SetArticles(new List<Article> { CreateTestArticle(1) });

        await vm.ApplySearchAsync("חיפוש");

        http.Requests.Should().BeEmpty();
        vm.Articles.Should().HaveCount(1);
        vm.SearchMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task ApplySearch_RapidQueries_OnlyLatestResponseApplies()
    {
        var (vm, http) = CreateAuthorViewModel(SearchResponse);

        var pending = vm.ApplySearchAsync("ראשון");
        var latest = vm.ApplySearchAsync("אחרון");
        await Task.WhenAll(pending, latest);

        // The second call cancels the first mid-debounce; one request fired.
        http.Requests.Count.Should().BeLessThanOrEqualTo(1);
        vm.SearchMessage.Should().BeEmpty();
    }

    [Fact]
    public async Task ApplySearch_HitAuthorInStarter_ReusesLoadedAuthor()
    {
        var storage = new TestStorage();
        var starterHttp = new GraphQLTransport("""
            {"data":{"starter":{"authors":[
            {"id":5,"articlesCount":1,"details":"פרטי הרב","name":"הרב משה"}
            ],"articles":[],"perekArticlesCounters":[0]}}}
            """);
        var starter = new StarterService(starterHttp.Client, storage.FileSystem.Object);
        await starter.LoadAsync(forceReload: true);
        using var http = new GraphQLTransport(SearchResponse);
        var data = new PerekDataService(new LocalDatabaseService(storage.FileSystem.Object));
        var vm = new ArticlesViewModel(starter, data, new Mock<IAppNavigator>().Object,
            new ArticleService(http.Client)) { AuthorId = 5 };

        await vm.ApplySearchAsync("הביטוי");

        // The starter-owned Author instance wins over the hit-name fallback.
        vm.Articles[0].Author!.Details.Should().Be("פרטי הרב");
    }

    [Fact]
    public async Task ApplySearch_HitWithoutSource_FallsBackToPerekSource()
    {
        const string noSource = """
            {"data":{"searchArticles":{"total":1,"hits":[
            {"articleId":42,"name":"מאמר","authorName":"הרב","authorId":5,"perekId":3,"source":null,"excerpt":"x","score":0.9}]}}}
            """;
        var (vm, _) = CreateAuthorViewModel(noSource);

        await vm.ApplySearchAsync("x");

        vm.Articles[0].PerekDisplayName.Should().NotBe("בראשית ז");
    }

    [Fact]
    public async Task ApplySearch_AuthorChangesMidSearch_DiscardsResponse()
    {
        var (vm, http) = CreateAuthorViewModel(SearchResponse);
        http.Respond = _ =>
        {
            vm.AuthorId = 9;
            return Task.FromResult(GraphQLTransport.JsonResponse(SearchResponse));
        };

        await vm.ApplySearchAsync("הביטוי");

        // The response belonged to the previous author's scope — list stays.
        vm.Articles.Select(a => a.Id).Should().BeEquivalentTo(new[] { 1, 2 });
        vm.SearchMessage.Should().BeEmpty();
    }

    [Fact]
    public void AuthorIdChange_ClearsSearchContext()
    {
        var (vm, _) = CreateAuthorViewModel(SearchResponse);
        vm.SearchPhrase = "query";
        vm.SearchMessage = "status";

        vm.AuthorId = 9;

        vm.SearchPhrase.Should().BeEmpty();
        vm.SearchMessage.Should().BeEmpty();
    }

    #endregion

    #region Helper Methods

    private static List<Article> CreateTestArticles()
    {
        return new List<Article>
        {
            CreateTestArticle(1),
            CreateTestArticle(2),
            CreateTestArticle(3)
        };
    }

    private static Article CreateTestArticle(int id)
    {
        return new Article
        {
            Id = id,
            Abstract = $"<H1>Article {id} Title</H1>",
            ArticleContent = $"Content for article {id}",
            AuthorId = 1,
            PerekId = 1,
            Priority = 1,
            Name = $"Article {id}"
        };
    }

    #endregion
}
