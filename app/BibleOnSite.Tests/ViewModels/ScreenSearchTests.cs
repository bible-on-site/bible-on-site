using BibleOnSite.Helpers;
using BibleOnSite.Models;
using BibleOnSite.Services;
using BibleOnSite.ViewModels;

namespace BibleOnSite.Tests.ViewModels;

public class ScreenSearchTests
{
    private static SearchViewModel ScreensOnly(string phrase)
    {
        var model = new SearchViewModel
        {
            SearchPhrase = phrase,
            NetworkProbe = () => false,
            CommentaryPackProbe = () => false
        };
        foreach (var filter in Enum.GetValues<SearchFilter>())
        {
            model.SetFilterEnabled(filter, filter == SearchFilter.Screen);
        }
        return model;
    }

    [Fact]
    public void ScreenIsASelectedKindThatWorksWithoutNetworkOrCommentary()
    {
        var model = new SearchViewModel();
        model.KindOptions.Should().Contain(SearchFilter.Screen);
        model.KindOptions.First().Should().Be(SearchFilter.Screen, "the new Screen option must be easy to find in the sheet");
        model.IsFilterEnabled(SearchFilter.Screen).Should().BeTrue();
        SearchFilter.Screen.GetHebrewName().Should().Be("מסך");
        SearchFilter.Screen.IsAvailable(false, false).Should().BeTrue();
    }

    [Fact]
    public async Task ScreenOnlySearchFindsRoutesWithoutLoadingScriptureOrCallingTheNetwork()
    {
        var model = ScreensOnly("calendar");
        await model.SearchAsync(CancellationToken.None);

        model.SearchResults.Should().ContainSingle().Which.Should().BeOfType<ScreenSearchResult>()
            .Which.Destination.Route.Should().Be(AppRoutes.LearningCalendar);
        model.ErrorMessage.Should().BeEmpty();
        model.AvailabilityMessage.Should().BeEmpty();
        model.IsLoading.Should().BeFalse();
    }

    [Fact]
    public async Task DisablingScreenKindRemovesItsHitsFromTheSameResultsList()
    {
        var model = ScreensOnly("הגדרות");
        await model.SearchAsync(CancellationToken.None);
        model.SearchResults.Should().ContainSingle();

        model.SetFilterEnabled(SearchFilter.Screen, false);
        await model.SearchAsync(CancellationToken.None);
        model.SearchResults.Should().BeEmpty();
    }

    [Fact]
    public async Task ScreenResultsAreIndependentOfTheBookSelection()
    {
        var model = ScreensOnly("ניווט");
        model.SetAllSefarimEnabled(false);
        await model.SearchAsync(CancellationToken.None);

        var result = model.SearchResults.Should().ContainSingle().Subject.Should().BeOfType<ScreenSearchResult>().Subject;
        result.Title.Should().Be("ניווט בתנ\"ך");
        result.Destination.Route.Should().Be(HomeNavigationSearch.IndexAction);
        result.Category.Should().Be("מסך");
    }

    [Fact]
    public void ScreenDescriptionIsSafeForTheSharedHtmlSnippetRenderer()
    {
        var result = new ScreenSearchResult(new("title", "<screen> & details", "route", "terms"), "screen");
        result.SubtitleHtml.Should().Be("&lt;screen&gt; &amp; details");
        result.SearchPhrase.Should().Be("screen");
        result.ResultType.Should().Be(SearchFilter.Screen);
    }
}
