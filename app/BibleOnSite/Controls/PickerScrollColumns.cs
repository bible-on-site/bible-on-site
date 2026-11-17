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

    /// <summary>The platform reported at least one realized range for the current content.</summary>
    internal bool HasReportedScroll { get; set; }

    /// <summary>
    /// A selected item whose centering was requested but not yet confirmed by
    /// a platform Scrolled event — kept so a dropped platform scroll can be
    /// re-issued once items provably exist, and dropped once a real scroll
    /// lands elsewhere or the selection moves on.
    /// </summary>
    public object? PendingScrollItem { get; internal set; }
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
        foreach (var column in _columns)
        {
            column.List.HandlerChanged += HandleHandlerChanged;
        }
    }

    // Seams so unit tests drive the arranged-viewport and platform-scroll
    // branches without a native handler — the same pattern as the platform
    // seams in ReaderScrollTop.
    internal Func<CollectionView, bool> HasViewport { get; set; } =
        list => list.Handler is not null && list.Height > 0;

    internal Action<CollectionView, object> CenterOnItem { get; set; } =
        (list, item) => list.ScrollTo(item, position: ScrollToPosition.Center, animate: false);

    /// <summary>
    /// How many items the column's viewport holds, from the arranged list and
    /// item-sizer heights. Without a real arrange (unit tests) a single-item
    /// estimate keeps the anchor honest instead of inventing a viewport.
    /// </summary>
    internal Func<PickerScrollColumn, int> ItemCapacity { get; set; } =
        column => column.List.Height > 0 && column.Sizer.Height > 0
            ? Math.Max(1, (int)(column.List.Height / column.Sizer.Height))
            : 1;

    /// <summary>Records a column's reported visible range and refreshes its arrows.</summary>
    public void HandleScrolled(object? sender, int firstVisibleIndex, int lastVisibleIndex)
    {
        var column = ColumnFor(sender);
        if (column == null)
        {
            return;
        }

        var firstReport = !column.HasReportedScroll;
        column.HasReportedScroll = true;
        column.FirstVisibleIndex = firstVisibleIndex;
        column.LastVisibleIndex = lastVisibleIndex;
        ResolvePendingScroll(column, firstReport, firstVisibleIndex, lastVisibleIndex);
        Refresh(column);
    }

    /// <summary>
    /// A platform scroll issued while the list had no realized items can be
    /// discarded when the adapter commits. The first Scrolled event a list ever
    /// reports is its initial realization — before that there is nothing for a
    /// user to scroll — so a report that still misses the pending item means
    /// the issued scroll was dropped and one re-issue, now against realized
    /// items, lands it. Any later miss is a user scroll, which wins (#3400).
    /// </summary>
    private void ResolvePendingScroll(PickerScrollColumn column, bool firstReport, int first, int last)
    {
        var item = column.PendingScrollItem;
        if (item == null)
        {
            return;
        }

        var index = (column.List.ItemsSource as System.Collections.IList)?.IndexOf(item) ?? -1;
        if (index >= 0 && index >= first && index <= last)
        {
            column.PendingScrollItem = null;
        }
        else if (firstReport)
        {
            _dispatcher.Dispatch(() => TryPendingScroll(column));
        }
        else
        {
            column.PendingScrollItem = null;
        }
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
        // The size change is also the arrange signal a deferred
        // scroll-to-selection waits for.
        TryPendingScroll(column);
        Refresh(column);
    }

    /// <summary>The platform attaching its handler is the other arrange signal a deferred scroll waits for.</summary>
    internal void HandleHandlerChanged(object? sender, EventArgs e)
    {
        var column = ColumnFor(sender);
        if (column != null)
        {
            TryPendingScroll(column);
        }
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
        column.HasReportedScroll = false;
        _dispatcher.Dispatch(() => Refresh(column));
    }

    /// <summary>
    /// Positions the column at its current <c>SelectedItem</c>.
    /// A just-shown popup — or a just-replaced item source — has no arranged
    /// viewport to scroll against yet, so the request is recorded and issued
    /// once the list owns a real height: from the next size change or from the
    /// dispatcher pass that follows the pending layout, whichever comes first
    /// (#3400). Centered in the viewport where the list extent allows it.
    /// </summary>
    public void ScrollSelectedIntoView(CollectionView list)
    {
        var column = ColumnFor(list);
        var item = list.SelectedItem;
        if (column == null || item == null)
        {
            return;
        }

        column.PendingScrollItem = item;
        _dispatcher.Dispatch(() => TryPendingScroll(column));
    }

    private void TryPendingScroll(PickerScrollColumn column)
    {
        var item = column.PendingScrollItem;
        if (item == null)
        {
            return;
        }

        if (!HasViewport(column.List))
        {
            // Still unarranged — the next size change retries.
            return;
        }

        // A later opening records its own target, and a user tap replaces the
        // selection; scroll only while the recorded item is still the selected
        // one so stale work never repositions a newer target.
        if (!Equals(column.List.SelectedItem, item))
        {
            column.PendingScrollItem = null;
            return;
        }

        CenterOnItem(column.List, item);
        // The request stays pending until the platform's Scrolled confirms the
        // item landed inside the realized range — a scroll issued before items
        // existed can be dropped when the adapter commits (#3400).
        AnchorPredictedRange(column, item);
        Refresh(column);
    }

    /// <summary>
    /// Points the arrows at the range centering the item should produce — the
    /// item centered when the list overflows, the whole list when it fits
    /// (an already-visible target scrolls nowhere, so no Scrolled ever comes),
    /// clamped at both ends — until the platform's Scrolled replaces it.
    /// </summary>
    private void AnchorPredictedRange(PickerScrollColumn column, object item)
    {
        if (column.List.ItemsSource is not System.Collections.IList items)
        {
            return;
        }

        // A missing item — including an empty list — leaves nothing to anchor.
        var index = items.IndexOf(item);
        if (index < 0)
        {
            return;
        }

        var count = items.Count;
        var capacity = ItemCapacity(column);
        var first = Math.Max(0, Math.Min(index - capacity / 2, count - capacity));
        column.FirstVisibleIndex = first;
        column.LastVisibleIndex = Math.Min(count - 1, first + capacity - 1);
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
