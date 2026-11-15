using BibleOnSite.Controls;
using FluentAssertions;
using Microsoft.Maui.Controls;
using Moq;

namespace BibleOnSite.Tests.Controls;

/// <summary>
/// Contract tests for the picker scroll-edge arrows shared by the perek,
/// parasha and masora unit pickers (#2573). Arrow state is observed through
/// the semantic description the control reports to accessibility, which is
/// also what the MobileE2E picker tests assert on device.
/// </summary>
public class PickerScrollColumnsTests
{
    private const string MoreAbove = "יש עוד פריטים למעלה";
    private const string MoreBelow = "יש עוד פריטים למטה";
    private const string TopBoundary = "תחילת הרשימה";
    private const string BottomBoundary = "סוף הרשימה";

    private static PickerScrollColumn MakeColumn(int itemCount, out CollectionView list, out Label up, out Label down)
    {
        list = new CollectionView { ItemsSource = Enumerable.Range(1, itemCount).ToList() };
        up = new Label();
        down = new Label();
        return new PickerScrollColumn(list, up, down, new Label());
    }

    private static Mock<IDispatcher> InlineDispatcher()
    {
        var dispatcher = new Mock<IDispatcher>();
        dispatcher.Setup(d => d.Dispatch(It.IsAny<Action>()))
            .Returns((Action action) =>
            {
                action();
                return true;
            });
        return dispatcher;
    }

