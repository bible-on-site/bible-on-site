using BibleOnSite.Helpers;

namespace BibleOnSite.Controls;

/// <summary>
/// One scrollable column of a cascading picker: the <see cref="CollectionView"/>
/// plus its up/down boundary arrows and the zero-opacity sizer whose arranged
/// height equals one item's height (items are uniform via MeasureAllItems).
/// </summary>
public sealed class PickerScrollColumn(CollectionView list, Label up, Label down, Label sizer)
{
    public CollectionView List { get; } = list;
    public Label Up { get; } = up;
    public Label Down { get; } = down;
    public Label Sizer { get; } = sizer;

    /// <summary>Last reported visible-item indices (-1 until the first Scrolled event).</summary>
    public int FirstVisibleIndex { get; internal set; } = -1;
    public int LastVisibleIndex { get; internal set; } = -1;
}

/// <summary>
/// Shared scroll-edge indicator machinery for the cascading unit pickers
/// (#2475, #2573): each column's arrows turn black while more content exists
/// in that direction and gray at the boundary, driven by the actual scroll
/// extent — or by the item-sizer estimate until the first Scrolled event
/// arrives. Used by <see cref="PerekPickerPopup"/>, <see cref="ParashaUnitPickerPopup"/>
/// and <see cref="MasoraUnitPickerPopup"/> so the behavior stays identical in
/// every division's picker.
/// </summary>
public sealed class PickerScrollColumns
{
    private readonly IDispatcher _dispatcher;
    private readonly IReadOnlyList<PickerScrollColumn> _columns;

    // Arrow colors per the spec: black while more content exists in that
    // direction, gray at the boundary. On dark theme white reads as "black".
    private static readonly Color ArrowActiveLight = Colors.Black;
    private static readonly Color ArrowActiveDark = Colors.White;
    private static readonly Color ArrowInactive = Color.FromArgb("#919191"); // Gray400

    public PickerScrollColumns(IDispatcher dispatcher, params PickerScrollColumn[] columns)
    {
        _dispatcher = dispatcher;
        _columns = columns;
    }

    /// <summary>Records a column's reported visible range and refreshes its arrows.</summary>
    public void HandleScrolled(object? sender, int firstVisibleIndex, int lastVisibleIndex)
    {
        var column = ColumnFor(sender);
        if (column == null)
        {
            return;
        }

        column.FirstVisibleIndex = firstVisibleIndex;
        column.LastVisibleIndex = lastVisibleIndex;
        Refresh(column);
    }

    /// <summary>Resets a column after its size changed: more items may fit without scrolling.</summary>
    public void HandleSizeChanged(object? sender)
    {
        var column = ColumnFor(sender);
        if (column == null)
        {
            return;
        }

        // Fall back to the size estimate until the next Scrolled event.
        column.FirstVisibleIndex = -1;
        column.LastVisibleIndex = -1;
        Refresh(column);
    }

    /// <summary>Recomputes every column's arrows after the next layout pass.</summary>
    public void RefreshAllDeferred()
    {
        foreach (var column in _columns)
        {
            RefreshDeferred(column.List);
        }
    }

    /// <summary>
    /// Recomputes arrows after the next layout pass: item sources reset the
    /// scroll position, and the sizer needs an arrange before its height is real.
    /// </summary>
    public void RefreshDeferred(CollectionView list)
    {
        var column = ColumnFor(list);
        if (column == null)
        {
            return;
        }

        column.FirstVisibleIndex = -1;
        column.LastVisibleIndex = -1;
        _dispatcher.Dispatch(() => Refresh(column));
    }

    private PickerScrollColumn? ColumnFor(object? sender) =>
        _columns.FirstOrDefault(c => ReferenceEquals(c.List, sender));

    private void Refresh(PickerScrollColumn column)
    {
        var count = (column.List.ItemsSource as System.Collections.ICollection)?.Count ?? 0;

        bool canUp, canDown;
        if (column.LastVisibleIndex >= 0)
        {
            // Exact: a scroll event told us which items are visible.
            canUp = ScrollEdges.HasAbove(column.FirstVisibleIndex);
            canDown = ScrollEdges.HasBelow(column.LastVisibleIndex, count);
        }
        else
        {
            // No scroll event yet: the list sits at the top, so "more below"
            // comes down to whether the items overflow the viewport.
            canUp = false;
            canDown = ScrollEdges.HasBelowEstimate(column.List.Height, count * column.Sizer.Height);
        }

        SetArrow(column.Up, canUp, "יש עוד פריטים למעלה", "תחילת הרשימה");
        SetArrow(column.Down, canDown, "יש עוד פריטים למטה", "סוף הרשימה");
    }

    private static void SetArrow(Label arrow, bool canScroll, string availableText, string boundaryText)
    {
        if (canScroll)
        {
            arrow.SetAppThemeColor(Label.TextColorProperty, ArrowActiveLight, ArrowActiveDark);
        }
        else
        {
            arrow.SetAppThemeColor(Label.TextColorProperty, ArrowInactive, ArrowInactive);
        }

        SemanticProperties.SetDescription(arrow, canScroll ? availableText : boundaryText);
    }
}
