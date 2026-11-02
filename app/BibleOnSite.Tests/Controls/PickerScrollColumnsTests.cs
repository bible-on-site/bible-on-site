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
}
