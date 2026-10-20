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
    private readonly HashSet<UICollectionReusableView> _retained = new();

    internal void Keep(UICollectionReusableView? view)
    {
        if (view is not null)
        {
            _retained.Add(view);
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