    [Fact]
    public void HandleScrolled_MiddleRange_ReportsMoreInBothDirections()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);

        columns.HandleScrolled(list, firstVisibleIndex: 5, lastVisibleIndex: 9);

        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(MoreBelow);
    }

    [Fact]
    public void HandleScrolled_FirstItemVisible_ReportsTopBoundary()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);

        columns.HandleScrolled(list, firstVisibleIndex: 0, lastVisibleIndex: 4);

        SemanticProperties.GetDescription(up).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(down).Should().Be(MoreBelow);
    }

    [Fact]
    public void HandleScrolled_LastItemVisible_ReportsBottomBoundary()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);

        columns.HandleScrolled(list, firstVisibleIndex: 15, lastVisibleIndex: 19);

        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void HandleScrolled_WholeListVisible_ReportsBothBoundaries()
    {
        var column = MakeColumn(5, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);

        columns.HandleScrolled(list, firstVisibleIndex: 0, lastVisibleIndex: 4);

        SemanticProperties.GetDescription(up).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void HandleScrolled_UnknownSender_LeavesArrowsUntouched()
    {
        var column = MakeColumn(20, out _, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);

        columns.HandleScrolled(new CollectionView(), firstVisibleIndex: 5, lastVisibleIndex: 9);

        SemanticProperties.GetDescription(up).Should().BeNull();
        SemanticProperties.GetDescription(down).Should().BeNull();
    }

    [Fact]
    public void Columns_TrackScrollStateIndependently()
    {
        var first = MakeColumn(20, out var firstList, out var firstUp, out var firstDown);
        var second = MakeColumn(20, out var secondList, out var secondUp, out var secondDown);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, first, second);
        columns.RefreshAllDeferred();

        columns.HandleScrolled(firstList, firstVisibleIndex: 5, lastVisibleIndex: 9);

        SemanticProperties.GetDescription(firstUp).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(firstDown).Should().Be(MoreBelow);
        // The unscrolled column keeps its own boundary state — one column's
        // scroll position never leaks into another (#2573 acceptance).
        SemanticProperties.GetDescription(secondUp).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(secondDown).Should().Be(BottomBoundary);
        second.FirstVisibleIndex.Should().Be(-1);
        second.LastVisibleIndex.Should().Be(-1);
        secondList.Should().NotBeSameAs(firstList);
    }

    [Fact]
    public void HandleSizeChanged_DropsMeasuredRange_BackToEstimate()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        columns.HandleScrolled(list, firstVisibleIndex: 5, lastVisibleIndex: 9);

        columns.HandleSizeChanged(list);

        column.FirstVisibleIndex.Should().Be(-1);
        column.LastVisibleIndex.Should().Be(-1);
        // Unarranged in the test host, the estimate reports no overflow.
        SemanticProperties.GetDescription(up).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void HandleSizeChanged_UnknownSender_DoesNothing()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        columns.HandleScrolled(list, firstVisibleIndex: 5, lastVisibleIndex: 9);

        columns.HandleSizeChanged(new CollectionView());

        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(MoreBelow);
    }

    [Fact]
    public void RefreshDeferred_ResetsRangeAndDispatchesRefresh()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var dispatcher = InlineDispatcher();
        var columns = new PickerScrollColumns(dispatcher.Object, column);
        columns.HandleScrolled(list, firstVisibleIndex: 5, lastVisibleIndex: 9);

        columns.RefreshDeferred(list);

        dispatcher.Verify(d => d.Dispatch(It.IsAny<Action>()), Times.Once);
        column.FirstVisibleIndex.Should().Be(-1);
        column.LastVisibleIndex.Should().Be(-1);
        SemanticProperties.GetDescription(up).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void RefreshDeferred_UnknownList_SkipsDispatch()
    {
        var column = MakeColumn(20, out _, out _, out _);
        var dispatcher = InlineDispatcher();
        var columns = new PickerScrollColumns(dispatcher.Object, column);

        columns.RefreshDeferred(new CollectionView());

        dispatcher.Verify(d => d.Dispatch(It.IsAny<Action>()), Times.Never);
    }

    [Fact]
    public void RefreshAllDeferred_RefreshesEveryColumn()
    {
        var first = MakeColumn(20, out var firstList, out var firstUp, out var firstDown);
        var second = MakeColumn(20, out var secondList, out var secondUp, out var secondDown);
        var dispatcher = InlineDispatcher();
        var columns = new PickerScrollColumns(dispatcher.Object, first, second);
        columns.HandleScrolled(firstList, firstVisibleIndex: 5, lastVisibleIndex: 9);
        columns.HandleScrolled(secondList, firstVisibleIndex: 10, lastVisibleIndex: 14);

        columns.RefreshAllDeferred();

        dispatcher.Verify(d => d.Dispatch(It.IsAny<Action>()), Times.Exactly(2));
        SemanticProperties.GetDescription(firstUp).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(firstDown).Should().Be(BottomBoundary);
        SemanticProperties.GetDescription(secondUp).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(secondDown).Should().Be(BottomBoundary);
    }

    [Fact]
    public void Refresh_EmptyItemSource_ReportsBothBoundaries()
    {
        var column = MakeColumn(0, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);

        columns.RefreshDeferred(list);

        SemanticProperties.GetDescription(up).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    // #3400 — the picker opens centered on the current unit, so
    // ScrollSelectedIntoView records the selection and lands the platform
    // scroll once the list owns an arranged viewport.

    private static int SelectedItemAt(CollectionView list, int index) =>
        ((List<int>)list.ItemsSource!)[index];

    [Fact]
    public void ScrollSelectedIntoView_WithoutSelection_RecordsNothing()
    {
        var column = MakeColumn(20, out var list, out _, out _);
        var dispatcher = InlineDispatcher();
        var columns = new PickerScrollColumns(dispatcher.Object, column);

        columns.ScrollSelectedIntoView(list);

        column.PendingScrollItem.Should().BeNull();
        dispatcher.Verify(d => d.Dispatch(It.IsAny<Action>()), Times.Never);
    }

    [Fact]
    public void ScrollSelectedIntoView_UnknownList_RecordsNothing()
    {
        var column = MakeColumn(20, out _, out _, out _);
        var dispatcher = InlineDispatcher();
        var columns = new PickerScrollColumns(dispatcher.Object, column);
        var foreign = new CollectionView { ItemsSource = new List<int> { 1 }, SelectedItem = 1 };

        columns.ScrollSelectedIntoView(foreign);

        column.PendingScrollItem.Should().BeNull();
        dispatcher.Verify(d => d.Dispatch(It.IsAny<Action>()), Times.Never);
    }

    [Fact]
    public void ScrollSelectedIntoView_WhenArranged_CentersItemAndAnchorsArrows()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 9);
        columns.HasViewport = _ => true;
        var scrolled = new List<object>();
        columns.CenterOnItem = (_, item) => scrolled.Add(item);

        columns.ScrollSelectedIntoView(list);

        scrolled.Should().Equal(SelectedItemAt(list, 9));
        // Pending until the platform's Scrolled confirms the landing —
        // an issued scroll can still be dropped before items realize.
        column.PendingScrollItem.Should().Be(SelectedItemAt(list, 9));
        // The anchored index, not the stale top-of-list estimate, drives the
        // arrows until the platform's own Scrolled event reports the range.
        column.FirstVisibleIndex.Should().Be(9);
        column.LastVisibleIndex.Should().Be(9);
        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(MoreBelow);
    }

    [Fact]
    public void ScrollSelectedIntoView_PredictedRange_AnchorsWholeViewportAroundItem()
    {
        var column = MakeColumn(150, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 118);
        columns.HasViewport = _ => true;
        columns.CenterOnItem = (_, _) => { };
        columns.ItemCapacity = _ => 11;

        columns.ScrollSelectedIntoView(list);

        // תהילים קיט: centered in an 11-row viewport — the platform's real
        // landing replaces the prediction with its own measured range.
        column.FirstVisibleIndex.Should().Be(113);
        column.LastVisibleIndex.Should().Be(123);
        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(MoreBelow);
    }

    [Fact]
    public void ScrollSelectedIntoView_PredictedRange_ClampsAtListEnd()
    {
        var column = MakeColumn(150, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 149);
        columns.HasViewport = _ => true;
        columns.CenterOnItem = (_, _) => { };
        columns.ItemCapacity = _ => 11;

        columns.ScrollSelectedIntoView(list);

        // תהילים קנ: centering the last item clamps at the bottom edge.
        column.FirstVisibleIndex.Should().Be(139);
        column.LastVisibleIndex.Should().Be(149);
        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void ScrollSelectedIntoView_WholeListFits_AnchorsEveryItem()
    {
        var column = MakeColumn(5, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 4);
        columns.HasViewport = _ => true;
        columns.CenterOnItem = (_, _) => { };
        columns.ItemCapacity = _ => 11;

        columns.ScrollSelectedIntoView(list);

        // איכה ה: all five items fit, the platform scrolls nowhere and no
        // Scrolled ever arrives — the predicted whole-list range is final.
        column.FirstVisibleIndex.Should().Be(0);
        column.LastVisibleIndex.Should().Be(4);
        SemanticProperties.GetDescription(up).Should().Be(TopBoundary);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void ScrollSelectedIntoView_AtLastItem_AnchorsBottomBoundary()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 19);
        columns.HasViewport = _ => true;
        columns.CenterOnItem = (_, _) => { };

        columns.ScrollSelectedIntoView(list);

        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void ScrollSelectedIntoView_WhenUnarranged_WaitsForTheSizeChange()
    {
        var column = MakeColumn(20, out var list, out _, out _);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 9);
        var scrolled = new List<object>();
        columns.HasViewport = _ => false;
        columns.CenterOnItem = (_, item) => scrolled.Add(item);

        columns.ScrollSelectedIntoView(list);

        // The dispatch fires but no arranged viewport exists yet — the
        // request stays pending instead of issuing a doomed platform scroll.
        scrolled.Should().BeEmpty();
        column.PendingScrollItem.Should().Be(SelectedItemAt(list, 9));

        // The first arrange delivers the viewport: the pending scroll lands.
        columns.HasViewport = _ => true;
        columns.HandleSizeChanged(list);

        scrolled.Should().Equal(SelectedItemAt(list, 9));
        column.PendingScrollItem.Should().Be(SelectedItemAt(list, 9));
    }

    [Fact]
    public void PendingScroll_LandsOnceOnceConfirmedAcrossSizeChanges()
    {
        var column = MakeColumn(20, out var list, out _, out _);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 9);
        columns.HasViewport = _ => true;
        var scrolled = new List<object>();
        columns.CenterOnItem = (_, item) => scrolled.Add(item);

        columns.ScrollSelectedIntoView(list);   // the dispatch already lands it
        columns.HandleScrolled(list, firstVisibleIndex: 5, lastVisibleIndex: 13);
        column.PendingScrollItem.Should().BeNull();
        columns.HandleSizeChanged(list);        // a later arrange must not repeat it

        scrolled.Should().Equal(SelectedItemAt(list, 9));
    }

    [Fact]
    public void PendingScroll_WhileUnconfirmed_ReissuesOnTheNextArrange()
    {
        var column = MakeColumn(20, out var list, out _, out _);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 9);
        columns.HasViewport = _ => true;
        var scrolled = new List<object>();
        columns.CenterOnItem = (_, item) => scrolled.Add(item);

        columns.ScrollSelectedIntoView(list);
        columns.HandleSizeChanged(list);        // no Scrolled yet — retry is safe

        scrolled.Should().Equal(SelectedItemAt(list, 9), SelectedItemAt(list, 9));
    }

    [Fact]
    public void PendingScroll_FirstReportMissingItem_ReissuesOnce()
    {
        var column = MakeColumn(20, out var list, out _, out _);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 15);
        columns.HasViewport = _ => true;
        var scrolled = new List<object>();
        columns.CenterOnItem = (_, item) => scrolled.Add(item);
        columns.ScrollSelectedIntoView(list);

        // The list's first-ever report is its initial realization — items now
        // provably exist yet the target never landed: the issued scroll was
        // dropped by the adapter commit, so one re-issue goes out.
        columns.HandleScrolled(list, firstVisibleIndex: 0, lastVisibleIndex: 9);

        scrolled.Should().Equal(SelectedItemAt(list, 15), SelectedItemAt(list, 15));
        column.PendingScrollItem.Should().Be(SelectedItemAt(list, 15));

        // A later miss is a real scroll elsewhere (the user won) — abandon.
        columns.HandleScrolled(list, firstVisibleIndex: 0, lastVisibleIndex: 8);
        column.PendingScrollItem.Should().BeNull();
        scrolled.Should().HaveCount(2);
    }

    [Fact]
    public void PendingScroll_ReportContainingItem_Confirms()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 15);
        columns.HasViewport = _ => true;
        columns.CenterOnItem = (_, _) => { };
        columns.ScrollSelectedIntoView(list);

        columns.HandleScrolled(list, firstVisibleIndex: 11, lastVisibleIndex: 19);

        column.PendingScrollItem.Should().BeNull();
        column.FirstVisibleIndex.Should().Be(11);
        column.LastVisibleIndex.Should().Be(19);
        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }

    [Fact]
    public void PendingScroll_WhenSelectionMoved_SkipsTheStaleItem()
    {
        var column = MakeColumn(20, out var list, out _, out _);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        var items = (List<int>)list.ItemsSource!;
        list.SelectedItem = items[9];
        var scrolled = new List<object>();
        columns.HasViewport = _ => false;
        columns.CenterOnItem = (_, item) => scrolled.Add(item);
        columns.ScrollSelectedIntoView(list);   // recorded, still unarranged

        // A newer opening (or a user tap) replaces the selection before the
        // arrange lands — the stale request is dropped, never re-scrolling.
        list.SelectedItem = items[2];
        columns.HasViewport = _ => true;
        columns.HandleSizeChanged(list);

        scrolled.Should().BeEmpty();
        column.PendingScrollItem.Should().BeNull();
    }

    [Fact]
    public void PendingScroll_AfterRealizedScroll_ArrowsFollowTheRealRange()
    {
        var column = MakeColumn(20, out var list, out var up, out var down);
        var columns = new PickerScrollColumns(InlineDispatcher().Object, column);
        list.SelectedItem = SelectedItemAt(list, 19);
        columns.HasViewport = _ => true;
        columns.CenterOnItem = (_, _) => { };
        columns.ScrollSelectedIntoView(list);

        // The platform's own Scrolled event replaces the anchor with the
        // realized viewport.
        columns.HandleScrolled(list, firstVisibleIndex: 14, lastVisibleIndex: 19);

        column.FirstVisibleIndex.Should().Be(14);
        column.LastVisibleIndex.Should().Be(19);
        SemanticProperties.GetDescription(up).Should().Be(MoreAbove);
        SemanticProperties.GetDescription(down).Should().Be(BottomBoundary);
    }
}
