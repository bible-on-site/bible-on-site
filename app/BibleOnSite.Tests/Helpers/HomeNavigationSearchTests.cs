using BibleOnSite.Helpers;
using BibleOnSite.Services;

namespace BibleOnSite.Tests.Helpers;

public class HomeNavigationSearchTests
{
    [Theory]
    [InlineData("לוּחַ שָׁנָה", "LearningCalendarPage")]
    [InlineData("calendar", "LearningCalendarPage")]
    [InlineData("חלוקה מסורתית", "MasoraPage")]
    [InlineData("הגדרות", "PreferencesPage")]
    [InlineData("רבנים", "AuthorsPage")]
    [InlineData("רבנים כותבים", "AuthorsPage")]
    public void FindsNavigationByNameDescriptionAndSynonyms(string query, string route)
    {
        HomeNavigationSearch.Find(query).Should().Contain(item => item.Route == route);
    }

    [Fact]
    public void IndexIsAnExplicitLocalAction()
    {
        HomeNavigationSearch.Find("אינדקס התנ״ך").Should()
            .ContainSingle(item => item.Route == HomeNavigationSearch.IndexAction);
    }

    [Fact]
    public void EmptyQueryShowsAvailableDestinationsWithoutDuplicateRoutes()
    {
        var matches = HomeNavigationSearch.Find(" ");
        matches.Should().HaveCount(4, "an empty search offers a few shortcuts rather than another full app menu");
        matches.Select(item => item.Route).Should().OnlyHaveUniqueItems();
        matches.Should().Contain(item => item.Route == AppRoutes.Masora);
    }

    [Fact]
    public void AllQueryWordsMustMatchOneDestination()
    {
        HomeNavigationSearch.Find("לוח הגדרות").Should().BeEmpty();
    }
}
