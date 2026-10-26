using BibleOnSite.Helpers;
using Microsoft.Maui;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Graphics;
using Moq;

namespace BibleOnSite.Tests.Helpers;

/// <summary>
/// Managed-only paths of <see cref="ReaderScrollTop"/>: resolving the realized
/// scroll surface of the carousel's current unit, issuing the animated
/// scroll-to-start, and the reduced-motion preference seam (#2624).
/// </summary>
public class ReaderScrollTopTests
{
    private static readonly object CurrentUnit = new();
    private static readonly object NeighborUnit = new();

    /// <summary>
    /// Attaches a mocked handler and allocates a size so the surface satisfies
    /// the realized-laid-out checks — the same conditions a live carousel item
    /// view meets once the platform realizes and arranges it.
    /// </summary>
    private static T Realize<T>(T element) where T : VisualElement
    {
        element.Handler = new Mock<IViewHandler>().Object;
        element.Arrange(new Rect(0, 0, 320, 640));
        return element;
    }

    /// <summary>
    /// Builds the visual sub-tree of one realized carousel item: the item root
    /// binds the unit, and the pasukim list plus the תיקון קוראים surface
    /// inherit that BindingContext — matching the reader item templates.
    /// </summary>
    private static Grid RealizedItem(object unit, bool tikkun, out CollectionView list, out ScrollView tikkunView)
    {
        var item = new Grid { BindingContext = unit };
        list = Realize(new CollectionView
        {
            BindingContext = unit,
            IsVisible = !tikkun,
            ItemsSource = new List<object> { new(), new() }
        });
        tikkunView = Realize(new ScrollView
        {
            BindingContext = unit,
            IsVisible = tikkun
        });
        item.AddLogicalChild(list);
        item.AddLogicalChild(tikkunView);
        return item;
    }

    [Fact]
    public void ScrollCurrentUnitToStart_ScrollsTheCurrentUnitsListToItsFirstRow()
    {
        var root = new Grid();
        root.AddLogicalChild(RealizedItem(CurrentUnit, tikkun: false, out var list, out _));
        ScrollToRequestEventArgs? request = null;
        list.ScrollToRequested += (_, e) => request = e;

        ReaderScrollTop.ScrollCurrentUnitToStart(root, CurrentUnit).Should().BeTrue();

        request.Should().NotBeNull();
        request!.Index.Should().Be(0, "the first row lands at the top beneath the unit header");
        request.ScrollToPosition.Should().Be(ScrollToPosition.Start);
        request.IsAnimated.Should().BeTrue("reselecting the tab animates rather than jumping");
    }

    [Fact]
    public void ScrollCurrentUnitToStart_ScrollsTheTikkunSurfaceWhenItIsVisible()
    {
        var root = new Grid();
        root.AddLogicalChild(RealizedItem(CurrentUnit, tikkun: true, out var list, out var tikkunView));
        var listRequests = 0;
        list.ScrollToRequested += (_, _) => listRequests++;
        ScrollToRequestedEventArgs? request = null;
        tikkunView.ScrollToRequested += (_, e) => request = e;

        ReaderScrollTop.ScrollCurrentUnitToStart(root, CurrentUnit).Should().BeTrue();

        request.Should().NotBeNull();
        request!.ScrollX.Should().Be(0);
        request.ScrollY.Should().Be(0);
        request.ShouldAnimate.Should().BeTrue();
        listRequests.Should().Be(0, "the hidden pasukim list must not be scrolled while תיקון קוראים shows");
    }

    [Fact]
    public void ScrollCurrentUnitToStart_DoesNotScrollANeighboursRealizedList()
    {
        var root = new Grid();
        // Only the neighbour's item is realized — a swipe recycled the current
        // unit's view away, so there is nothing safe to scroll.
        root.AddLogicalChild(RealizedItem(NeighborUnit, tikkun: false, out var neighbor, out _));
        var scrolled = 0;
        neighbor.ScrollToRequested += (_, _) => scrolled++;

        ReaderScrollTop.ScrollCurrentUnitToStart(root, CurrentUnit).Should().BeFalse();
        scrolled.Should().Be(0);
    }

    [Fact]
    public void ScrollCurrentUnitToStart_SkipsUnrealizedSurfaces()
    {
        var root = new Grid();
        // Bound to the current unit but never realized: no handler, no size.
        root.AddLogicalChild(new CollectionView
        {
            BindingContext = CurrentUnit,
            ItemsSource = new List<object> { new() }
        });

        ReaderScrollTop.ScrollCurrentUnitToStart(root, CurrentUnit).Should().BeFalse();
    }

    [Fact]
    public void ScrollCurrentUnitToStart_NullUnit_IsAHarmlessNoOp()
    {
        var root = new Grid();
        root.AddLogicalChild(RealizedItem(CurrentUnit, tikkun: false, out _, out _));

        ReaderScrollTop.ScrollCurrentUnitToStart(root, null).Should().BeFalse();
    }

    [Fact]
    public void ScrollCurrentUnitToStart_RepeatedTapsReissueTheSameScroll()
    {
        var root = new Grid();
        root.AddLogicalChild(RealizedItem(CurrentUnit, tikkun: false, out var list, out _));
        var requests = 0;
        list.ScrollToRequested += (_, _) => requests++;

        ReaderScrollTop.ScrollCurrentUnitToStart(root, CurrentUnit);
        ReaderScrollTop.ScrollCurrentUnitToStart(root, CurrentUnit).Should().BeTrue();

        requests.Should().Be(2, "tapping again at the top is a harmless repeat of the same scroll");
    }

    [Fact]
    public void ScrollCurrentUnitToStart_WithoutAnimationPreference_JumpsInstantly()
    {
        var restore = ReaderScrollTop.AnimateScroll;
        ReaderScrollTop.AnimateScroll = () => false;
        try
        {
            var root = new Grid();
            root.AddLogicalChild(RealizedItem(CurrentUnit, tikkun: false, out var list, out _));
            ScrollToRequestEventArgs? request = null;
            list.ScrollToRequested += (_, e) => request = e;

            ReaderScrollTop.ScrollCurrentUnitToStart(root, CurrentUnit).Should().BeTrue();
            request.Should().NotBeNull();
            request!.IsAnimated.Should().BeFalse("the platform reduced-motion preference suppresses the animation");
        }
        finally
        {
            ReaderScrollTop.AnimateScroll = restore;
        }
    }
}
