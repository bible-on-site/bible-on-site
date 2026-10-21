using BibleOnSite.Controls;
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
    public void IndexOfItem_ReturnsMinusOne_WhenTheListHasNoSource()
    {
        // A list whose ItemsSource was never assigned resolves to an empty
        // scan rather than throwing.
        SearchMatchLanding.IndexOfItem(new CollectionView(), new object()).Should().Be(-1);
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
    public void TryLandOnPerushMatch_RealizedNoteView_TrustsTheIssuedScroll()
    {
        var list = new CollectionView { ItemsSource = new List<object>() };
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        // The note's native cell is realized and bound to the display item,
        // but this platform cannot measure match-line visibility.
        var htmlView = new HtmlView { BindingContext = display };
        list.AddLogicalChild(htmlView);
        // The perush-name label realizes with the note row — on a platform
        // without measurement its visibility stays unverifiable (null).
        list.AddLogicalChild(new Label { AutomationId = "InlinePerushName", BindingContext = display });

        var verdict = SearchMatchLanding.TryLandOnPerushMatch(list, display, new SearchMatchSpan(3, 7));

        verdict.Should().Be(SearchMatchLanding.PerushLanding.Landed);
        htmlView.HasSearchMatch.Should().BeTrue();
        htmlView.SearchMatchStart.Should().Be(3);
        htmlView.SearchMatchLength.Should().Be(7);
    }

    [Fact]
    public void TryLandOnPerushMatch_RealizedNoteViewWithoutNameLabel_StillLands()
    {
        var list = new CollectionView { ItemsSource = new List<object>() };
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        // The name label is still virtualized away while the note view is
        // realized — the header lookup yields null and the landing stays
        // on the issued-scroll trust path.
        var htmlView = new HtmlView { BindingContext = display };
        list.AddLogicalChild(htmlView);

        SearchMatchLanding.TryLandOnPerushMatch(list, display, new SearchMatchSpan(0, 2))
            .Should().Be(SearchMatchLanding.PerushLanding.Landed);
    }

    [Fact]
    public void TryLandOnPerushMatch_KeepsAnAlreadyAppliedMatchSpan()
    {
        var list = new CollectionView { ItemsSource = new List<object>() };
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        // A span already set by a previous frame is not reassigned — the
        // setter would restart the platform highlight.
        var htmlView = new HtmlView { BindingContext = display, SearchMatchStart = 4, SearchMatchLength = 6 };
        list.AddLogicalChild(htmlView);

        SearchMatchLanding.TryLandOnPerushMatch(list, display, new SearchMatchSpan(0, 9))
            .Should().Be(SearchMatchLanding.PerushLanding.Landed);

        htmlView.SearchMatchStart.Should().Be(4);
        htmlView.SearchMatchLength.Should().Be(6);
    }

    [Fact]
    public void MatchTopMargin_KeepsThePerushNameHeaderBelowTheToolbar()
    {
        SearchMatchLanding.MatchTopMargin.Should().BeGreaterThan(0);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(null)]
    public void TryLandOnPerushMatch_MatchVisibleAndNameNotHidden_Lands(bool? nameVisible)
    {
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        using var _ = RealizedNote(display, withNameLabel: true,
            matchVisible: true, nameVisible: nameVisible);

        SearchMatchLanding.TryLandOnPerushMatch(_list, display, new SearchMatchSpan(0, 2))
            .Should().Be(SearchMatchLanding.PerushLanding.Landed);
    }

    [Fact]
    public void TryLandOnPerushMatch_NameOffscreenButFits_ScrollsTheHeaderInAndStaysEngaged()
    {
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        var scrolled = 0;
        using var _ = RealizedNote(display, withNameLabel: true,
            matchVisible: true, nameVisible: false,
            nameFit: true, onScrollName: (_, _) => { scrolled++; return true; });

        SearchMatchLanding.TryLandOnPerushMatch(_list, display, new SearchMatchSpan(0, 2))
            .Should().Be(SearchMatchLanding.PerushLanding.Engaged);
        scrolled.Should().Be(1);
    }

    [Theory]
    [InlineData(false, SearchMatchLanding.PerushLanding.Landed)]
    [InlineData(null, SearchMatchLanding.PerushLanding.Engaged)]
    public void TryLandOnPerushMatch_NameOffscreen_HeaderlessLandingDependsOnFit(
        bool? nameFit, SearchMatchLanding.PerushLanding expected)
    {
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        var scrolled = 0;
        using var _ = RealizedNote(display, withNameLabel: true,
            matchVisible: true, nameVisible: false,
            nameFit: nameFit, onScrollName: (_, _) => { scrolled++; return true; });

        SearchMatchLanding.TryLandOnPerushMatch(_list, display, new SearchMatchSpan(0, 2))
            .Should().Be(expected);
        // No fit (long pasuk) accepts the match-only landing; an unmeasurable
        // fit re-verifies next frame — neither issues a header scroll.
        scrolled.Should().Be(0);
    }

    [Theory]
    [InlineData(false, SearchMatchLanding.PerushLanding.NotReady)]
    [InlineData(null, SearchMatchLanding.PerushLanding.Engaged)]
    public void TryLandOnPerushMatch_ScrollPrimitivesNotReady_VerdictFollowsMeasurability(
        bool? matchVisible, SearchMatchLanding.PerushLanding expected)
    {
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        using var _ = RealizedNote(display, withNameLabel: false,
            matchVisible: matchVisible, scrollList: false);

        SearchMatchLanding.TryLandOnPerushMatch(_list, display, new SearchMatchSpan(0, 2))
            .Should().Be(expected);
    }

    [Fact]
    public void TryLandOnPerushMatch_MeasuredNotVisible_AfterAScroll_StaysEngaged()
    {
        var display = new PerushNoteDisplay { PerushId = 1, PerushName = "רשי" };
        using var _ = RealizedNote(display, withNameLabel: false,
            matchVisible: false, scrollList: true);

        // A verified platform measured the line outside the viewport: the
        // issued scroll is not trusted — the next frame must re-check.
        SearchMatchLanding.TryLandOnPerushMatch(_list, display, new SearchMatchSpan(0, 2))
            .Should().Be(SearchMatchLanding.PerushLanding.Engaged);
    }

    private readonly CollectionView _list = new() { ItemsSource = new List<object>() };

    private sealed class ProbeRestore(
        Func<CollectionView, HtmlView, bool?> match,
        Func<CollectionView, VisualElement, bool?> element,
        Func<CollectionView, HtmlView, Label, bool?> fit,
        Func<CollectionView, Label, bool> scrollName,
        Func<CollectionView, HtmlView, bool> scrollList) : IDisposable
    {
        public void Dispose()
        {
            SearchMatchLanding.MatchVisibilityProbe = match;
            SearchMatchLanding.ElementVisibilityProbe = element;
            SearchMatchLanding.NameFitProbe = fit;
            SearchMatchLanding.NameScroller = scrollName;
            SearchMatchLanding.ListScroller = scrollList;
        }
    }

    private IDisposable RealizedNote(
        PerushNoteDisplay display, bool withNameLabel,
        bool? matchVisible = null, bool? nameVisible = null, bool? nameFit = null,
        Func<CollectionView, Label, bool>? onScrollName = null, bool scrollList = true)
    {
        _list.AddLogicalChild(new HtmlView { BindingContext = display });
        if (withNameLabel)
        {
            _list.AddLogicalChild(new Label { AutomationId = "InlinePerushName", BindingContext = display });
        }
        var restore = new ProbeRestore(
            SearchMatchLanding.MatchVisibilityProbe,
            SearchMatchLanding.ElementVisibilityProbe,
            SearchMatchLanding.NameFitProbe,
            SearchMatchLanding.NameScroller,
            SearchMatchLanding.ListScroller);
        SearchMatchLanding.MatchVisibilityProbe = (_, _) => matchVisible;
        SearchMatchLanding.ElementVisibilityProbe = (_, _) => nameVisible;
        SearchMatchLanding.NameFitProbe = (_, _, _) => nameFit;
        SearchMatchLanding.NameScroller = onScrollName ?? ((_, _) => true);
        SearchMatchLanding.ListScroller = (_, _) => scrollList;
        return restore;
    }
}
