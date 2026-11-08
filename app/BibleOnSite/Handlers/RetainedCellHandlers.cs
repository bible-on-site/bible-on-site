#if IOS || MACCATALYST
using System.Collections.Generic;
using Foundation;
using Microsoft.Maui.Controls;
using Microsoft.Maui.Controls.Handlers.Items2;
using UIKit;

namespace BibleOnSite.Handlers;

/// <summary>
/// Strongly holds every native view the collection view might touch after its
/// managed peer is no longer referenced elsewhere. Items2 cells and
/// supplementary views are only weakly anchored: once they leave the visible
/// set their managed peers become collectable while UIKit keeps the native
/// views in the reuse pool or inside a covered page's retained hierarchy. A
/// later native layout pass — e.g. the navigation-pop transition laying out
/// the revealed page — that walks Superview/Subviews marshals such a stale
/// view and throws MissingCtor because the Items2 cell types have no
/// NativeHandle constructor, killing the app (#2433).
/// </summary>
internal sealed class RetainedCellPool
{
    // Bounds the retention so obsolete cells stop accumulating for the
    // controller's lifetime. Cells must stay pinned only while UIKit can
    // still reach them — the live reuse queue plus the visible/covered view
    // hierarchy — and UIKit caps that set at roughly the simultaneously
    // realized cells (visible + prefetch spares) per reuse identifier, far
    // below this bound. Allocations beyond the bound therefore mean UIKit
    // already dropped earlier cells, so evicting the oldest first cannot
    // unpin a cell that is still reusable.
    // shortcut: UIKit does not expose reuse-queue membership, so eviction is
    // by allocation order rather than true removal; if a future layout keeps
    // more than Capacity live cells, raise it instead of unpinning them.
    private const int Capacity = 256;
    private readonly Queue<UICollectionReusableView> _order = new();
    private readonly HashSet<UICollectionReusableView> _retained = new();

    internal void Keep(UICollectionReusableView? view)
    {
        if (view is null || !_retained.Add(view))
        {
            return;
        }
        _order.Enqueue(view);
        while (_retained.Count > Capacity)
        {
            _retained.Remove(_order.Dequeue());
        }
    }
}

internal sealed class RetainedCellItemsViewController : ReorderableItemsViewController2<ReorderableItemsView>
{
    private readonly RetainedCellPool _pool = new();

    public RetainedCellItemsViewController(ReorderableItemsView itemsView, UICollectionViewLayout layout)
        : base(itemsView, layout)
    {
    }

    public override UICollectionViewCell GetCell(UICollectionView collectionView, NSIndexPath indexPath)
    {
        var cell = base.GetCell(collectionView, indexPath);
        _pool.Keep(cell);
        return cell;
    }

    public override UICollectionReusableView GetViewForSupplementaryElement(
        UICollectionView collectionView, NSString elementKind, NSIndexPath indexPath)
    {
        var view = base.GetViewForSupplementaryElement(collectionView, elementKind, indexPath);
        _pool.Keep(view);
        return view;
    }
}

internal sealed class RetainedCellCarouselViewController : CarouselViewController2
{
    private readonly RetainedCellPool _pool = new();

    public RetainedCellCarouselViewController(CarouselView itemsView, UICollectionViewLayout layout)
        : base(itemsView, layout)
    {
    }

    public override UICollectionViewCell GetCell(UICollectionView collectionView, NSIndexPath indexPath)
    {
        var cell = base.GetCell(collectionView, indexPath);
        _pool.Keep(cell);
        return cell;
    }
}

/// <summary>
/// <see cref="CollectionView"/> handler that uses <see cref="RetainedCellItemsViewController"/>
/// so native cells cannot outlive their managed peers (#2433).
/// </summary>
public sealed class RetainedCellCollectionViewHandler : CollectionViewHandler2
{
    protected override ItemsViewController2<ReorderableItemsView> CreateController(
        ReorderableItemsView itemsView, UICollectionViewLayout layout)
        => new RetainedCellItemsViewController(itemsView, layout);
}

/// <summary>
/// <see cref="CarouselView"/> handler that uses <see cref="RetainedCellCarouselViewController"/>
/// so native cells cannot outlive their managed peers (#2433).
/// </summary>
public sealed class RetainedCellCarouselViewHandler : CarouselViewHandler2
{
    protected override CarouselViewController2 CreateController(
        CarouselView itemsView, UICollectionViewLayout layout)
        => new RetainedCellCarouselViewController(itemsView, layout);
}
#endif
