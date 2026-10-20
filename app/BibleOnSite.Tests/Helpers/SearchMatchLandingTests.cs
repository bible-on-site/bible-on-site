using BibleOnSite.Helpers;
using BibleOnSite.Models;
using Microsoft.Maui.Controls;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Managed-only verdict paths of <see cref="SearchMatchLanding"/>: row
/// indexing, the scroll-issue counter, and the perush NotReady verdict.
/// Platform-measured paths stay platform-gated.
/// </summary>
public class SearchMatchLandingTests
{
    [Fact]
    public void IndexOfItem_MatchesByReference_InsideTheItemsSource()
    {
        var first = new object();
        var second = new object();
        var list = new CollectionView { ItemsSource = new List<object> { first, second } };

        SearchMatchLanding.IndexOfItem(list, second).Should().Be(1);
        SearchMatchLanding.IndexOfItem(list, new object()).Should().Be(-1);
    }

    [Fact]
    public void AnchorPasukRow_IssuesAScrollUntilTheAttemptCap()
    {
        var item = new object();
        var list = new CollectionView { ItemsSource = new List<object> { item } };

        // Not anchored yet: one more scroll is issued each frame.
        SearchMatchLanding.AnchorPasukRow(list, item, 0).Should().Be(1);
        // Already verified anchored: no further scrolls.
        SearchMatchLanding.AnchorPasukRow(list, item, 0, true).Should().Be(0);
        // The cap stops the retry loop so a failed jump cannot spin forever.
        SearchMatchLanding.AnchorPasukRow(list, item, 60).Should().Be(60);
    }

    [Fact]
    public void LandOnPasukRow_TrustsTheJumpAfterEnoughScrollIssues()
    {
        var item = new object();
        var list = new CollectionView { ItemsSource = new List<object> { item } };

        // This platform has no native position check — the verdict rides the
        // issued-scroll count instead of confirming an offset.
        var early = SearchMatchLanding.LandOnPasukRow(list, item, 0);
        early.Landed.Should().BeFalse();
        early.PasukScrolls.Should().Be(1);

        var trusted = SearchMatchLanding.LandOnPasukRow(list, item, 3);
        trusted.Landed.Should().BeTrue();
        trusted.PasukScrolls.Should().Be(4);
    }

    [Fact]
    public void TryLandOnPerushMatch_ReportsNotReady_WhenNoNoteViewIsRealized()
    {
        var list = new CollectionView { ItemsSource = new List<object>() };
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };

        SearchMatchLanding.TryLandOnPerushMatch(list, display, new SearchMatchSpan(0, 4))
            .Should().Be(SearchMatchLanding.PerushLanding.NotReady);
    }

    [Fact]
    public void MatchTopMargin_KeepsThePerushNameHeaderBelowTheToolbar()
    {
        SearchMatchLanding.MatchTopMargin.Should().BeGreaterThan(0);
    }
}
