using BibleOnSite.Models;

namespace BibleOnSite.Tests.Models;

/// <summary>Availability rules behind the disabled search-kind rows (#2454).</summary>
public class SearchKindAvailabilityTests
{
    [Theory]
    [InlineData(SearchFilter.Articles)]
    [InlineData(SearchFilter.Tanahpedia)]
    public void Offline_RemoteKinds_ReportNetworkReason(SearchFilter filter)
    {
        filter.UnavailableReason(isOnline: false, commentaryPackAvailable: true).Should().Be("חיבור רשת נדרש");
        filter.IsAvailable(isOnline: false, commentaryPackAvailable: true).Should().BeFalse();
        filter.IsAvailable(isOnline: true, commentaryPackAvailable: true).Should().BeTrue();
    }

    [Fact]
    public void NoPack_Perush_ReportsPackReason()
    {
        SearchFilter.Perush.UnavailableReason(isOnline: true, commentaryPackAvailable: false)
            .Should().Be("נדרשת חבילת פירושים");
        SearchFilter.Perush.IsAvailable(isOnline: true, commentaryPackAvailable: false).Should().BeFalse();
    }

    [Fact]
    public void NoPackAndOffline_Perush_PrefersPackReason()
    {
        // The pack is the blocker that outlives connectivity — name it first.
        SearchFilter.Perush.UnavailableReason(isOnline: false, commentaryPackAvailable: false)
            .Should().Be(SearchKindAvailability.CommentaryPackReason);
    }

    [Theory]
    [InlineData(SearchFilter.Author)]
    [InlineData(SearchFilter.Pasuk)]
    [InlineData(SearchFilter.Perek)]
    public void LocalKinds_AlwaysAvailable(SearchFilter filter)
    {
        filter.IsAvailable(isOnline: false, commentaryPackAvailable: false).Should().BeTrue();
        filter.UnavailableReason(isOnline: false, commentaryPackAvailable: false).Should().BeNull();
    }
}
