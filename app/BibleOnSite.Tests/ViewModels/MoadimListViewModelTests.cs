using BibleOnSite.Services;
using BibleOnSite.Tests.Support;
using BibleOnSite.ViewModels;
using Moq;

namespace BibleOnSite.Tests.ViewModels;

/// <summary>
/// MoadimListViewModel (#3261): the catalogue landing — Hebrew-month
/// grouping in annual order, the ungrouped label, the unavailable/empty
/// surface, idempotent loads, and navigation by escaped canonical slug.
/// </summary>
public class MoadimListViewModelTests
{
    private const string Response = """
        {"data":{"moadim":[
            {"id":2,"slug":"tisha-bav","name":"תשעה באב","summary":null,"hebrewMonth":"אב",
             "dateLabel":"ט' באב","annualOrder":20,"published":true,"sections":[],
             "explicitArticleIds":[],"articles":[]},
            {"id":1,"slug":"rosh-hashana","name":"ראש השנה","summary":null,"hebrewMonth":"תשרי",
             "dateLabel":"א' בתשרי","annualOrder":1,"published":true,"sections":[],
             "explicitArticleIds":[],"articles":[]},
            {"id":3,"slug":"yom-kippur","name":"יום כיפור","summary":null,"hebrewMonth":"תשרי",
             "dateLabel":"י' בתשרי","annualOrder":2,"published":true,"sections":[],
             "explicitArticleIds":[],"articles":[]},
            {"id":4,"slug":"shemini-atzeret","name":"שמיני עצרת","summary":null,"hebrewMonth":null,
             "dateLabel":null,"annualOrder":3,"published":true,"sections":[],
             "explicitArticleIds":[],"articles":[]}
        ]}}
        """;

    private static (MoadimListViewModel vm, Mock<IAppNavigator> navigator) Subject(
        GraphQLTransport http, TestStorage storage)
    {
        var navigator = new Mock<IAppNavigator>();
        return (new MoadimListViewModel(new MoedService(http.Client, storage.FileSystem.Object),
            navigator.Object), navigator);
    }

    [Fact]
    public async Task Load_GroupsByHebrewMonth_InAnnualOrder()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var (vm, _) = Subject(http, storage);

        await vm.LoadAsync();

        // Groups appear in the annual order of their first moed; month-less
        // entries land under the ungrouped label.
        vm.Groups.Select(g => g.MonthName).Should().Equal("תשרי", "ללא חודש", "אב");
        // A month keeps the catalogue's annual order inside itself.
        vm.Groups[0].Select(m => m.Slug).Should().Equal("rosh-hashana", "yom-kippur");
        vm.Groups[1].Select(m => m.Slug).Should().Equal("shemini-atzeret");
        vm.Groups[2].Select(m => m.Slug).Should().Equal("tisha-bav");
        vm.IsEmpty.Should().BeFalse();
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task Load_WithoutCatalogue_SetsTheUnavailableSurface()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport("{\"data\":{\"moadim\":null}}");
        var (vm, _) = Subject(http, storage);

        await vm.LoadAsync();

        vm.Groups.Should().BeEmpty();
        vm.IsEmpty.Should().BeTrue();
        vm.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task Load_SecondCall_IsIdempotent()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var (vm, _) = Subject(http, storage);
        await vm.LoadAsync();

        await vm.LoadAsync();

        // A populated landing does not refetch on re-appearance.
        http.Requests.Should().HaveCount(1);
    }

    [Fact]
    public async Task OpenMoed_NavigatesByTheEscapedCanonicalSlug()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var (vm, navigator) = Subject(http, storage);
        await vm.LoadAsync();
        var moed = vm.Groups.SelectMany(g => g).Single(m => m.Slug == "tisha-bav");

        await vm.OpenMoedCommand.ExecuteAsync(moed);

        navigator.Verify(n => n.GoToAsync("MoedPage?slug=tisha-bav"), Times.Once);
    }

    [Fact]
    public async Task OpenMoed_NavigationFailure_IsContained()
    {
        await using var storage = new TestStorage();
        using var http = new GraphQLTransport(Response);
        var (vm, navigator) = Subject(http, storage);
        await vm.LoadAsync();
        navigator.Setup(n => n.GoToAsync(It.IsAny<string>()))
            .ThrowsAsync(new InvalidOperationException("navigation blew up"));
        var moed = vm.Groups.SelectMany(g => g).First();

        // A failed navigation logs and stays on the landing — never crashes.
        await vm.OpenMoedCommand.ExecuteAsync(moed);
    }
}
